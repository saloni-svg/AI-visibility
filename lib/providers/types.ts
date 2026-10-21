export type ProviderName = "openai" | "gemini" | "perplexity" | "ai_overview";

export type Citation = { url: string; title?: string };

export type Provider = {
  name: ProviderName;
  label: string;
  model: string;
  // Env vars that must be set for this provider to run.
  requiredEnv: string[];
  // Sends the prompt (as asked from `country`, an ISO code) and returns the full API response (stored as-is).
  call: (prompt: string, country: string) => Promise<any>;
  // Pulls the answer text and the provider's own citation list out of a stored response.
  extract: (raw: any) => { text: string; citations: Citation[] };
};
