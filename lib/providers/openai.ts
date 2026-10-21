import { config, requireEnv } from "../env";
import { postJson } from "../http";
import { isCountry } from "../countries";
import type { Citation, Provider } from "./types";

// Uses the Responses API with web search on, so answers match what ChatGPT
// users see and include cited URLs.
export const openai: Provider = {
  name: "openai",
  label: "ChatGPT",
  model: config.models.openai,
  requiredEnv: ["OPENAI_API_KEY"],

  // Web search runs as if the user is in `country`.
  call(prompt, country) {
    return postJson(
      "https://api.openai.com/v1/responses",
      { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
      {
        model: this.model,
        input: prompt,
        tools: [{ type: "web_search", ...(isCountry(country) ? { user_location: { type: "approximate", country } } : {}) }],
      },
    );
  },

  extract(raw) {
    let text = "";
    const citations: Citation[] = [];
    for (const item of raw?.output ?? []) {
      if (item.type !== "message") continue;
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        text += part.text;
        for (const a of part.annotations ?? []) {
          if (a.type === "url_citation") citations.push({ url: a.url, title: a.title });
        }
      }
    }
    return { text, citations };
  },
};
