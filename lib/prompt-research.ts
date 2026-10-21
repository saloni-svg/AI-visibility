import { brandKey } from "./brand-key";
import { COUNTRIES, type CountryCode } from "./countries";
import { dataForSeo, hasDataForSeo } from "./dataforseo";
import { config, envInt } from "./env";
import { postJson, runPool } from "./http";
import { db } from "./supabase";

// Prompt Research: the questions people ask AI about a topic, from DataForSEO's LLM Mentions
// database (real Google AI Overview and ChatGPT prompts, with AI search volume, answers, cited
// sources and fan-out queries). GPT only groups the prompts into topics, labels their intent and
// reads brand names out of the answers. Saved and reused for 7 days.

export type Platform = "google" | "chat_gpt";
export type PlatformFilter = "all" | Platform;
// exact: the prompt itself asks about the topic. broad: the prompt or its AI answer mentions it
// (how Semrush counts, so it gives far more prompts, some only loosely related).
export type Match = "exact" | "broad";
export type Intent = "informational" | "navigational" | "commercial" | "transactional" | "task";
export type Relevance = "high" | "medium" | "low";
export const INTENTS: Intent[] = ["informational", "navigational", "commercial", "transactional", "task"];
export const PLATFORM_NAMES: Record<Platform, string> = { google: "Google AI Overviews", chat_gpt: "ChatGPT" };

export type PromptRow = {
  // trend: monthly AI volume for report.months; null where DataForSEO has no figure for that month yet.
  q: string; platform: Platform; model: string; volume: number; trend: (number | null)[];
  topic: number; intent: Intent; brands: string[];
  answer: string; sources: { domain: string; url: string; title: string }[]; fanOut: string[]; lastSeen: string | null;
};
export type TopicRow = { name: string; relevance: Relevance; volume: number; trend: number[]; prompts: number; intents: Record<Intent, number> };
export type BrandRow = { name: string; prompts: number; volume: number; platforms: Platform[] };
export type SourceRow = { domain: string; prompts: number; citations: number; volume: number };
export type PromptReport = {
  topic: string; country: CountryCode; platform: PlatformFilter; match?: Match; language: string; createdAt: string;
  // From DataForSEO's aggregated metrics: every matching prompt, not only the ones listed.
  totals: { prompts: number; volume: number; byPlatform: { platform: Platform; prompts: number; volume: number }[] };
  // Prompts fetched and analysed (the highest-volume ones when there are more).
  analyzed: number;
  months: string[]; trend: number[];
  intents: Record<Intent, number>;
  topics: TopicRow[]; prompts: PromptRow[]; brands: BrandRow[]; sources: SourceRow[];
  // How topics, intent and brands were worked out: "ai" (GPT) or "rules" (no OpenAI key).
  classifier: "ai" | "rules";
  problems: string[];
  // True when the prompt_research table is missing and the report only lives in server memory.
  unsaved?: boolean;
  notice?: string;
};

const MAX_AGE = 7 * 86_400_000;
const debug = (msg: string) => process.env.PROMPT_DEBUG && console.log(`[prompts ${new Date().toISOString().slice(11, 19)}] ${msg}`);
// Prompts fetched per platform, highest AI volume first. DataForSEO charges per row returned.
const LIMIT = () => Math.min(1000, envInt("PROMPT_RESEARCH_LIMIT", 500));
// LLM Mentions has German and French prompts for Germany and France; English everywhere else.
const LANGUAGE: Partial<Record<CountryCode, string>> = { DE: "de", FR: "fr" };

export const cleanTopic = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
export const isPlatformFilter = (p: unknown): p is PlatformFilter => p === "all" || p === "google" || p === "chat_gpt";
export const isMatch = (m: unknown): m is Match => m === "exact" || m === "broad";
// Saved in the platform column: "all" (exact, as reports saved before broad match existed) or "all:broad".
const storeKey = (platform: PlatformFilter, match: Match) => (match === "exact" ? platform : `${platform}:broad`);
const parseKey = (key: string) => ({ platform: key.split(":")[0] as PlatformFilter, match: (key.endsWith(":broad") ? "broad" : "exact") as Match });
// ChatGPT prompts exist only for the United States in English.
export const platformsFor = (country: CountryCode, filter: PlatformFilter): Platform[] =>
  filter === "all" ? (country === "US" ? ["google", "chat_gpt"] : ["google"]) : [filter];

