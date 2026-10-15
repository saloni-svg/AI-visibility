// Collects answers: asks every active prompt to each AI provider N times,
// saves the raw answers, then runs the parser on them.
//
//   npm run track                              all providers
//   npm run track -- --providers=openai,gemini only some providers
//   npm run track -- --skip-parse              collect only, parse later
import { config } from "../lib/env";
import { runPool } from "../lib/http";
import { parseAnswers } from "../lib/parser";
import { providers, type Provider } from "../lib/providers";
import { db } from "../lib/supabase";

const args = process.argv.slice(2);
const providerFilter = args.find((a) => a.startsWith("--providers="))?.split("=")[1]?.split(",");
const skipParse = args.includes("--skip-parse");

async function main() {
  // 1. Pick providers: the ones requested that also have an API key set.
  const active: Provider[] = providers.filter((p) => {
    if (providerFilter && !providerFilter.includes(p.name)) return false;
    if (!process.env[p.apiKeyEnv]) {
      console.warn(`Skipping ${p.name}: ${p.apiKeyEnv} is not set.`);
      return false;
    }
    return true;
  });
  if (!active.length) throw new Error("No providers to run. Check your API keys in .env.");

  // 2. Load the prompts to ask.
  const { data: prompts, error } = await db().from("prompts").select("id, text").eq("active", true);
  if (error) throw error;
  if (!prompts?.length) throw new Error("No active prompts. Add some to the prompts table first.");

  // 3. Start a run so every answer from this execution is grouped together.
  const { data: run, error: runErr } = await db().from("runs").insert({}).select("id").single();
  if (runErr) throw runErr;

  const jobs = prompts.flatMap((prompt) =>
    active.flatMap((provider) =>
      Array.from({ length: config.attemptsPerPrompt }, (_, i) => ({ prompt, provider, attempt: i + 1 })),
    ),
  );
  console.log(
    `Run ${run.id}: ${prompts.length} prompts x ${active.length} providers x ${config.attemptsPerPrompt} attempts = ${jobs.length} calls`,
  );

  // 4. Ask each question and save the answer (or the error) right away.
  let ok = 0;
  let failed = 0;
  await runPool(jobs, config.concurrency, async ({ prompt, provider, attempt }) => {
    const started = Date.now();
    const row = {
      run_id: run.id,
      prompt_id: prompt.id,
      provider: provider.name,
      model: provider.model,
      attempt,
      answer_text: null as string | null,
      raw_response: null as unknown,
      error: null as string | null,
      latency_ms: 0,
    };
    try {
      row.raw_response = await provider.call(prompt.text);
      row.answer_text = provider.extract(row.raw_response).text;
      ok++;
    } catch (err) {
      row.error = (err as Error).message;
      failed++;
    }
    row.latency_ms = Date.now() - started;

    const { error } = await db().from("answers").insert(row);
    if (error) console.error(`  could not save answer: ${error.message}`);
    const label = `${provider.name} #${attempt} "${prompt.text.slice(0, 50)}"`;
    console.log(row.error ? `  x ${label}: ${row.error}` : `  ok ${label} (${row.latency_ms}ms)`);
  });

  // 5. Parse the answers into mentions and sources.
  if (!skipParse) await parseAnswers({ runId: run.id });

  // 6. Close the run.
  await db()
    .from("runs")
    .update({
      status: ok > 0 ? "completed" : "failed",
      finished_at: new Date().toISOString(),
      notes: `${ok} answers saved, ${failed} calls failed`,
    })
    .eq("id", run.id);
  console.log(`Done. Run ${run.id}: ${ok} answers saved, ${failed} calls failed.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
