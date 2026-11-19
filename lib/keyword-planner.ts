import { hasGoogleOAuth, tokenRequest } from "./google-business";
import { db } from "./supabase";

// Google Keyword Planner figures: search volume (12-month average and each month) and average CPC,
// straight from our own Google Ads API access (KeywordPlanIdeaService, Basic access). Used for every
// volume and CPC in the app; never DataForSEO. Everything else (difficulty, intent, SERP, backlinks,
// AI volume) stays on DataForSEO. Not connected = volume and CPC are left blank.
// Setup (.env): GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID (the Google Ads account to
// plan with), optional GOOGLE_ADS_LOGIN_CUSTOMER_ID (its manager account), plus one Google sign-in
// from the app (stored in google_ads_auth) or GOOGLE_ADS_REFRESH_TOKEN.
// Location ids are Google's geo target ids, the same ids DataForSEO uses (2840 = United States).

export const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const VERSION = () => process.env.GOOGLE_ADS_API_VERSION || "v26";
const digits = (s?: string) => (s ?? "").replace(/\D/g, "");

export const keywordPlannerConfigured = () =>
  !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && digits(process.env.GOOGLE_ADS_CUSTOMER_ID) && hasGoogleOAuth());

async function storedLogin(): Promise<{ token: string; email: string | null } | null> {
  if (process.env.GOOGLE_ADS_REFRESH_TOKEN) return { token: process.env.GOOGLE_ADS_REFRESH_TOKEN, email: null };
  const { data } = await db().from("google_ads_auth").select("refresh_token, google_email").eq("id", 1).maybeSingle();
  return data ? { token: data.refresh_token as string, email: (data.google_email as string) ?? null } : null;
}

// What the pages show: whether Keyword Planner is set up and signed in.
export async function plannerStatus() {
  const configured = keywordPlannerConfigured();
  const login = configured ? await storedLogin().catch(() => null) : null;
  return { configured, connected: !!login, email: login?.email ?? null };
}

// Our own Google Ads API connection can be used right now (keys set and signed in).
export const plannerReady = async () => (await plannerStatus()).connected;

// Where volume and CPC come from: only Google Keyword Planner through our own Google Ads API
// connection (null = not connected, so volume and CPC are left blank).
export async function metricsSource(): Promise<"google_ads" | null> {
  return (await plannerReady().catch(() => false)) ? "google_ads" : null;
}

export async function saveAdsLogin(code: string, redirect: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirect });
  if (!String(t.scope ?? "").split(" ").includes(ADS_SCOPE)) {
    throw new Error("Google didn't grant access to Google Ads. Connect again and allow \"See, edit, create and delete your Google Ads accounts and data\".");
  }
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token. Remove the app's access at myaccount.google.com/connections and connect again.");
  let email: string | null = null;
  try { email = JSON.parse(Buffer.from(t.id_token!.split(".")[1], "base64url").toString()).email ?? null; } catch { /* no id token */ }
  const { error } = await db().from("google_ads_auth").upsert({ id: 1, google_email: email, refresh_token: t.refresh_token, created_at: new Date().toISOString() });
  if (error) throw error;
  access = null;
  results.clear();
}

export async function disconnectAds() {
  await db().from("google_ads_auth").delete().eq("id", 1);
  access = null;
}

let access: { token: string; until: number } | null = null;
async function accessToken() {
  if (access && access.until > Date.now()) return access.token;
  const login = await storedLogin();
  if (!login) throw new Error("Connect Google Ads first (Keyword Planner).");
  const t = await tokenRequest({ refresh_token: login.token, grant_type: "refresh_token" }).catch((e) => {
    // A network hiccup (fetch failed) isn't a broken sign-in; only Google refusing the token is.
    if (e instanceof TypeError) throw new Error("Couldn't reach Google. Reload the page in a minute.");
    throw new Error(`${(e as Error).message}. Connect Google Ads again.`);
  });
  access = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
  return access.token;
}

