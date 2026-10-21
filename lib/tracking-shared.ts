// Prompt tracking constants shared by the server and the browser (no server imports here).

export type Engine = "openai" | "gemini" | "perplexity" | "ai_overview";
export const ENGINES: { key: Engine; label: string }[] = [
  { key: "openai", label: "ChatGPT" },
  { key: "gemini", label: "Gemini" },
  { key: "perplexity", label: "Perplexity" },
  { key: "ai_overview", label: "Google AI Overview" },
];
export const ENGINE_LABEL = Object.fromEntries(ENGINES.map((e) => [e.key, e.label])) as Record<Engine, string>;
export const isEngine = (e: unknown): e is Engine => ENGINES.some((x) => x.key === e);
export const MAX_PROMPTS = 200;

// Languages Google AI Overviews can be checked in, per country.
export const LANGUAGES: Record<string, { code: string; name: string }[]> = {
  US: [{ code: "en", name: "English" }, { code: "es", name: "Spanish" }],
  GB: [{ code: "en", name: "English" }],
  IN: [{ code: "en", name: "English" }, { code: "hi", name: "Hindi" }],
  AU: [{ code: "en", name: "English" }],
  CA: [{ code: "en", name: "English" }, { code: "fr", name: "French" }],
  AE: [{ code: "en", name: "English" }, { code: "ar", name: "Arabic" }],
  SG: [{ code: "en", name: "English" }, { code: "zh-CN", name: "Chinese" }],
  DE: [{ code: "de", name: "German" }, { code: "en", name: "English" }],
  FR: [{ code: "fr", name: "French" }, { code: "en", name: "English" }],
};