// Until migration 0010 has been run, reports are kept in server memory (lost on restart).
const g = globalThis as unknown as { __promptReports?: Map<string, PromptReport> };
const memory = (g.__promptReports ??= new Map());
const memKey = (topic: string, country: string, platform: string) => `${topic}|${country}|${platform}`;
const isMissingTable = (e: { message?: string; code?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /prompt_research/.test(e.message ?? ""));

export async function getPromptReport(topic: string, country: CountryCode, platform: PlatformFilter, match: Match): Promise<PromptReport | null> {
  const t = cleanTopic(topic);
  const key = storeKey(platform, match);
  const { data, error } = await db().from("prompt_research").select("data, created_at")
    .eq("topic", t).eq("country", country).eq("platform", key).maybeSingle();
  if (error && isMissingTable(error)) return memory.get(memKey(t, country, key)) ?? null;
  return data?.data ? { match: "exact", ...(data.data as PromptReport) } : null; // older than 7 days is still shown; the page offers "Refresh"
}

export const isStale = (r: PromptReport) => Date.now() - new Date(r.createdAt).getTime() > MAX_AGE;

export async function recentPromptReports(limit = 8) {
  const { data, error } = await db().from("prompt_research").select("topic, country, platform, created_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (error && isMissingTable(error)) {
    return [...memory.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
      .map((r) => ({ topic: r.topic, country: r.country, platform: r.platform, match: r.match ?? "exact", created_at: r.createdAt }));
  }
  return ((data ?? []) as { topic: string; country: CountryCode; platform: string; created_at: string }[])
    .map((r) => ({ ...r, ...parseKey(r.platform) }));
}

// Fetches, analyses and saves a fresh report.
export async function buildPromptReport(rawTopic: string, country: CountryCode, filter: PlatformFilter, match: Match): Promise<PromptReport> {
  const report = await computePromptReport(rawTopic, country, filter, match);
  const key = storeKey(filter, match);
  const { error } = await db().from("prompt_research").upsert(
    { topic: report.topic, country, platform: key, data: report, created_at: report.createdAt },
    { onConflict: "topic,country,platform" },
  );
  if (error && isMissingTable(error)) {
    report.unsaved = true;
    memory.set(memKey(report.topic, country, key), report);
  } else if (error) {
    throw new Error(`Couldn't save the report: ${error.message}`);
  }
  return report;
}

export async function computePromptReport(rawTopic: string, country: CountryCode, filter: PlatformFilter, match: Match = "broad"): Promise<PromptReport> {
  if (!hasDataForSeo()) throw new Error("Prompt research needs DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env.");
  const topic = cleanTopic(rawTopic);
  if (topic.length < 2) throw new Error("Enter a topic of at least 2 characters.");
  if (filter === "chat_gpt" && country !== "US") throw new Error("ChatGPT prompts are only available for the United States. Pick Google AI Overviews or the US.");
  const language = LANGUAGE[country] ?? "en";
  const platforms = platformsFor(country, filter);
  const problems: string[] = [];
  const loc = { location_code: COUNTRIES[country].locationCode, language_code: language };
  const target = (scope: "question" | "any") => [{ keyword: topic, search_scope: [scope] }];
  const scope = match === "broad" ? "any" : "question";
  const search = (platform: Platform, sc: "question" | "any") =>
    dataForSeo("ai_optimization/llm_mentions/search_mentions/live", [{ ...loc, target: target(sc), platform, order_by: ["ai_search_volume,desc"], limit: LIMIT() }], 120_000)
      .then((r) => r.tasks[0].result?.[0] ?? null)
      .catch((e) => { problems.push(`${PLATFORM_NAMES[platform]} prompts: ${(e as Error).message}`); return null; });

  // Prompts and aggregated totals for each platform, all at once. Broad match also fetches the
  // prompts that ask about the topic directly, so the closest matches are always analysed even
  // when looser mentions have more volume.
  const fetched = await Promise.all(platforms.map(async (platform) => {
    const [main, direct, metrics] = await Promise.all([
      search(platform, scope),
      match === "broad" ? search(platform, "question") : Promise.resolve(null),
      // internal_list_limit: DataForSEO rejects values above 10 on this endpoint.
      dataForSeo("ai_optimization/llm_mentions/target_metrics/live", [{ ...loc, target: target(scope), platform, internal_list_limit: 10 }], 120_000)
        .then((r) => r.tasks[0].result?.[0]?.aggregated_metrics ?? null)
        .catch((e) => { problems.push(`${PLATFORM_NAMES[platform]} totals (showing the listed prompts only): ${(e as Error).message}`); return null; }),
    ]);
    const items: any[] = [...(direct?.items ?? []), ...(main?.items ?? [])];
    return {
      platform, items,
      prompts: (metrics?.total?.mentions ?? main?.total_count ?? items.length) as number,
      volume: (metrics?.total?.ai_search_volume ?? items.reduce((s, i) => s + (i.ai_search_volume ?? 0), 0)) as number,
    };
  }));
  debug(`fetched ${fetched.map((f) => `${f.platform}=${f.items.length}`).join(" ")}`);
  if (fetched.every((f) => !f.items.length) && problems.length === platforms.length) throw new Error(`Couldn't load prompts. ${problems.join(" ")}`);

  // ---- Months ----
  // Each prompt's 12 monthly figures end when DataForSEO last measured it, so recent months are
  // missing for many prompts. Summing them as 0 would show a fake collapse, so the trend only
  // covers months that at least 80% as many prompts have data for as the best-covered month.
  const ym = (m: any) => `${m.year}-${String(m.month).padStart(2, "0")}`;
  const coverage = new Map<string, number>();
  for (const f of fetched) for (const i of f.items) for (const m of i.monthly_searches ?? []) if (m.search_volume != null) coverage.set(ym(m), (coverage.get(ym(m)) ?? 0) + 1);
  const best = Math.max(0, ...coverage.values());
  const covered = [...coverage.keys()].filter((m) => coverage.get(m)! >= best * 0.8).sort();
  const months = covered.length ? [...coverage.keys()].filter((m) => m >= covered[0] && m <= covered.at(-1)!).sort().slice(-12) : [];
  const monthIndex = new Map(months.map((m, i) => [m, i]));

  // ---- Prompt rows (one per question per platform) ----
  const seen = new Set<string>();
  const rows: (Omit<PromptRow, "topic" | "intent" | "brands"> & { tagged: string[] })[] = [];
  for (const f of fetched) {
    for (const i of f.items) {
      const q = String(i.question ?? "").trim();
      const key = `${f.platform}|${q.toLowerCase()}`;
      if (!q || seen.has(key)) continue;
      seen.add(key);
      const trend: (number | null)[] = months.map(() => null);
      for (const m of i.monthly_searches ?? []) {
        const at = monthIndex.get(ym(m));
        if (at !== undefined && m.search_volume != null) trend[at] = m.search_volume;
      }
      const sources = new Map<string, { domain: string; url: string; title: string }>();
      for (const s of (i.sources ?? []) as any[]) {
        if (!s?.url || sources.has(s.url)) continue;
        sources.set(s.url, { domain: bareDomain(s.domain ?? s.url), url: cleanUrl(s.url), title: s.title ?? s.source_name ?? "" });
      }
      rows.push({
        q, platform: f.platform, model: i.model_name ?? f.platform,
        volume: i.ai_search_volume ?? 0, trend,
        answer: plainText(i.answer ?? "").slice(0, 700),
        sources: [...sources.values()].slice(0, 6),
        fanOut: ((i.fan_out_queries ?? []) as string[]).slice(0, 8),
        lastSeen: i.last_response_at ?? null,
        tagged: ((i.brand_entities ?? []) as any[]).map((b) => String(b?.title ?? "")).filter(Boolean),
      });
    }
  }
  rows.sort((a, b) => b.volume - a.volume);

  // ---- Topics, intent and brands ----
  let classified: { topics: { name: string; relevance: Relevance }[]; perPrompt: { topic: number; intent: Intent; brands: string[] }[] };
  let classifier: "ai" | "rules" = "ai";
  if (!rows.length) {
    classified = { topics: [], perPrompt: [] };
  } else if (process.env.OPENAI_API_KEY) {
    classified = await classifyWithAi(topic, rows).catch((e) => {
      problems.push(`Topic grouping: ${(e as Error).message}`);
      classifier = "rules";
      return classifyWithRules(topic, rows);
    });
  } else {
    classifier = "rules";
    classified = classifyWithRules(topic, rows);
  }

  const prompts: PromptRow[] = rows.map(({ tagged, ...r }, i) => ({
    ...r, topic: classified.perPrompt[i]?.topic ?? 0, intent: classified.perPrompt[i]?.intent ?? ruleIntent(r.q), brands: classified.perPrompt[i]?.brands ?? tagged,
  }));

  // ---- Roll-ups ----
  const zeroIntents = () => Object.fromEntries(INTENTS.map((k) => [k, 0])) as Record<Intent, number>;
  const topicStats = classified.topics.map((t) => ({ ...t, volume: 0, trend: months.map(() => 0), prompts: 0, intents: zeroIntents() }));
  const intents = zeroIntents();
  const brandMap = new Map<string, BrandRow>();
  const sourceMap = new Map<string, SourceRow>();
  const spellings = new Map<string, number>();
  for (const p of prompts) {
    intents[p.intent]++;
    const t = topicStats[p.topic];
    if (t) {
      t.prompts++; t.volume += p.volume; t.intents[p.intent]++;
      p.trend.forEach((v, i) => (t.trend[i] += v ?? 0));
    }
    for (const key of new Set(p.brands.map(brandKey).filter(Boolean))) {
      const b = brandMap.get(key) ?? brandMap.set(key, { name: "", prompts: 0, volume: 0, platforms: [] }).get(key)!;
      b.prompts++; b.volume += p.volume;
      if (!b.platforms.includes(p.platform)) b.platforms.push(p.platform);
    }
    for (const name of p.brands) {
      const k = brandKey(name);
      if (k) spellings.set(`${k}|${name}`, (spellings.get(`${k}|${name}`) ?? 0) + 1);
    }
    const domains = new Map<string, number>();
    for (const s of p.sources) domains.set(s.domain, (domains.get(s.domain) ?? 0) + 1);
    for (const [domain, n] of domains) {
      const s = sourceMap.get(domain) ?? sourceMap.set(domain, { domain, prompts: 0, citations: 0, volume: 0 }).get(domain)!;
      s.prompts++; s.citations += n; s.volume += p.volume;
    }
  }
  // Each brand is shown under its most common spelling.
  for (const [ks, n] of [...spellings].sort((a, b) => b[1] - a[1])) {
    const [k, name] = [ks.slice(0, ks.indexOf("|")), ks.slice(ks.indexOf("|") + 1)];
    const b = brandMap.get(k);
    if (b && !b.name) b.name = name;
  }
  // Topics: drop empty ones, then reindex prompts to match.
  const keep = topicStats.map((t, i) => ({ t, i })).filter(({ t }) => t.prompts > 0);
  const remap = new Map(keep.map(({ i }, j) => [i, j]));
  for (const p of prompts) p.topic = remap.get(p.topic) ?? 0;
  const relRank: Record<Relevance, number> = { high: 0, medium: 1, low: 2 };
  const topics: TopicRow[] = keep.map(({ t }) => t);
  // Sort topics (high relevance first) and point prompts at the new order.
  const order = topics.map((t, i) => ({ t, i })).sort((a, b) => relRank[a.t.relevance] - relRank[b.t.relevance] || b.t.volume - a.t.volume);
  const moved = new Map(order.map(({ i }, j) => [i, j]));
  for (const p of prompts) p.topic = moved.get(p.topic) ?? 0;

  const byPlatform = fetched.map((f) => ({ platform: f.platform, prompts: f.prompts, volume: f.volume }));
  const trend = months.map((_, i) => prompts.reduce((s, p) => s + (p.trend[i] ?? 0), 0));
  const report: PromptReport = {
    topic, country, platform: filter, match, language, createdAt: new Date().toISOString(),
    totals: { prompts: byPlatform.reduce((s, b) => s + b.prompts, 0), volume: byPlatform.reduce((s, b) => s + b.volume, 0), byPlatform },
    analyzed: prompts.length, months, trend, intents,
    topics: order.map(({ t }) => t), prompts,
    brands: [...brandMap.values()].sort((a, b) => b.prompts - a.prompts || b.volume - a.volume),
    sources: [...sourceMap.values()].sort((a, b) => b.prompts - a.prompts || b.volume - a.volume),
    classifier, problems,
    notice: !prompts.length
      ? `No AI prompts mention "${topic}" in ${COUNTRIES[country].name} yet. Try a broader or more common phrase (for example "crm" instead of "crm for dentists").`
      : undefined,
  };
  return report;
}

// ---------- Classification ----------

type Classified = { topics: { name: string; relevance: Relevance }[]; perPrompt: { topic: number; intent: Intent; brands: string[] }[] };

async function chatJson<T>(system: string, user: string, name: string, schema: object): Promise<T> {
  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model: config.models.parser,
      temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    },
    1, 60_000,
  );
  return JSON.parse(raw.choices[0].message.content) as T;
}

