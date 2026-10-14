import { config, requireEnv } from "../env";
import { postJson } from "../http";
import type { Citation, Provider } from "./types";

// Perplexity always searches the web and returns its sources.
export const perplexity: Provider = {
  name: "perplexity",
  model: config.models.perplexity,
  apiKeyEnv: "PERPLEXITY_API_KEY",

  call(prompt) {
    return postJson(
      "https://api.perplexity.ai/chat/completions",
      { Authorization: `Bearer ${requireEnv("PERPLEXITY_API_KEY")}` },
      { model: this.model, messages: [{ role: "user", content: prompt }] },
    );
  },

  extract(raw) {
    const text: string = raw?.choices?.[0]?.message?.content ?? "";
    const citations: Citation[] = raw?.search_results?.length
      ? raw.search_results.map((s: any) => ({ url: s.url, title: s.title }))
      : (raw?.citations ?? []).map((url: string) => ({ url }));
    return { text, citations };
  },
};
