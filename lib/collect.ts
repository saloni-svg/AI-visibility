import type { Provider } from "./providers";
import { db } from "./supabase";

// Asks one provider one prompt, as asked from one country, and saves the
// answer (or the error) right away. Shared by `npm run track` and the Analyze button.
export async function collectAnswer(
  runId: string,
  prompt: { id: string; text: string },
  provider: Provider,
  attempt: number,
  country: string,
): Promise<{ ok: boolean; error: string | null; latencyMs: number }> {
  const started = Date.now();
  const row = {
    run_id: runId,
    prompt_id: prompt.id,
    provider: provider.name,
    model: provider.model,
    attempt,
    country,
    answer_text: null as string | null,
    raw_response: null as unknown,
    error: null as string | null,
    latency_ms: 0,
  };
  try {
    row.raw_response = await provider.call(prompt.text, country);
    row.answer_text = provider.extract(row.raw_response).text;
  } catch (err) {
    row.error = (err as Error).message;
  }
  row.latency_ms = Date.now() - started;

  const { error } = await db().from("answers").insert(row);
  if (error) console.error(`  could not save answer: ${error.message}`);
  return { ok: !row.error, error: row.error, latencyMs: row.latency_ms };
}
