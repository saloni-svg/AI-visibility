export type ProviderName = "openai" | "gemini" | "perplexity";

export type Citation = { url: string; title?: string };

export type Provider = {
  name: ProviderName;
  model: string;
  apiKeyEnv: string;
  // Sends the prompt and returns the full API response (stored as-is).
  call: (prompt: string) => Promise<any>;
  // Pulls the answer text and the provider's own citation list out of a stored response.
  extract: (raw: any) => { text: string; citations: Citation[] };
};
