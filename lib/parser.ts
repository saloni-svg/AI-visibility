import { config, requireEnv } from "./env";
import { domainOf, postJson, runPool } from "./http";
import { providerByName, type ProviderName } from "./providers";
import { db } from "./supabase";

export type ParsedAnswer = {
  brands: { name: string; position: number }[];
  cited_urls: string[];
};

// JSON schema the parser model must follow. "strict" makes OpenAI guarantee
// the output matches it, so we never get malformed JSON back.
const schema = {
  name: "answer_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["brands", "cited_urls"],
    properties: {
      brands: {
        type: "array",
        description: "Every brand, company or product mentioned, in order of first appearance.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "position"],
          properties: {
            name: { type: "string" },
            position: { type: "integer", description: "1 = mentioned first, 2 = second, ..." },
          },
        },
      },
      cited_urls: {
        type: "array",
        description: "Every URL or website link that appears in the answer text.",
        items: { type: "string" },
      },
    },
  },
};

// Step 1: ask a cheap model to read one answer and return structured JSON.
export async function extractWithModel(answerText: string, knownNames: string[]): Promise<ParsedAnswer> {
  const instructions = [
    "You extract data from an AI assistant's answer. Return JSON only.",
    "brands: every brand, company, product or tool named in the answer, each listed once,",
    "ordered by where it is FIRST mentioned (position 1 = earliest).",
    "If a brand matches one of these known names, use the known name exactly:",
    knownNames.join(", ") || "(none)",
    "cited_urls: every URL or domain link written in the answer text. Do not invent URLs.",
  ].join("\n");

  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.parser,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: answerText },
      ],
      response_format: { type: "json_schema", json_schema: schema },
    },
  );
  const parsed = JSON.parse(raw.choices[0].message.content) as ParsedAnswer;
  parsed.brands.sort((a, b) => a.position - b.position);
  return parsed;
}

// ---------------------------------------------------------------------------
// Step 2: match names to your brand / competitors and save to the database.

type Entity = { id: string; name: string; domain: string | null; aliases: string[] };
type BrandContext = { brand: Entity; competitors: Entity[] };

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matches(name: string, entity: Pick<Entity, "name" | "domain" | "aliases">): boolean {
  const n = normalize(name);
  const candidates = [entity.name, ...entity.aliases];
  if (entity.domain) candidates.push(entity.domain, entity.domain.split(".")[0]);
  return candidates.some((c) => normalize(c) === n);
}

async function loadBrandContext(brandId: string): Promise<BrandContext> {
  const { data: brand, error } = await db()
    .from("brands")
    .select("id, name, domain, aliases")
    .eq("id", brandId)
    .single();
  if (error) throw error;
  const { data: competitors, error: cErr } = await db()
    .from("competitors")
    .select("id, name, domain, aliases")
    .eq("brand_id", brandId);
  if (cErr) throw cErr;
  return { brand, competitors: competitors ?? [] };
}

type AnswerRow = {
  id: string;
  provider: ProviderName;
  answer_text: string;
  raw_response: unknown;
  prompts: { brand_id: string };
};

async function parseOne(answer: AnswerRow, ctx: BrandContext) {
  // Searches with no Google AI Overview have empty text: nothing to extract.
  if (!answer.answer_text.trim()) {
    const { error } = await db().from("answers").update({ parsed_at: new Date().toISOString() }).eq("id", answer.id);
    if (error) throw error;
    return { mentions: 0, sources: 0 };
  }
  const knownNames = [ctx.brand.name, ...ctx.competitors.map((c) => c.name)];
  const parsed = await extractWithModel(answer.answer_text, knownNames);

  // Clear any earlier results so re-parsing never creates duplicates.
  await db().from("mentions").delete().eq("answer_id", answer.id);
  await db().from("sources").delete().eq("answer_id", answer.id);

  // Mentions: renumber positions 1..n so they are always consecutive.
  const seen = new Set<string>();
  const uniqueBrands = parsed.brands.filter((b) => {
    const key = normalize(b.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const mentionRows = uniqueBrands.map((b, i) => ({
      answer_id: answer.id,
      name: b.name.trim(),
      position: i + 1,
      brand_id: matches(b.name, ctx.brand) ? ctx.brand.id : null,
      competitor_id: ctx.competitors.find((c) => matches(b.name, c))?.id ?? null,
    }));

  // Sources: the provider's own citation list first, then any extra URLs the
  // parser found written in the text.
  const { citations } = providerByName[answer.provider].extract(answer.raw_response);
  const urls = new Map<string, { title?: string; origin: "api" | "text" }>();
  for (const c of citations) if (!urls.has(c.url)) urls.set(c.url, { title: c.title, origin: "api" });
  for (const u of parsed.cited_urls) {
    const url = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    if (domainOf(url) && !urls.has(url)) urls.set(url, { origin: "text" });
  }
  const sourceRows = [...urls].map(([url, s], i) => ({
    answer_id: answer.id,
    url,
    // Gemini uses redirect URLs, so its title holds the real domain.
    domain: answer.provider === "gemini" && s.origin === "api" ? (s.title ?? domainOf(url)) : domainOf(url),
    title: s.title ?? null,
    position: i + 1,
    origin: s.origin,
  }));

  if (mentionRows.length) {
    const { error } = await db().from("mentions").insert(mentionRows);
    if (error) throw error;
  }
  if (sourceRows.length) {
    const { error } = await db().from("sources").insert(sourceRows);
    if (error) throw error;
  }
  const { error } = await db()
    .from("answers")
    .update({ parsed_at: new Date().toISOString() })
    .eq("id", answer.id);
  if (error) throw error;

  return { mentions: mentionRows.length, sources: sourceRows.length };
}

// Parses every successful answer that has not been parsed yet.
// Pass runId to limit to one run, force to re-parse already-parsed answers.
export async function parseAnswers(opts: { runId?: string; force?: boolean; concurrency?: number } = {}) {
  let query = db()
    .from("answers")
    .select("id, provider, answer_text, raw_response, prompts!inner(brand_id)")
    .not("answer_text", "is", null);
  if (opts.runId) query = query.eq("run_id", opts.runId);
  if (!opts.force) query = query.is("parsed_at", null);

  const { data, error } = await query;
  if (error) throw error;
  const answers = (data ?? []) as unknown as AnswerRow[];
  console.log(`Parsing ${answers.length} answers with ${config.models.parser}...`);

  const contexts = new Map<string, Promise<BrandContext>>();
  const getContext = (brandId: string) => {
    if (!contexts.has(brandId)) contexts.set(brandId, loadBrandContext(brandId));
    return contexts.get(brandId)!;
  };

  let done = 0;
  let failed = 0;
  await runPool(answers, opts.concurrency ?? config.concurrency, async (answer) => {
    try {
      const result = await parseOne(answer, await getContext(answer.prompts.brand_id));
      done++;
      console.log(`  parsed ${answer.id} (${answer.provider}): ${result.mentions} brands, ${result.sources} sources`);
    } catch (err) {
      failed++;
      console.error(`  failed to parse ${answer.id}: ${(err as Error).message}`);
    }
  });
  console.log(`Parsing finished: ${done} ok, ${failed} failed.`);
  return { done, failed };
}
