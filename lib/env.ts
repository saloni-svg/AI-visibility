// Loads variables from .env into process.env (Node 22 built-in, no extra package).
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: fall back to variables already set in the shell.
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to your .env file (see .env.example).`);
  return value;
}

export function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const config = {
  attemptsPerPrompt: envInt("ATTEMPTS_PER_PROMPT", 3),
  concurrency: envInt("CONCURRENCY", 4),
  // Agent API preset: fast | low | medium | high | xhigh (deeper = slower and pricier)
  perplexityPreset: process.env.PERPLEXITY_PRESET || "fast",
  models: {
    openai: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    gemini: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    // Optional: a provider/model ID such as "openai/gpt-5.6-sol". Unset = use the preset.
    perplexity: process.env.PERPLEXITY_MODEL || undefined,
    parser: process.env.PARSER_MODEL || "gpt-4.1-mini",
  },
};