// Step 1 names the topics from the top prompts; step 2 sorts every prompt into one of them,
// labels its intent and lists the brands its AI answer names (in parallel batches).
async function classifyWithAi(seed: string, rows: { q: string; volume: number; answer: string; tagged: string[] }[]): Promise<Classified> {
  const sample = rows.slice(0, 500);
  const { topics } = await chatJson<{ topics: { name: string; relevance: Relevance }[] }>(
    `You group AI-assistant prompts into topics for an SEO research tool. Create ${Math.min(6, Math.ceil(rows.length / 3))}-${Math.max(8, Math.min(60, Math.round(rows.length / 12)))} topics that together cover the prompts. ` +
      "Each topic is a specific sub-theme named in 2-6 plain words (no quotes, no numbering), written in the prompts' language. " +
      "Relevance is how useful the topic is to a marketer researching the seed topic: high (people asking about the seed itself, " +
      "e.g. choosing, comparing or understanding it), medium (closely adjacent needs the same marketer would target), low (a different subject " +
      "where the seed only appears in passing, e.g. jobs, courses or definitions when the seed is a kind of business). Be strict: most loosely related topics are low. " +
      "Add one topic named \"Other\" with low relevance only if some prompts fit nothing else.",
    `Seed topic: ${seed}\nPrompts (AI volume):\n${sample.map((r) => `${r.q} (${r.volume})`).join("\n")}`,
    "topics",
    {
      type: "object", additionalProperties: false, required: ["topics"],
      properties: { topics: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "relevance"], properties: { name: { type: "string" }, relevance: { type: "string", enum: ["high", "medium", "low"] } } } } },
    },
  );
  if (!topics.length) throw new Error("no topics returned");
  debug(`${topics.length} topics named`);
  const list = topics.slice(0, 60);
  const perPrompt: Classified["perPrompt"] = rows.map((r) => ({ topic: -1, intent: ruleIntent(r.q), brands: r.tagged }));

  const BATCH = 60;
  const batches = Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, b) => b);
  let failed = 0;
  await runPool(batches, 8, async (b) => {
    const slice = rows.slice(b * BATCH, (b + 1) * BATCH);
    // A failed batch keeps the rule-based intent and DataForSEO's brand tags for its prompts.
    const out = await chatJson<{ items: { i: number; topic: number; intent: Intent; brands: string[] }[] }>(
      "For each prompt return: topic (the index of the best-fitting topic), intent and brands.\n" +
        "Intent: informational (wants to learn or understand), navigational (wants a specific site, brand, login or page), " +
        "commercial (comparing or evaluating options: best, top, vs, reviews, alternatives), transactional (ready to buy, price, sign up, download, order), " +
        "task (asks the AI to do something: write, create, generate, calculate, plan, translate).\n" +
        "Many prompts are short search phrases, not questions. A phrase that names a kind of product, service or provider " +
        "(\"digital marketing company in delhi\", \"crm software\", \"top seo agencies\") is someone looking for options to choose from: commercial. " +
        "Use informational only when the person wants to understand something (what, why, how, meaning, definition, guide).\n" +
        "Brands: companies, products, tools or services the AI answer names (proper names only, e.g. \"HubSpot\", \"Surfer SEO\"). " +
        "Use the brand's common name. Exclude publishers that are only cited as sources, people, places and generic terms. " +
        "Entities tagged by the data provider are listed as hints; keep only real brands. Empty list if none.",
      `Topics:\n${list.map((t, i) => `${i}: ${t.name}`).join("\n")}\n\nPrompts:\n` +
        slice.map((r, j) => `#${j}\nPrompt: ${r.q}\nAnswer: ${r.answer.slice(0, 700).replace(/\s+/g, " ")}${r.tagged.length ? `\nTagged: ${r.tagged.join(", ")}` : ""}`).join("\n\n"),
      "prompts",
      {
        type: "object", additionalProperties: false, required: ["items"],
        properties: {
          items: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["i", "topic", "intent", "brands"],
              properties: { i: { type: "integer" }, topic: { type: "integer" }, intent: { type: "string", enum: INTENTS }, brands: { type: "array", items: { type: "string" } } },
            },
          },
        },
      },
    ).catch((e) => { failed++; debug(`batch ${b + 1} failed: ${(e as Error).message}`); return { items: [] }; });
    debug(`batch ${b + 1}/${batches.length} done`);
    for (const it of out.items) {
      const at = b * BATCH + it.i;
      if (it.i < 0 || it.i >= slice.length) continue;
      // Clear wording signals ("best", "price", "write ...") win over an "informational" guess.
      const rule = ruleIntent(slice[it.i].q);
      perPrompt[at] = {
        topic: it.topic >= 0 && it.topic < list.length ? it.topic : -1,
        intent: it.intent === "informational" && rule !== "informational" ? rule : it.intent,
        brands: [...new Set(it.brands.map((x) => x.trim()).filter((x) => x.length > 1 && x.length < 60))].slice(0, 15),
      };
    }
  });
  if (failed === batches.length) throw new Error("couldn't sort prompts into topics");
  // Prompts left unsorted (a failed batch or an invalid topic) are grouped on their own.
  if (perPrompt.some((p) => p.topic < 0)) {
    list.push({ name: "Unsorted prompts", relevance: "low" });
    for (const p of perPrompt) if (p.topic < 0) p.topic = list.length - 1;
  }
  return { topics: list, perPrompt };
}

