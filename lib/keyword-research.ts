import { COUNTRIES, CURRENCIES, type CountryCode } from "./countries";
import { dataForSeo, hasDataForSeo } from "./dataforseo";
import { config, requireEnv } from "./env";
import { postJson } from "./http";
import { db } from "./supabase";

// Keyword Overview: everything about one keyword in one country, from DataForSEO (Google Ads
// volumes, DataForSEO Labs ideas/difficulty/intent, live Google results), plus GPT for keyword
// clusters. Where DataForSEO offers several figures, the one closest to Semrush's is used.
// Saved and reused for 7 days.

export type Idea = { keyword: string; volume: number | null; kd: number | null; cpc: number | null; intent: string | null };
export type SerpRow = {
  position: number; url: string; domain: string; title: string; type: string;
  traffic: number | null; keywords: number | null; rank: number | null; refDomains: number | null; backlinks: number | null;
};
export type Ad = { title: string; description: string; url: string; domain: string };
export type Pla = { title: string; price: string | null; seller: string | null; url: string | null };
export type KeywordReport = {
  keyword: string; country: CountryCode; device: "desktop" | "mobile"; createdAt: string;
  // currency: what cpc values are in (reports saved before this field existed are USD);
  // usdRate: the dollar rate used, so CPCs can be shown in another currency.
  // advertisers: domains seen bidding on the keyword (older reports only).
  volume: number | null; cpc: number | null; currency?: string; usdRate?: number; competition: number | null; advertisers?: number | null; trend: { month: string; volume: number }[];
  globalVolume: number | null; byCountry: { code: string; volume: number }[];
  kd: number | null; intents: string[];
  variations: { total: number; totalVolume: number; items: Idea[] };
  questions: { total: number; totalVolume: number; items: Idea[] };
  clusters: { pillar: string; pages: { title: string; keywords: string[] }[] };
  serp: { results: number | null; features: string[]; rows: SerpRow[]; backlinksAvailable: boolean };
  ads: Ad[]; pla: Pla[];
  problems: string[];
  // Shown instead of empty cards when the data provider doesn't track this keyword.
  notice?: string;
  // Where the metrics came from, shown next to the date.
  source?: string;
};

const QUESTION_WORDS = "how|what|why|which|who|whom|whose|where|when|is|are|can|could|do|does|did|should|will|would|was|were";

const MAX_AGE = 7 * 86_400_000;

export async function getReport(keyword: string, country: CountryCode, device: "desktop" | "mobile", refresh = false): Promise<KeywordReport | null> {
  const kw = keyword.trim().toLowerCase().replace(/\s+/g, " ");
  if (!refresh) {
    const { data } = await db().from("keyword_research").select("data, created_at").eq("keyword", kw).eq("country", country).eq("device", device).maybeSingle();
    if (data && Date.now() - new Date(data.created_at).getTime() < MAX_AGE) return data.data as KeywordReport;
    if (data) return data.data as KeywordReport; // show old data; the page offers "Update metrics"
  }
  return null;
}

