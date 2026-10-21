// Collects answers: asks every active prompt to each AI provider N times,
// saves the raw answers, then runs the parser on them.
//
//   npm run track                              all providers
//   npm run track -- --providers=openai,gemini only some providers
//   npm run track -- --skip-parse              collect only, parse later
//   npm run track -- --domain=example.com      only one brand's prompts
import { collectAnswer } from "../lib/collect";
import { cleanDomain } from "../lib/domain";
import { config } from "../lib/env";
import { runPool } from "../lib/http";
import { parseAnswers } from "../lib/parser";
import { isReady, providers, type Provider } from "../lib/providers";
import { db } from "../lib/supabase";

const args = process.argv.slice(2);
const providerFilter = args.find((a) => a.startsWith("--providers="))?.split("=")[1]?.split(",");
const skipParse = args.includes("--skip-parse");
const domainArg = args.find((a) => a.startsWith("--domain="))?.split("=")[1];

async function main() {
  // 1. Pick providers: the ones requested that also have an API key set.
  const active: Provider[] = providers.filter((p) => {
    if (providerFilter && !providerFilter.includes(p.name)) return false;
    if (!isReady(p)) {
      console.warn(`Skipping ${p.name}: ${p.requiredEnv.join(" / ")} not set.`);
      return false;
    }
    return true;
  });
  if (!active.length) throw new Error("No providers to run. Check your API keys in .env.");

  // 2. Load the prompts to ask.
  let brandId: string | null = null;
  if (domainArg) {
    const domain = cleanDomain(domainArg);
    const { data: brand } = await db().from("brands").select("id").eq("domain", domain ?? "").maybeSingle();
    if (!brand) throw new Error(`No brand with domain ${domainArg}. Analyze it in the dashboard first.`);
    brandId = brand.id;
  }
  let promptQuery = db().from("prompts").select("id, text, brands(countries)").eq("active", true);
  if (brandId) promptQuery = promptQuery.eq("brand_id", brandId);
  const { data: prompts, error } = await promptQuery;
  if (error) throw error;
  if (!prompts?.length) throw new Error("No active prompts. Add some to the prompts table first.");

  // 3. Start a run so every answer from this execution is grouped together.
  const { data: run, error: runErr } = await db()
    .from("runs")
    .insert(brandId ? { notes: `brand:${brandId}` } : {})
    .select("id")
    .single();
  if (runErr) throw runErr;

  // Every question is asked from each country its brand is checked in.
  const countriesOf = (p: any): string[] => (p.brands?.countries?.length ? p.brands.countries : ["US"]);
  const jobs = prompts.flatMap((prompt) =>
    countriesOf(prompt).flatMap((country) =>
      active.flatMap((provider) =>
        Array.from({ length: provider.name === "ai_overview" ? 1 : config.attemptsPerPrompt }, (_, i) => ({
          prompt, provider, attempt: i + 1, country,
        })),
      ),
    ),
  );
  console.log(
    `Run ${run.id}: ${prompts.length} prompts x ${active.length} sources x countries = ${jobs.length} calls`,
  );

  // 4. Ask each question and save the answer (or the error) right away.
  let ok = 0;
  let failed = 0;
  await runPool(jobs, config.concurrency, async ({ prompt, provider, attempt, country }) => {
    const result = await collectAnswer(run.id, prompt, provider, attempt, country);
    if (result.ok) ok++;
    else failed++;
    const label = `${provider.name} ${country} #${attempt} "${prompt.text.slice(0, 50)}"`;
    console.log(result.error ? `  x ${label}: ${result.error}` : `  ok ${label} (${result.latencyMs}ms)`);
  });

  // 5. Parse the answers into mentions and sources.
  if (!skipParse) await parseAnswers({ runId: run.id });

  // 6. Close the run.
  await db()
    .from("runs")
    .update({
      status: ok > 0 ? "completed" : "failed",
      finished_at: new Date().toISOString(),
      notes: `${brandId ? `brand:${brandId} · ` : ""}${ok} answers saved, ${failed} calls failed`,
    })
    .eq("id", run.id);
  console.log(`Done. Run ${run.id}: ${ok} answers saved, ${failed} calls failed.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
