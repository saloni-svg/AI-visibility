import { COUNTRIES, isCountry } from "../countries";
import { dataForSeo } from "../dataforseo";
import type { Citation, Provider } from "./types";

// Google AI Overview, through DataForSEO's live Google SERP API. Not every
// search shows an AI Overview; then the answer text is empty (counted as
// "no overview", not as an error).
export const aiOverview: Provider = {
  name: "ai_overview",
  label: "AI Overview",
  model: "google-serp",
  requiredEnv: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],

  call(prompt, country) {
    const code = isCountry(country) ? country : "US";
    return dataForSeo("serp/google/organic/live/advanced", [
      {
        keyword: prompt,
        location_code: COUNTRIES[code].locationCode,
        language_code: "en",
        device: "desktop",
        load_async_ai_overview: true,
      },
    ]);
  },

  extract(raw) {
    const items: any[] = raw?.tasks?.[0]?.result?.[0]?.items ?? [];
    const overview = items.find((i) => i.type === "ai_overview");
    if (!overview) return { text: "", citations: [] };
    const parts: any[] = overview.items ?? [];
    const text =
      overview.markdown ??
      parts.map((p) => [p.title, p.text ?? p.markdown].filter(Boolean).join("\n")).join("\n\n");
    const refs: any[] = [...(overview.references ?? []), ...parts.flatMap((p) => p.references ?? [])];
    const citations: Citation[] = refs.filter((r) => r?.url).map((r) => ({ url: r.url, title: r.title ?? r.source ?? r.domain }));
    return { text: text ?? "", citations };
  },
};