// One Google Ads API call. Keyword Planner allows about one request a second, so calls are spaced
// out and "too many requests" is retried with backoff.
let nextSlot = 0;
async function ads(path: string, body: unknown): Promise<any> {
  const customer = digits(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const login = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  for (const wait of [0, 3000, 8000, 20000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const at = Math.max(Date.now(), nextSlot);
    nextSlot = at + 1100;
    if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
    const res = await fetch(`https://googleads.googleapis.com/${VERSION()}/customers/${customer}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        ...(login ? { "login-customer-id": login } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status === 429 || data?.error?.status === "RESOURCE_EXHAUSTED") continue;
    const detail = data?.error?.details?.[0]?.errors?.[0];
    const msg = detail?.message ?? data?.error?.message ?? `HTTP ${res.status}`;
    if (/test accounts|explorer|access level|not (yet )?approved|basic access/i.test(msg)) {
      throw new Error(`Google Ads: your developer token's access level doesn't include Keyword Planner (it needs Basic access). Check Google Cloud Console → Google Ads API → Access levels. Google said: ${msg}`);
    }
    throw new Error(`Google Ads: ${msg}`);
  }
  throw new Error("Google Ads: too many requests. Try again in a minute.");
}

// CPCs come in the Google Ads account's currency; the app stores USD (converted at today's rate).
let money: { currency: string; perUsd: number; until: number } | null = null;
async function toUsdRate(): Promise<{ currency: string; perUsd: number }> {
  if (money && money.until > Date.now()) return money;
  const r = await ads("/googleAds:search", { query: "SELECT customer.currency_code FROM customer LIMIT 1" });
  const currency = String(r?.results?.[0]?.customer?.currencyCode ?? "USD");
  let perUsd = 1;
  if (currency !== "USD") {
    const rates = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(10_000) }).then((x) => x.json()).then((x) => x?.rates).catch(() => null);
    if (typeof rates?.[currency] !== "number") throw new Error(`Couldn't convert CPCs from ${currency} to USD (exchange rate unavailable).`);
    perUsd = rates[currency];
  }
  money = { currency, perUsd, until: Date.now() + 86_400_000 };
  return money;
}

export type PlannerMetrics = {
  volume: number;            // average monthly searches, last 12 months
  cpc: number | null;        // average CPC, USD
  lowBid: number | null;     // top-of-page bid, low range (USD)
  highBid: number | null;    // top-of-page bid, high range (USD)
  competition: number | null; // 0-100
  trend: { month: string; volume: number }[]; // "2026-09"
};

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
// Lower case, single spaces, and no invisible characters (zero-width spaces, soft hyphens, control
// characters), which sneak in when keywords are pasted and make Google reject the whole request.
export const plannerKey = (k: string) =>
  k.normalize("NFKC").replace(/[\p{Cf}\p{Cc}]/gu, " ").trim().toLowerCase().replace(/\s+/g, " ");
const norm = plannerKey;
// Keyword Planner rejects keywords longer than 80 characters or 10 words, and some symbols.
const plannable = (k: string) => k.length > 0 && k.length <= 80 && k.split(" ").length <= 10 && !/[!@%^*()=<>{};:\\|?]/.test(k);

// Results are kept for a day (Keyword Planner data changes monthly).
const results = new Map<string, { at: number; m: PlannerMetrics }>();
const DAY = 86_400_000;

// Volume and CPC for each keyword in one location (null = worldwide), keyed by lower-case keyword.
// Keyword Planner groups close variants ("seo agency" / "seo agencies"); each gets the group's figures.
export async function keywordMetrics(keywords: string[], locationCode: number | null): Promise<Map<string, PlannerMetrics>> {
  const source = await metricsSource();
  if (!source) throw new Error("Connect Google Ads (Keyword Planner) to get search volume and CPC.");
  const out = new Map<string, PlannerMetrics>();
  const key = (k: string) => `${source}|${locationCode ?? "world"}|${k}`;
  const missing: string[] = [];
  for (const k of new Set(keywords.map(norm).filter(plannable))) {
    const hit = results.get(key(k));
    if (hit && Date.now() - hit.at < DAY) out.set(k, hit.m);
    else missing.push(k);
  }
  if (!missing.length) return out;
  const fetched = await fromGoogleAds(missing, locationCode);
  for (const k of missing) {
    // Asked but not returned: Keyword Planner has no searches for it.
    const m = fetched.get(k) ?? { volume: 0, cpc: null, lowBid: null, highBid: null, competition: null, trend: [] };
    results.set(key(k), { at: Date.now(), m });
    out.set(k, m);
  }
  return out;
}

const monthKey = (year: unknown, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// Our own Google Ads API access (KeywordPlanIdeaService). Prices come in the account's currency.
async function fromGoogleAds(missing: string[], locationCode: number | null) {
  const found = new Map<string, PlannerMetrics>();
  const { perUsd } = await toUsdRate();
  const usd = (micros: unknown) => (micros == null ? null : Math.round((Number(micros) / 1e6 / perUsd) * 100) / 100);

  for (let i = 0; i < missing.length; i += 1000) {
    const chunk = missing.slice(i, i + 1000);
    const r = await ads(":generateKeywordHistoricalMetrics", {
      keywords: chunk,
      language: "languageConstants/1000", // English
      ...(locationCode ? { geoTargetConstants: [`geoTargetConstants/${locationCode}`] } : {}),
      keywordPlanNetwork: "GOOGLE_SEARCH",
      historicalMetricsOptions: { includeAverageCpc: true },
    });
    for (const res of (r?.results ?? []) as any[]) {
      const m = res.keywordMetrics ?? {};
      const metrics: PlannerMetrics = {
        volume: Number(m.avgMonthlySearches ?? 0),
        cpc: usd(m.averageCpcMicros),
        lowBid: usd(m.lowTopOfPageBidMicros),
        highBid: usd(m.highTopOfPageBidMicros),
        competition: m.competitionIndex != null ? Number(m.competitionIndex) : null,
        trend: ((m.monthlySearchVolumes ?? []) as any[])
          .filter((x) => x.monthlySearches != null && MONTHS.includes(x.month))
          .map((x) => ({ month: monthKey(x.year, MONTHS.indexOf(x.month) + 1), volume: Number(x.monthlySearches) }))
          .sort((a, b) => a.month.localeCompare(b.month)).slice(-12),
      };
      for (const t of [res.text, ...(res.closeVariants ?? [])]) if (t) found.set(norm(String(t)), metrics);
    }
  }
  return found;
}
