import { config, requireEnv } from "../env";
import { postJson } from "../http";
import { askedFrom } from "./location";
import type { Citation, Provider } from "./types";

// Uses Google Search grounding so the answer includes its web sources.
// Note: Gemini returns redirect links (vertexaisearch.cloud.google.com/...)
// and puts the real site domain in the title.
export const gemini: Provider = {
  name: "gemini",
  label: "Gemini",
  model: config.models.gemini,
  requiredEnv: ["GEMINI_API_KEY"],

  call(prompt, country) {
    return postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      { "x-goog-api-key": requireEnv("GEMINI_API_KEY") },
      {
        contents: [{ role: "user", parts: [{ text: askedFrom(prompt, country) }] }],
        tools: [{ google_search: {} }],
      },
    );
  },

  extract(raw) {
    const candidate = raw?.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    const citations: Citation[] = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .filter((c: any) => c.web?.uri)
      .map((c: any) => ({ url: c.web.uri, title: c.web.title }));
    return { text, citations };
  },
};
