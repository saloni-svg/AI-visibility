import { config, requireEnv } from "./env";
import { postJson } from "./http";
import { loadOverview } from "./overview";
import { db } from "./supabase";
import { isIndexed, searchSite } from "./rag/search";

const TABS = ["performing", "topic-opportunities", "cited-sources", "source-opportunities", "cited-pages"];

const schema = {
  name: "next_steps",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["cards"],
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "body", "action", "tab"],
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            action: { type: "string" },
            tab: { type: "string", enum: TABS },
          },
        },
      },
    },
  },
};

const INSTRUCTIONS = [
  "You are an AI-search visibility consultant. Write exactly 3 'What's next?' cards for this brand, from its data.",
  "title: 3-6 words. body: 1-2 short sentences naming the exact topics, websites or competitors from the data.",
  "action: a 2-4 word link label, e.g. 'See topic gaps'. tab: the data tab that backs the card up.",
  "Be specific and practical: content to create, websites to get listed on, pages to improve. No generic advice.",
  "When closestSiteSections is given, name the exact page (URL) to change and what to add to it.",
].join("\n");

// Writes the "What's next?" cards for one run and saves them.
export async function generateInsights(brandId: string, runId: string) {
  const { data: brand } = await db().from("brands").select("domain").eq("id", brandId).single();
  if (!brand?.domain) return;
  const o = await loadOverview({ domain: brand.domain, runId, country: "all", platform: "all" });
  if (o.state !== "ok") return;

  const summary = {
    brand: o.brand.name,
    domain: o.brand.domain,
    score: o.score,
    note: o.scoreNote,
    mentions: o.metrics.mentions.value,
    citations: o.metrics.citations.value,
    bySource: o.distribution.filter((d) => d.available).map((d) => ({ source: d.label, mentions: d.mentions, answers: d.answers })),
    topicsWhereMissing: o.topicOpportunities.slice(0, 6).map((t) => ({ topic: t.name, volume: t.volume?.volume ?? null, brandsNamedInstead: t.topBrands })),
    topicsWherePresent: o.performingTopics.slice(0, 6).map((t) => ({ topic: t.name, visibility: t.visibility })),
    sitesCitingOthersNotYou: o.sourceOpportunities.slice(0, 8),
    yourCitedPages: o.citedPages.slice(0, 5),
  };

  // Retrieval: the site's own sections closest to the top missing topics, so the
  // cards can point at real pages instead of giving generic advice.
  if (await isIndexed(brandId)) {
    const topics = o.topicOpportunities.slice(0, 3).map((t) => t.name);
    (summary as Record<string, unknown>).closestSiteSections = await Promise.all(
      topics.map(async (t) => ({
        topic: t,
        sections: (await searchSite(brandId, t, 2)).map((m) => ({ url: m.url, heading: m.heading, text: m.content.slice(0, 400) })),
      })),
    );
  }

  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.parser,
      messages: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: JSON.stringify(summary) },
      ],
      response_format: { type: "json_schema", json_schema: schema },
    },
  );
  const { cards } = JSON.parse(raw.choices[0].message.content);
  const { error } = await db().from("brand_insights").upsert({ brand_id: brandId, run_id: runId, insights: cards.slice(0, 3) });
  if (error) throw error;
}
