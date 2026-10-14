// One minimal Perplexity Agent API request. Prints only the status and the
// shape of the response (never the API key).
//
//   npm run smoke:perplexity
import Perplexity from "@perplexity-ai/perplexity_ai";
import "../lib/env";
import { perplexity } from "../lib/providers/perplexity";

if (!process.env.PERPLEXITY_API_KEY) {
  console.error("PERPLEXITY_API_KEY is not set. Create a key at https://console.perplexity.ai and add it to .env.");
  process.exit(1);
}

try {
  const raw = await perplexity.call("What is Perplexity AI? Answer in one sentence.");
  const { text, citations } = perplexity.extract(raw);
  console.log("HTTP 200");
  console.log({
    status: raw.status,
    model: raw.model,
    output_item_types: raw.output.map((item: { type: string }) => item.type),
    answer_chars: text.length,
    citations: citations.length,
    cost_usd: raw.usage?.cost?.total_cost,
  });
} catch (err) {
  if (err instanceof Perplexity.APIError) {
    const hint =
      err.status === 401 ? " (authentication problem: check or rotate the key in the console)"
      : err.status === 429 ? ` (rate limited; Retry-After: ${err.headers?.get("retry-after") ?? "n/a"}s)`
      : "";
    console.error(`HTTP ${err.status}${hint}`);
  } else {
    console.error((err as Error).message);
  }
  process.exit(1);
}
