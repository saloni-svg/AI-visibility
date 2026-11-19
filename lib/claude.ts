import Anthropic from "@anthropic-ai/sdk";

// Claude: the model behind RyzeIQ's AI Agents section (SEO agent, and every agent added later).
// One place for the client, the model, and the request settings, so a new agent only brings its
// own instructions, data and output schema.
// Setup (.env and Vercel): ANTHROPIC_API_KEY. Optional CLAUDE_MODEL (default claude-opus-5-5) and
// CLAUDE_EFFORT (low | medium | high | xhigh | max; default high).

export const hasClaude = () => !!process.env.ANTHROPIC_API_KEY;
export const claudeModel = () => process.env.CLAUDE_MODEL || "claude-opus-5-5";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const defaultEffort = (): Effort => (EFFORTS.includes(process.env.CLAUDE_EFFORT as Effort) ? (process.env.CLAUDE_EFFORT as Effort) : "high");

// Readable names for the UI ("Written by Claude Opus 5.5").
const NAMES: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-fable-5-2": "Claude Fable 5.2", "claude-opus-5": "Claude Opus 5", "claude-opus-4-8": "Claude Opus 4.8",
};
export const modelName = (id: string) => NAMES[id] ?? id;

let client: Anthropic | null = null;
// Retries rate limits, overloads and network errors twice; agent runs can take a few minutes.
const anthropic = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 10 * 60_000 }));

export type ClaudeUsage = { model: string; inputTokens: number; outputTokens: number; costUsd: number };

// USD per million tokens (input, output), for the cost shown with each run.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-2": [8, 40], "claude-opus-5": [5, 25], "claude-opus-4-8": [5, 25],
};

// One request that must come back as JSON matching `schema` (structured outputs), e.g. a written
// plan or report. Streams so long outputs never hit an HTTP timeout. If Claude's safety checks
// decline, the API retries on a fallback model automatically; a final decline is an error.
export async function claudeJson<T>(opts: {
  system: string;
  input: string;
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}): Promise<{ data: T; usage: ClaudeUsage }> {
  if (!hasClaude()) throw new Error("Add ANTHROPIC_API_KEY to .env (console.anthropic.com → API Keys).");
  const model = claudeModel();
  let message: Anthropic.Beta.BetaMessage;
  try {
    const stream = anthropic().beta.messages.stream({
      model,
      max_tokens: opts.maxTokens ?? 32000,
      system: opts.system,
      messages: [{ role: "user", content: opts.input }],
      output_config: { effort: opts.effort ?? defaultEffort(), format: { type: "json_schema", schema: opts.schema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Claude: the ANTHROPIC_API_KEY was rejected. Check it in .env (and in Vercel).");
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error(`Claude: this API key can't use ${model}. ${err.message}`);
    if (err instanceof Anthropic.RateLimitError) throw new Error("Claude: rate limit reached. Try again in a minute.");
    if (err instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(err.message)) {
      throw new Error("Claude: no API credit left. Add credit at console.anthropic.com → Billing.");
    }
    if (err instanceof Anthropic.APIError) throw new Error(`Claude: ${err.message}`);
    throw err;
  }

  if (message.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}. Try again or rephrase the focus.`);
  }
  if (message.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (too long). Try again with a narrower focus.");
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error("Claude returned an answer that isn't valid JSON. Try again.");
  }
  const [pin, pout] = PRICES[message.model] ?? PRICES[model] ?? [0, 0];
  const inputTokens = (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
  const outputTokens = message.usage.output_tokens ?? 0;
  return {
    data,
    usage: { model: message.model, inputTokens, outputTokens, costUsd: Math.round(((inputTokens * pin + outputTokens * pout) / 1e6) * 1000) / 1000 },
  };
}
