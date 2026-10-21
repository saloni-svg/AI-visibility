import Perplexity from "@perplexity-ai/perplexity_ai";
import { config, requireEnv } from "../env";
import { askedFrom } from "./location";
import type { Citation, Provider } from "./types";

// Uses the Perplexity Agent API (POST /v1/agent). By default it runs a preset,
// which bundles Perplexity's model, system prompt and web_search tool, so the
// answers are close to what Perplexity users see. Setting PERPLEXITY_MODEL
// instead runs that model with the web_search tool switched on.
// The SDK retries 429 and 5xx responses itself (2 retries by default).
let client: Perplexity | undefined;

export const perplexity: Provider = {
  name: "perplexity",
  label: "Perplexity",
  model: config.models.perplexity ?? `preset:${config.perplexityPreset}`,
  requiredEnv: ["PERPLEXITY_API_KEY"],

  async call(prompt, country) {
    const input = askedFrom(prompt, country);
    client ??= new Perplexity({ apiKey: requireEnv("PERPLEXITY_API_KEY") });
    const response = await client.responses.create(
      config.models.perplexity
        ? { model: config.models.perplexity, input, tools: [{ type: "web_search" }] }
        : { preset: config.perplexityPreset, input },
    );
    if (response.status !== "completed") {
      throw new Error(`Perplexity response ${response.status}: ${response.error?.message ?? "no answer"}`);
    }
    return response;
  },

  extract(raw) {
    const cited: Citation[] = []; // URLs the answer links to inline
    const searched: Citation[] = []; // every page web_search returned
    let text = "";
    for (const item of raw?.output ?? []) {
      // Pages the web_search tool returned.
      if (item.type === "search_results") {
        for (const r of item.results ?? []) searched.push({ url: r.url, title: r.title });
      }
      // The answer itself, with inline URL citations when present.
      if (item.type === "message") {
        for (const part of item.content ?? []) {
          if (part.type !== "output_text") continue;
          text += part.text;
          for (const a of part.annotations ?? []) if (a.url) cited.push({ url: a.url, title: a.title });
        }
      }
    }
    text = typeof raw?.output_text === "string" && raw.output_text ? raw.output_text : text;
    // Inline citations first so they get the top positions; the parser drops duplicate URLs.
    return { text, citations: [...cited, ...searched] };
  },
};
