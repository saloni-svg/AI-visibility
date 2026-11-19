import { cached } from "./cache";
import { COUNTRIES, countryFlag, countryName, isCountry } from "./countries";
import { keywordMetrics, metricsSource, plannerKey } from "./keyword-planner";
import { KC_REGIONS, listKeywords, projectsForDomain } from "./keywordcom";

// Keyword rank report: every keyword in one Keyword.com project, read live from Keyword.com's
// latest daily check, with its rank change over the last day, week, month and since tracking
// started, start and best rank, ranking page, AI Overview and map pack, all from Keyword.com.
// Search volume and average CPC come from Google Keyword Planner (per country), like the rest of
// the app. Cached for 10 minutes (cleared after a position check).

export type RankPeriod = "day" | "week" | "month" | "life";

export type RankRow = {
  id: string;
  keyword: string;
  location: string;      // "🇨🇦 Canada · Mississauga · Mobile" etc., for display and filtering
  rank: number | null;   // null = not in Google's top 100
  start: number | null;
  best: number | null;
  change: Record<RankPeriod, number | null>; // places gained (+) or lost (−); null = no data
  volume: number | null; // Google Keyword Planner: average monthly searches
  cpc: number | null;    // Google Keyword Planner: average CPC (USD)
  url: string | null;
  checked: string | null; // date of Keyword.com's latest check
  aiOverview: "cited" | "not_cited" | "none";
  localPack: boolean;
};

export type RankReport = {
  projects: { id: string; keywords: number }[];
  project: string | null;
  rows: RankRow[];
  checked: string | null; // most recent check across the project
  metricsSource: string | null; // where volume and CPC came from; null = unavailable
};

// Keyword.com tracking types: Google desktop, Google mobile, Google Maps.
const TYPE_LABEL: Record<string, string> = { se: "", sem: "Mobile", map: "Maps" };
// "L4W 0C2, Mississauga, Ontario, Canada" / "Ahmedabad, Gujarat, India" -> the city.
const cityOf = (near: string | null) => {
  const parts = (near ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 3] : parts[0] ?? "";
};
const REGION_COUNTRY = Object.fromEntries(Object.entries(KC_REGIONS).map(([c, r]) => [r, c]));
const rankOrNull = (n: unknown) => (typeof n === "number" && n > 0 && n <= 100 ? n : null);
const changeOrNull = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null; // "N/A" -> null
};

export function loadRankReport(domain: string, preferred?: string | null): Promise<RankReport> {
  return cached(`rankreport|${domain}|${preferred ?? ""}`, async () => {
    const projects = await projectsForDomain(domain);
    const project = projects.find((p) => p.id === preferred)?.id ?? projects[0]?.id ?? null;
    if (!project) return { projects, project, rows: [], checked: null, metricsSource: null };

    const keywords = await listKeywords(project);
    const rows: RankRow[] = keywords
      .map((k) => {
        const code = REGION_COUNTRY[k.region];
        const place = [code ? `${countryFlag(code)} ${countryName(code)}` : k.region, cityOf(k.near), TYPE_LABEL[k.type] ?? k.type].filter(Boolean).join(" · ");
        const sf = (k.serp_features ?? {}) as Record<string, number>;
        const t = k.trends ?? { day: null, week: null, month: null, life: null };
        return {
          id: k.id,
          keyword: k.kw,
          location: place,
          rank: rankOrNull(k.grank),
          start: rankOrNull(k.start),
          best: rankOrNull(k.best),
          change: { day: changeOrNull(t.day), week: changeOrNull(t.week), month: changeOrNull(t.month), life: changeOrNull(t.life) },
          volume: null,
          cpc: null,
          url: k.rankingurl && /^https?:/.test(k.rankingurl) ? k.rankingurl : null,
          checked: k.ranking_date?.slice(0, 10) ?? null,
          aiOverview: sf.ai === 1 ? "cited" : "ai" in sf ? "not_cited" : "none",
          localPack: !!k.in_local_pack || sf.local_pack === 1,
        };
      });
    const checked = rows.reduce<string | null>((m, r) => (r.checked && (!m || r.checked > m) ? r.checked : m), null);

    // Search volume and average CPC from Google Keyword Planner, one lookup per country.
    let metricsFrom: string | null = null;
    const source = await metricsSource();
    if (source) {
      try {
        const byCountry = new Map<string, number[]>();
        keywords.forEach((k, i) => {
          const code = REGION_COUNTRY[k.region];
          if (code && isCountry(code)) byCountry.set(code, [...(byCountry.get(code) ?? []), i]);
        });
        for (const [code, idx] of byCountry) {
          const m = await keywordMetrics(idx.map((i) => rows[i].keyword), COUNTRIES[code as keyof typeof COUNTRIES].locationCode);
          for (const i of idx) {
            const v = m.get(plannerKey(rows[i].keyword));
            if (v) { rows[i].volume = v.volume; rows[i].cpc = v.cpc; }
          }
        }
        metricsFrom = "Google Keyword Planner";
      } catch (e) {
        console.error(`Rank report volume & CPC: ${(e as Error).message}`);
      }
    }
    return { projects, project, rows, checked, metricsSource: metricsFrom };
  });
}
