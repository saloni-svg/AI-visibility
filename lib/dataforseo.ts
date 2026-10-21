import { requireEnv } from "./env";
import { postJson } from "./http";
import { COUNTRIES, type CountryCode } from "./countries";

// DataForSEO uses HTTP Basic auth with your API login and password
// (dashboard > API Access), not your website password.
export const hasDataForSeo = () => !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);

// Short timeout and a single retry: DataForSEO must never hold up a check.
// Temporary errors on DataForSEO's side (status 5xxxx) are retried once more.
export async function dataForSeo(path: string, tasks: unknown[], timeoutMs = 60_000, retry = true): Promise<any> {
  const auth = Buffer.from(`${requireEnv("DATAFORSEO_LOGIN")}:${requireEnv("DATAFORSEO_PASSWORD")}`).toString("base64");
  const raw = await postJson(`https://api.dataforseo.com/v3/${path}`, { Authorization: `Basic ${auth}` }, tasks, 1, timeoutMs);
  const task = raw?.tasks?.[0];
  if (task && task.status_code >= 50000 && retry) {
    await new Promise((r) => setTimeout(r, 2000));
    return dataForSeo(path, tasks, timeoutMs, false);
  }
  if (!task || task.status_code >= 40000) throw new Error(`DataForSEO: ${task?.status_message ?? raw?.status_message ?? "no result"}`);
  return raw;
}

export type Volume = { keyword: string; volume: number | null; monthly: { month: string; volume: number }[]; source: "ai" | "google" };

const month = (m: any) => `${m.year}-${String(m.month).padStart(2, "0")}`;

// Monthly AI search volume for keywords in one country. Uses DataForSEO's AI
// keyword data; falls back to Google search volume if that isn't available.
export async function keywordVolumes(keywords: string[], country: CountryCode): Promise<Volume[]> {
  const base = { keywords, location_code: COUNTRIES[country].locationCode, language_code: "en" };
  try {
    const raw = await dataForSeo("ai_optimization/ai_keyword_data/keywords_search_volume/live", [base], 25_000);
    const items: any[] = raw.tasks[0].result?.[0]?.items ?? [];
    if (items.length) {
      return items.map((i) => ({
        keyword: i.keyword,
        volume: i.ai_search_volume ?? null,
        monthly: (i.ai_monthly_searches ?? []).map((m: any) => ({ month: month(m), volume: m.ai_search_volume ?? 0 })),
        source: "ai" as const,
      }));
    }
  } catch (err) {
    console.warn(`AI volume unavailable, using Google volume: ${(err as Error).message}`);
  }
  const raw = await dataForSeo("keywords_data/google_ads/search_volume/live", [base], 25_000);
  return (raw.tasks[0].result ?? []).map((i: any) => ({
    keyword: i.keyword,
    volume: i.search_volume ?? null,
    monthly: (i.monthly_searches ?? []).map((m: any) => ({ month: month(m), volume: m.search_volume ?? 0 })),
    source: "google" as const,
  }));
}

// Checks the login and password, and returns the account balance.
export async function checkDataForSeo(): Promise<{ ok: boolean; message: string }> {
  if (!hasDataForSeo()) return { ok: false, message: "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not set in .env." };
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(15_000),
  });
  const raw: any = await res.json().catch(() => ({}));
  const task = raw?.tasks?.[0];
  if (!res.ok || raw?.status_code >= 40000 || task?.status_code >= 40000) {
    return {
      ok: false,
      message: `DataForSEO rejected the login (${raw?.status_message ?? res.status}). Use the API login and API password from app.dataforseo.com > API Access.`,
    };
  }
  const balance = task?.result?.[0]?.money?.balance;
  return { ok: true, message: `DataForSEO connected${balance !== undefined ? `. Balance: $${balance}` : ""}.` };
}

// ---- Locations (cities, regions) for local tracking ----
export type TrackingLocation = { code: number; name: string; type: string };
const locationCache = new Map<string, Promise<TrackingLocation[]>>();

async function allLocations(country: CountryCode): Promise<TrackingLocation[]> {
  const key = country.toLowerCase();
  if (!locationCache.has(key)) {
    const auth = Buffer.from(`${requireEnv("DATAFORSEO_LOGIN")}:${requireEnv("DATAFORSEO_PASSWORD")}`).toString("base64");
    const load = fetch(`https://api.dataforseo.com/v3/serp/google/locations/${key === "gb" ? "gb" : key}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(30_000),
    })
      .then((r) => r.json())
      .then((raw: any) =>
        ((raw?.tasks?.[0]?.result ?? []) as any[]).map((l) => ({ code: l.location_code, name: l.location_name, type: l.location_type })),
      );
    load.catch(() => locationCache.delete(key));
    locationCache.set(key, load);
  }
  return locationCache.get(key)!;
}

// Cities and regions in a country whose name matches the search, cities first.
export async function searchLocations(country: CountryCode, query: string): Promise<TrackingLocation[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const rank: Record<string, number> = { City: 0, Municipality: 1, Neighborhood: 2, "Postal Code": 3, County: 4, Region: 5, State: 5 };
  return (await allLocations(country))
    .filter((l) => l.name.toLowerCase().split(",")[0].includes(q))
    .sort((a, b) =>
      Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) ||
      (rank[a.type] ?? 9) - (rank[b.type] ?? 9) || a.name.length - b.name.length)
    .slice(0, 12);
}
