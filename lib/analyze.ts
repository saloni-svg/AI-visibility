import { collectAnswer } from "./collect";
import { clearCache } from "./cache";
import { snapshotAfterCheck } from "./snapshots";
import { config } from "./env";
import { runPool } from "./http";
import { generateInsights } from "./insights";
import { parseAnswers } from "./parser";
import { isReady, providers } from "./providers";
import { db } from "./supabase";
import { ensureVolumes } from "./topics";

// The Analyze button runs in small steps: the browser calls stepRun() again and
// again, so it can show progress and no single request runs for minutes.
// A website run is linked to its brand through runs.notes ("brand:<id>").
// Each run asks every question, to every AI source, from every brand country.

const brandTag = (brandId: string) => `brand:${brandId}`;
const brandFromNotes = (notes: string | null) => notes?.match(/brand:([0-9a-f-]{36})/)?.[1] ?? null;
const activeProviders = () => providers.filter(isReady);

// Returns "ready" when every brand country has recent answers (saves money), else a run to process.
export async function getOrStartRun(
  brand: { id: string; countries: string[] },
  force: boolean,
): Promise<{ ready: true } | { runId: string }> {
  if (!force) {
    const { data: prompts } = await db().from("prompts").select("id").eq("brand_id", brand.id);
    const ids = (prompts ?? []).map((p) => p.id);
    if (ids.length) {
      const since = new Date(Date.now() - config.reuseResultsDays * 86_400_000).toISOString();
      const { data: recent } = await db()
        .from("answers")
        .select("country")
        .in("prompt_id", ids)
        .not("answer_text", "is", null)
        .gte("created_at", since)
        .limit(1000);
      const covered = new Set((recent ?? []).map((a) => a.country));
      if (brand.countries.every((c) => covered.has(c))) return { ready: true };
    }
  }

  // Resume an unfinished website run for this brand instead of starting another.
  const { data: open } = await db()
    .from("runs")
    .select("id")
    .eq("status", "running")
    .eq("notes", brandTag(brand.id))
    .order("started_at", { ascending: false })
    .limit(1);
  if (open?.length) return { runId: open[0].id };

  const { data, error } = await db().from("runs").insert({ notes: brandTag(brand.id) }).select("id").single();
  if (error) throw error;
  return { runId: data.id };
}

export async function stepRun(runId: string): Promise<{ status: string; done: number; total: number }> {
  const { data: run, error } = await db().from("runs").select("id, status, notes").eq("id", runId).single();
  if (error) throw error;
  const brandId = brandFromNotes(run.notes);
  if (!brandId) throw new Error("This run isn't linked to a brand.");

  const active = activeProviders();
  if (!active.length) throw new Error("No AI provider keys found. Add them to .env.");

  const [{ data: brand }, { data: prompts }, { data: done }] = await Promise.all([
    db().from("brands").select("countries").eq("id", brandId).single(),
    db().from("prompts").select("id, text").eq("brand_id", brandId).eq("active", true),
    db().from("answers").select("prompt_id, provider, attempt, country").eq("run_id", runId),
  ]);
  const countries: string[] = brand?.countries?.length ? brand.countries : ["US"];
  const key = (p: string, prov: string, a: number, c: string) => `${p}|${prov}|${a}|${c}`;
  const doneKeys = new Set((done ?? []).map((a) => key(a.prompt_id, a.provider, a.attempt, a.country)));
  const jobs = (prompts ?? []).flatMap((prompt) =>
    countries.flatMap((country) =>
      active.flatMap((provider) =>
        // Google AI Overview is the same page every time, so ask it once.
        Array.from({ length: provider.name === "ai_overview" ? 1 : config.webAttemptsPerPrompt }, (_, i) => ({
          prompt, provider, attempt: i + 1, country,
        })),
      ),
    ),
  );
  const pending = jobs.filter((j) => !doneKeys.has(key(j.prompt.id, j.provider.name, j.attempt, j.country)));
  if (run.status !== "running") return { status: run.status, done: jobs.length - pending.length, total: jobs.length };

  const batch = pending.slice(0, config.webBatchSize);
  await runPool(batch, config.webConcurrency, async ({ prompt, provider, attempt, country }) => {
    await collectAnswer(runId, prompt, provider, attempt, country);
  });
  await parseAnswers({ runId, concurrency: config.webConcurrency });

  const remaining = pending.length - batch.length;
  if (remaining > 0) return { status: "running", done: jobs.length - remaining, total: jobs.length };

  const { count: ok } = await db()
    .from("answers")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .not("answer_text", "is", null);
  const status = (ok ?? 0) > 0 ? "completed" : "failed";
  await db()
    .from("runs")
    .update({ status, finished_at: new Date().toISOString(), notes: `${brandTag(brandId)} · ${ok ?? 0} answers saved` })
    .eq("id", runId);

  // AI volume and the "What's next?" cards. A failure here never fails the run.
  if (status === "completed") {
    try {
      await ensureVolumes(brandId, countries);
    } catch (err) {
      console.error(`AI volume lookup failed: ${(err as Error).message}`);
    }
    try {
      await generateInsights(brandId, runId);
    } catch (err) {
      console.error(`Could not write recommendations: ${(err as Error).message}`);
    }
    // Save what the website said now, so later changes can be compared (Change explainer).
    void snapshotAfterCheck(brandId).catch((err) => console.error(`Page snapshot failed: ${err.message}`));
  }
  clearCache(); // new results: dashboards reload from the database
  return { status, done: jobs.length, total: jobs.length };
}