// Without an OpenAI key: one topic per leading question word, intent from keywords, brands
// only where DataForSEO tagged them.
function classifyWithRules(seed: string, rows: { q: string; tagged: string[] }[]): Classified {
  const lead = (q: string) => (q.match(/^(how|what|why|which|who|where|when|is|are|can|does|do|should|best|top)\b/i)?.[1] ?? "other").toLowerCase();
  const names = [...new Set(rows.map((r) => lead(r.q)))];
  return {
    topics: names.map((n) => ({ name: n === "other" ? `Other ${seed} prompts` : `"${n}" questions about ${seed}`, relevance: "high" as Relevance })),
    perPrompt: rows.map((r) => ({ topic: names.indexOf(lead(r.q)), intent: ruleIntent(r.q), brands: r.tagged })),
  };
}

function ruleIntent(q: string): Intent {
  const s = q.toLowerCase();
  if (/^(write|create|make|generate|draft|give me|summari[sz]e|translate|plan|calculate|rewrite|list)\b/.test(s)) return "task";
  if (/\b(buy|price|pricing|cost|cheap|discount|coupon|deal|download|sign up|subscribe|order|free trial|near me)\b/.test(s)) return "transactional";
  if (/\b(best|top|vs|versus|compare|comparison|review|reviews|alternative|alternatives|recommend)\b/.test(s)) return "commercial";
  if (/\b(login|log in|website|official|contact|customer service|phone number|app)\b/.test(s)) return "navigational";
  return "informational";
}

// ---------- Text helpers ----------

const bareDomain = (d: string) => {
  try { return (d.includes("/") ? new URL(d).hostname : d).replace(/^www\./, "").toLowerCase(); } catch { return d.replace(/^www\./, "").toLowerCase(); }
};
// Drops tracking parameters such as ChatGPT's utm_source=chatgpt.com.
const cleanUrl = (u: string) => {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|_bhlid|srsltid)/.test(k)) url.searchParams.delete(k);
    return url.toString();
  } catch { return u; }
};
// Markdown answer to plain text: keeps link text, drops formatting and footnote links.
function plainText(md: string) {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