export async function buildReport(keyword: string, country: CountryCode, device: "desktop" | "mobile"): Promise<KeywordReport> {
  if (!hasDataForSeo()) throw new Error("Keyword research needs DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env.");
  const kw = keyword.trim().toLowerCase().replace(/\s+/g, " ");
  const loc = { location_code: COUNTRIES[country].locationCode, language_code: "en" };
  const problems: string[] = [];
  const safe = <T,>(label: string, p: Promise<T>, fallback: T) => p.catch((e) => { problems.push(`${label}: ${(e as Error).message}`); return fallback; });

  const [google, serp, rate] = await Promise.all([
    googleData(kw, loc),
    safe("SERP", dataForSeo("serp/google/organic/live/advanced", [{ keyword: kw, ...loc, device, depth: 100 }], 60_000).then((r) => r.tasks[0].result?.[0] ?? null), null),
    usdRate(COUNTRIES[country].currency),
  ]);
  const g = google.local;
  if (!g && google.error) throw new Error(`Couldn't load keyword metrics. ${google.error}`);

  // DataForSEO prices are in USD; saved in the country's currency (USD if the rate is unavailable).
  const currency = rate === null ? "USD" : COUNTRIES[country].currency;
  const money = (usd: number | null | undefined) => (usd === null || usd === undefined ? null : Math.round(usd * (rate ?? 1) * 100) / 100);

  // Volume: Google Ads' 12-month average, already on Google's (and Semrush's) volume steps.
  const volume: number | null = g ? g.search_volume ?? 0 : null;

  // ---- Keyword ideas: variations and questions (both singular and plural forms) ----
  const dedupe = (list: Idea[]) => {
    const seen = new Map<string, Idea>();
    for (const i of list) if (i.keyword !== kw && !seen.has(i.keyword)) seen.set(i.keyword, { ...i, cpc: money(i.cpc) });
    return [...seen.values()].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  };
  const ideas = dedupe(google.ideas);
  const questions = dedupe(google.questions);
  const sum = (l: Idea[]) => l.reduce((s, i) => s + (i.volume ?? 0), 0);
  // The keyword itself counts as one of its variations, as in Semrush.
  const variations = volume !== null
    ? [{ keyword: kw, volume, kd: google.kd, cpc: money(cpcOf(g)), intent: google.intent }, ...ideas].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    : ideas;

  // ---- Global volume: Google's worldwide total, split by each country's clickstream share ----
  const globalVolume = google.world ?? google.split?.search_volume ?? null;
  const byCountry = ((google.split?.country_distribution ?? []) as any[])
    .map((c) => {
      const code = String(c.country_iso_code ?? "").toUpperCase();
      // The selected country shows the same number as the Volume card.
      if (code === country && volume !== null) return { code, volume };
      const share = google.world != null && c.percentage != null ? Math.round((google.world * c.percentage) / 100) : c.search_volume ?? 0;
      return { code, volume: share as number };
    })
    .filter((c) => c.code).sort((a, b) => b.volume - a.volume);

  // ---- SERP ----
  const items: any[] = serp?.items ?? [];
  const organic = items.filter((i) => i.type === "organic").slice(0, 100);
  const urls = organic.map((i) => String(i.url));
  const [traffic, backlinks] = await Promise.all([
    urls.length
      ? safe("Search traffic", dataForSeo("dataforseo_labs/google/bulk_traffic_estimation/live", [{ targets: urls, ...loc, item_types: ["organic"] }], 60_000)
        .then((r) => new Map<string, { etv: number; count: number }>(((r.tasks[0].result?.[0]?.items ?? []) as any[]).map((t) => [t.target, { etv: t.metrics?.organic?.etv ?? 0, count: t.metrics?.organic?.count ?? 0 }]))),
        new Map<string, { etv: number; count: number }>())
      : Promise.resolve(new Map<string, { etv: number; count: number }>()),
    // Page authority, referring domains, backlinks: needs the DataForSEO Backlinks API (a separate subscription).
    urls.length
      ? Promise.all([
          dataForSeo("backlinks/bulk_ranks/live", [{ targets: urls }], 60_000),
          dataForSeo("backlinks/bulk_referring_domains/live", [{ targets: urls }], 60_000),
          dataForSeo("backlinks/bulk_backlinks/live", [{ targets: urls }], 60_000),
        ]).then(([ranks, refs, links]) => {
          const m = new Map<string, { rank: number | null; refDomains: number | null; backlinks: number | null }>();
          const get = (u: string) => m.get(u) ?? m.set(u, { rank: null, refDomains: null, backlinks: null }).get(u)!;
          for (const i of ranks.tasks[0].result?.[0]?.items ?? []) get(i.target).rank = i.rank ?? null;
          for (const i of refs.tasks[0].result?.[0]?.items ?? []) get(i.target).refDomains = i.referring_domains ?? null;
          for (const i of links.tasks[0].result?.[0]?.items ?? []) get(i.target).backlinks = i.backlinks ?? null;
          return m;
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const rows: SerpRow[] = organic.map((i) => {
    const t = traffic.get(String(i.url));
    const b = backlinks?.get(String(i.url));
    return {
      position: i.rank_group, url: i.url, domain: String(i.domain ?? "").replace(/^www\./, ""), title: i.title ?? "", type: "organic",
      traffic: t ? Math.round(t.etv) : null, keywords: t?.count ?? null,
      // Backlinks API "rank" is 0-1000; shown on a 0-100 scale like authority scores.
      rank: b?.rank !== null && b?.rank !== undefined ? Math.round(b.rank / 10) : null, refDomains: b?.refDomains ?? null, backlinks: b?.backlinks ?? null,
    };
  });

  const ads: Ad[] = items.filter((i) => i.type === "paid").slice(0, 10).map((i) => ({
    title: i.title ?? "", description: i.description ?? "", url: i.url ?? "", domain: String(i.domain ?? "").replace(/^www\./, ""),
  }));
  const pla: Pla[] = items.filter((i) => i.type === "google_shopping" || i.type === "popular_products")
    .flatMap((i) => (i.items ?? []).map((p: any) => ({ title: p.title ?? "", price: p.price?.displayed_price ?? (p.price?.current ? `${p.price.currency ?? ""} ${p.price.current}` : null), seller: p.seller ?? p.source ?? null, url: p.url ?? null })))
    .slice(0, 12);

  // ---- Keyword strategy: GPT groups the top variations into subpages under one pillar ----
  const clusters = ideas.length >= 6
    ? await safe("Keyword strategy", clusterIdeas(kw, ideas.slice(0, 80)), { pillar: kw, pages: [] })
    : { pillar: kw, pages: [] };

  const report: KeywordReport = {
    keyword: kw, country, device, createdAt: new Date().toISOString(),
    volume, cpc: money(cpcOf(g)), currency, usdRate: rate ?? 1,
    // Competitive density: ads actually showing on Google for the keyword (0 = none, 1 = a full
    // page of 8), which tracks Semrush's advertiser-based density; Google's competition otherwise.
    competition: serp ? Math.min(1, Math.round((ads.length / 8) * 100) / 100) : g?.competition_index != null ? Math.round(g.competition_index) / 100 : null,
    trend: google.trend,
    globalVolume, byCountry,
    kd: google.kd, intents: [google.intent].filter(Boolean) as string[],
    variations: { total: Math.max(google.ideasTotal + (volume !== null ? 1 : 0), variations.length), totalVolume: sum(variations), items: variations },
    questions: { total: Math.max(google.questionsTotal, questions.length), totalVolume: sum(questions), items: questions },
    clusters,
    serp: {
      results: serp?.se_results_count ?? null,
      features: [...new Set(items.map((i) => String(i.type)).filter((t) => t !== "organic"))],
      rows, backlinksAvailable: !!backlinks,
    },
    ads, pla, problems,
    source: "DataForSEO",
    notice: !volume && !ideas.length
      ? `No search data for "${kw}" in ${COUNTRIES[country].name}: it's searched too rarely to be tracked. Try a shorter or more common phrase.`
      : undefined,
  };
  await db().from("keyword_research").upsert({ keyword: kw, country, device, data: report, created_at: report.createdAt }, { onConflict: "keyword,country,device" });
  return report;
}

// Google Ads volumes plus DataForSEO Labs keyword ideas, questions, intent and difficulty. DataForSEO
// only matches the exact phrase, so the singular/plural form is searched too ("home improvements"
// also finds "home improvement ..."), like Semrush's broad match. CPCs here are in USD.
async function googleData(kw: string, loc: { location_code: number; language_code: string }) {
  const first = (r: any) => r.tasks[0].result?.[0] ?? null;
  const forms = [kw, otherForm(kw)].filter((f, i, a): f is string => !!f && a.indexOf(f) === i);
  const suggestions = (limit: number, filters?: unknown[]) => Promise.all(forms.map((f) =>
    dataForSeo("dataforseo_labs/google/keyword_suggestions/live", [
      { keyword: f, ...loc, include_seed_keyword: f !== kw, limit, order_by: ["keyword_info.search_volume,desc"], ...(filters ? { filters } : {}) },
    ], 60_000).then(first).catch(() => null)));
  let error: string | null = null;
  const [local, world, split, ideaSets, questionSets, intent, kd] = await Promise.all([
    dataForSeo("keywords_data/google_ads/search_volume/live", [{ keywords: [kw], ...loc }], 45_000).then(first).catch((e) => { error = (e as Error).message; return null; }),
    // No location or language = Google's worldwide volume.
    dataForSeo("keywords_data/google_ads/search_volume/live", [{ keywords: [kw] }], 45_000).then(first).catch(() => null),
    // Clickstream data is only used for each country's share; its own totals run far too low.
    dataForSeo("keywords_data/clickstream_data/global_search_volume/live", [{ keywords: [kw] }], 45_000).then((r) => r.tasks[0].result?.[0]?.items?.[0] ?? null).catch(() => null),
    suggestions(1000),
    suggestions(500, [["keyword", "regex", `^(${QUESTION_WORDS})[ ]`]]),
    dataForSeo("dataforseo_labs/google/search_intent/live", [{ keywords: [kw], language_code: "en" }], 45_000)
      .then((r) => r.tasks[0].result?.[0]?.items?.[0] ?? null).catch(() => null),
    dataForSeo("dataforseo_labs/google/bulk_keyword_difficulty/live", [{ keywords: [kw], ...loc }], 45_000)
      .then((r) => r.tasks[0].result?.[0]?.items?.[0]?.keyword_difficulty ?? null).catch(() => null),
  ]);
  const toIdeas = (sets: any[]): Idea[] => sets.flatMap((r) => (r?.items ?? []) as any[]).map((i) => ({
    keyword: i.keyword, volume: i.keyword_info?.search_volume ?? null, kd: i.keyword_properties?.keyword_difficulty ?? null,
    cpc: i.keyword_info?.cpc ?? null, intent: i.search_intent_info?.main_intent ?? null,
  }));
  const total = (sets: any[]) => sets.reduce((s, r) => s + (r?.total_count ?? 0), 0);
  return {
    local, error: error as string | null, world: (world?.search_volume ?? null) as number | null, split,
    // Months Google hasn't published yet come back empty; leave them out rather than show 0.
    trend: ((local?.monthly_searches ?? []) as any[]).filter((x) => x.search_volume != null)
      .map((x) => ({ month: `${x.year}-${String(x.month).padStart(2, "0")}`, volume: x.search_volume as number }))
      .sort((a, b) => a.month.localeCompare(b.month)).slice(-12),
    ideas: toIdeas(ideaSets), ideasTotal: total(ideaSets) as number,
    questions: toIdeas(questionSets), questionsTotal: total(questionSets) as number,
    intent: (intent?.keyword_intent?.label ?? null) as string | null,
    kd: kd as number | null,
  };
}

// The singular/plural twin of the last word: "home improvements" <-> "home improvement".
function otherForm(kw: string): string | null {
  const m = kw.match(/^(.*?)([a-z]+)$/);
  if (!m || m[2].length < 3) return null;
  const [, head, w] = m;
  if (/ies$/.test(w)) return `${head}${w.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(w)) return null; // "glass", "status", "analysis"
  if (/(ches|shes|xes|sses)$/.test(w)) return `${head}${w.slice(0, -2)}`;
  if (/s$/.test(w)) return `${head}${w.slice(0, -1)}`;
  if (/[^aeiou]y$/.test(w)) return `${head}${w.slice(0, -1)}ies`;
  if (/(ch|sh|x)$/.test(w)) return `${head}${w}es`;
  return `${head}${w}s`;
}

// How many units of each currency one US dollar buys (refreshed daily); null if the rates can't be fetched.
export async function usdRates(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(10_000), next: { revalidate: 86_400 } } as RequestInit);
    const rates = (await res.json())?.rates;
    if (!rates) return null;
    return Object.fromEntries(CURRENCIES.filter((c) => typeof rates[c] === "number").map((c) => [c, rates[c] as number]));
  } catch {
    return null;
  }
}

async function usdRate(currency: string): Promise<number | null> {
  if (currency === "USD") return 1;
  return (await usdRates())?.[currency] ?? null;
}

// CPC (USD): Google's low top-of-page bid tracked Semrush's CPC far better than Google's average
// CPC (e.g. "home improvements" UK: low bid $2.33, average $7.37, Semrush 2.47).
const cpcOf = (g: any): number | null => g?.low_top_of_page_bid ?? g?.cpc ?? null;

async function clusterIdeas(seed: string, ideas: Idea[]) {
  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.parser,
      messages: [
        {
          role: "system",
          content: "You plan a content strategy. Group the keywords into 3-6 subpages that sit under one pillar page for the seed keyword. Each subpage gets a short title (a keyword-like phrase) and the keywords it should target. Use only keywords from the list.",
        },
        { role: "user", content: `Seed: ${seed}\nKeywords (volume):\n${ideas.map((i) => `${i.keyword} (${i.volume ?? 0})`).join("\n")}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "clusters", strict: true,
          schema: {
            type: "object", additionalProperties: false, required: ["pages"],
            properties: { pages: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "keywords"], properties: { title: { type: "string" }, keywords: { type: "array", items: { type: "string" } } } } } },
          },
        },
      },
    },
  );
  const { pages } = JSON.parse(raw.choices[0].message.content) as { pages: { title: string; keywords: string[] }[] };
  return { pillar: seed, pages: pages.slice(0, 6) };
}

// Most recently researched keywords (newest first), for "recent searches" and the default view.
export async function recentReports(limit = 8) {
  const { data } = await db().from("keyword_research").select("keyword, country, device, created_at")
    .order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as { keyword: string; country: CountryCode; device: "desktop" | "mobile"; created_at: string }[];
}
