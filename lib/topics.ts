import { COUNTRY_CODES, type CountryCode } from "./countries";
import { hasDataForSeo, keywordVolumes } from "./dataforseo";
import { config, requireEnv } from "./env";
import { postJson } from "./http";
import { clearCache } from "./cache";
import { db } from "./supabase";

export const INTENTS = ["informational", "commercial", "transactional", "navigational"] as const;
export type Intent = (typeof INTENTS)[number];

const schema = {
  name: "topic_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["topics", "questions"],
    properties: {
      topics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "keyword"],
          properties: { name: { type: "string" }, keyword: { type: "string" } },
        },
      },
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "topic", "intent"],
          properties: {
            index: { type: "integer" },
            topic: { type: "string" },
            intent: { type: "string", enum: [...INTENTS] },
          },
        },
      },
    },
  },
};

const INSTRUCTIONS = [
  "You group a business's customer questions into topics, like an SEO tool does.",
  "topics: 3 to 6 topics. name: 2-5 words in Title Case (e.g. 'White Label SEO Services').",
  "keyword: the short search phrase people would type for that topic (e.g. 'white label seo'), lowercase, 2-4 words, no brand names.",
  "questions: one entry per question, using its index, the topic name exactly as listed, and its search intent:",
  "informational (wants to learn), commercial (comparing options), transactional (ready to buy or hire), navigational (looking for a specific brand).",
].join("\n");

// Gives every question of the brand a topic and an intent (once; new questions get one later).
export async function ensureTopics(brandId: string) {
  const { data: prompts, error } = await db().from("prompts").select("id, text, topic").eq("brand_id", brandId).order("created_at");
  if (error) throw error;
  if (!prompts?.length || prompts.every((p) => p.topic)) return;

  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.parser,
      messages: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: prompts.map((p, i) => `${i}. ${p.text}`).join("\n") },
      ],
      response_format: { type: "json_schema", json_schema: schema },
    },
  );
  const plan = JSON.parse(raw.choices[0].message.content) as {
    topics: { name: string; keyword: string }[];
    questions: { index: number; topic: string; intent: string }[];
  };

  const names = new Set(plan.topics.map((t) => t.name));
  await db().from("topics").delete().eq("brand_id", brandId);
  const { error: tErr } = await db()
    .from("topics")
    .insert(plan.topics.map((t) => ({ brand_id: brandId, name: t.name.trim(), keyword: t.keyword.trim().toLowerCase() })));
  if (tErr) throw tErr;
  for (const q of plan.questions) {
    const prompt = prompts[q.index];
    if (!prompt) continue;
    const { error: uErr } = await db()
      .from("prompts")
      .update({ topic: names.has(q.topic) ? q.topic : plan.topics[0]?.name ?? "Other", intent: q.intent })
      .eq("id", prompt.id);
    if (uErr) throw uErr;
  }
}

// Looks up monthly AI search volume for each topic keyword in each country.
// Refreshes at most once every 30 days. Skipped if DataForSEO isn't set up.
export async function ensureVolumes(brandId: string, countries: string[]) {
  if (!hasDataForSeo()) return;
  const { data: topics } = await db().from("topics").select("name, keyword").eq("brand_id", brandId);
  if (!topics?.length) return;
  const { data: existing } = await db().from("topic_volumes").select("topic, country, updated_at").eq("brand_id", brandId);
  const fresh = new Set(
    (existing ?? [])
      .filter((v) => Date.now() - new Date(v.updated_at).getTime() < 30 * 86_400_000)
      .map((v) => `${v.topic}|${v.country}`),
  );

  for (const country of countries.filter((c): c is CountryCode => COUNTRY_CODES.includes(c as CountryCode))) {
    const todo = topics.filter((t) => !fresh.has(`${t.name}|${country}`));
    if (!todo.length) continue;
    const volumes = await keywordVolumes([...new Set(todo.map((t) => t.keyword))], country);
    const byKeyword = new Map(volumes.map((v) => [v.keyword.toLowerCase(), v]));
    const rows = todo.map((t) => {
      const v = byKeyword.get(t.keyword.toLowerCase());
      return {
        brand_id: brandId,
        topic: t.name,
        country,
        volume: v?.volume ?? 0,
        monthly: v?.monthly ?? [],
        source: v?.source ?? null,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await db().from("topic_volumes").upsert(rows);
    if (error) throw error;
  }
  clearCache();
}
