import { requireEnv } from "./env";

// Keyword.com rank tracker (SERP Tracker API v2). Keyword.com checks every tracked keyword
// on Google daily by itself; we read its latest data. Auth: the account's master API token
// (Keyword.com > Settings > Account). Docs: https://keyword.com/docs/serp-api/
export const hasKeywordCom = () => !!process.env.KEYWORDCOM_API_TOKEN;

// Google region per country, as Keyword.com names them.
export const KC_REGIONS: Record<string, string> = {
  US: "google.com", GB: "google.co.uk", IN: "google.co.in", AU: "google.com.au", CA: "google.ca",
  AE: "google.ae", SG: "google.com.sg", DE: "google.de", FR: "google.fr",
};

// Rate limits are per token: 60 requests/minute (30 for competitor history). Calls are
// queued and spaced out in the order made; "too many requests", server and network errors
// are retried with backoff.
let nextSlot = 0;
async function waitTurn(gapMs: number) {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gapMs;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const BACKOFF = [2000, 4000, 8000, 16000];

async function kc(path: string, init: { method?: string; body?: unknown; gapMs?: number } = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    await waitTurn(init.gapMs ?? 1100);
    let status = 0;
    let data: any = null;
    try {
      const res = await fetch(`https://app.keyword.com/api/v2/${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${requireEnv("KEYWORDCOM_API_TOKEN")}`, Accept: "application/json", "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(45_000),
      });
      status = res.status;
      const text = await res.text();
      try { data = JSON.parse(text); } catch { /* empty or HTML body */ }
      if (res.ok) return data;
    } catch (err) {
      data = { errors: [{ detail: (err as Error).message }] }; // network error or timeout
    }
    if ((status === 0 || status === 429 || status >= 500) && attempt < BACKOFF.length) {
      await new Promise((r) => setTimeout(r, BACKOFF[attempt]));
      continue;
    }
    const e = data?.errors?.[0];
    throw new Error(`Keyword.com: ${e?.detail ?? e?.message ?? e?.title ?? `HTTP ${status}`}`);
  }
}

const bareDomain = (d: string | null | undefined) => String(d ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

// The Keyword.com project tracking this domain: the one named after the domain if there is one,
// otherwise the first whose tracked site is the domain. Creates one (named after the domain) if none.
export async function ensureProject(domain: string): Promise<string> {
  const d = bareDomain(domain);
  const { data } = await kc("groups/active");
  const groups = (data ?? []) as { id: string; attributes: { name: string; url: string | null } }[];
  const match = groups.find((g) => g.id.toLowerCase() === d) ?? groups.find((g) => bareDomain(g.attributes.url) === d);
  if (match) return match.id;
  const created = await kc("groups", { method: "POST", body: { data: { type: "group", attributes: { category: d, currency_code: "USD" } } } });
  return created?.data?.id ?? d;
}

export type KcKeyword = {
  id: string; kw: string; region: string; near: string | null; type: string;
  grank: number | null; rankingurl: string | null; ms: number | null; cpc: number | null;
  serp_features: Record<string, number> | null; in_local_pack: boolean;
  search_intents: Record<string, number> | null; ranking_date: string | null;
};

export async function listKeywords(project: string): Promise<KcKeyword[]> {
  const out: KcKeyword[] = [];
  for (let page = 1; ; page++) {
    const r = await kc(`groups/${encodeURIComponent(project)}/keywords?per_page=250&page=${page}`);
    for (const k of r?.data ?? []) out.push({ id: String(k.id), ...k.attributes });
    if (page >= (r?.meta?.pagination?.total_pages ?? 1)) return out;
  }
}

// Adds keywords to the project (desktop, organic rank). `near` tracks from a city.
export async function addKeywords(project: string, domain: string, region: string, near: string | null, keywords: string[]) {
  for (let i = 0; i < keywords.length; i += 100) {
    const data = keywords.slice(i, i + 100).map((kw) => ({
      type: "keyword",
      attributes: {
        category: project, url: bareDomain(domain), region, language: "en", kw: kw.slice(0, 150), type: "se",
        ignore_local: true, source: 1, tags: [], url_tracking_method: "broad", ...(near ? { near } : {}),
      },
    }));
    await kc(`groups/${encodeURIComponent(project)}/keywords`, { method: "POST", body: { data } });
  }
}

export type KcResult = { rank: number; url: string; title: string; type: string };

// The top 100 Google results from Keyword.com's latest check of a keyword. Keywords on a weekly
// schedule were last checked up to 7 days ago, so the range starts at that check's date.
export async function topResults(project: string, keywordId: string, rankingDate: string | null): Promise<KcResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const from = rankingDate && rankingDate <= today ? rankingDate.slice(0, 10) : new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const r = await kc(`metrics/${encodeURIComponent(project)}/competitors/${keywordId}/history?dateRange=${from}.${today}`, { gapMs: 2100 });
  const latest = (r?.data ?? []).at(-1);
  return ((latest?.results ?? []) as any[]).map((x) => ({ rank: x.rank, url: x.url, title: x.title ?? "", type: x.result_type ?? x.resultType ?? "organic" }));
}

// Keyword.com SERP feature names -> the names the app uses. A value of 1 means the tracked site
// appears in that feature; 0 means the feature is on the page without it.
export const KC_FEATURES: Record<string, string> = {
  ai: "ai_overview", ppl_also_ask: "people_also_ask", video: "video", reviews: "reviews", ads: "paid",
  site_links: "sitelinks", local_pack: "local_pack", featured: "featured_snippet", images: "images",
  knowledge_panel: "knowledge_graph", news: "top_stories", shopping: "shopping",
};
