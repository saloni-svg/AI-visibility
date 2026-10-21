import { clearCache } from "./cache";
import { COUNTRIES, countryFlag, countryName, isCountry } from "./countries";
import { fetchAll, formatRun, matchesDomain } from "./data";
import { domainRoot } from "./domain";
import { extractWithModel, matches, normalize } from "./parser";
import { isReady, providers } from "./providers";
import { dataForSeo, hasDataForSeo } from "./dataforseo";
import { addKeywords as kcAddKeywords, ensureProject, hasKeywordCom, KC_FEATURES, KC_REGIONS, listKeywords as kcListKeywords, topResults as kcTopResults, type KcKeyword } from "./keywordcom";
import { config, requireEnv } from "./env";
import { postJson, runPool } from "./http";
import { isIndexed, searchSite } from "./rag/search";
import { db } from "./supabase";

// Position tracking: for each tracked keyword, where the brand ranks in Google's
// top 100, whether Google shows an AI Overview and cites the brand, and where
// competitors rank. Checked in steps so the app can show progress.
// With KEYWORDCOM_API_TOKEN set, rankings come from Keyword.com (which re-checks every
// keyword daily) and keywords are synced both ways with the brand's Keyword.com project.
// Without it, each check searches Google live through DataForSEO (plus Maps and AI assistants).

const clean = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);

// Share of clicks by Google position (industry average curve), used for Visibility.
const CTR = [0, 0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03, 0.025];
export const ctr = (pos: number | null) => (pos === null ? 0 : pos <= 10 ? CTR[pos] : pos <= 20 ? 0.01 : 0.002);

// ---- Keywords ----
export async function addKeywords(brandId: string, country: string, keywords: string[]) {
  const list = [...new Set(keywords.map(clean).filter((k) => k.length >= 2))].slice(0, 100);
  if (!list.length) return 0;
  const { error } = await db()
    .from("tracked_keywords")
    .upsert(list.map((keyword) => ({ brand_id: brandId, keyword, country, active: true })), { onConflict: "brand_id,keyword,country" });
  if (error) throw error;
  await refreshVolumes(brandId, country).catch((e) => console.error(`Search volume failed: ${e.message}`));
  // Queue them in Keyword.com right away, so they have a position by the next check.
  if (hasKeywordCom()) await syncKeywordCom(brandId, country).catch((e) => console.error(`Keyword.com sync failed: ${e.message}`));
  clearCache();
  return list.length;
}

export async function removeKeyword(brandId: string, keywordId: string) {
  const { error } = await db().from("tracked_keywords").update({ active: false }).eq("id", keywordId).eq("brand_id", brandId);
  if (error) throw error;
  clearCache();
}

// Keyword metrics from DataForSEO, refreshed every 30 days:
//   search volume + CPC (Google Ads data), keyword difficulty and search intent (DataForSEO Labs).
export async function refreshVolumes(brandId: string, country: string): Promise<string[]> {
  const problems: string[] = [];
  if (!hasDataForSeo() || !isCountry(country)) return problems;
  const stale = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await db().from("tracked_keywords").select("id, keyword").eq("brand_id", brandId).eq("country", country)
    .eq("active", true).or(`metrics_at.is.null,metrics_at.lt.${stale}`).limit(700);
  if (!data?.length) return problems;
  const keywords = data.map((d) => d.keyword);
  const loc = { location_code: COUNTRIES[country].locationCode, language_code: "en" };
  const lower = (k: unknown) => String(k).toLowerCase();

  const [ads, kd, intent] = await Promise.all([
    dataForSeo("keywords_data/google_ads/search_volume/live", [{ keywords, ...loc }], 40_000)
      .then((raw) => new Map<string, any>((raw.tasks[0].result ?? []).map((r: any) => [lower(r.keyword), r])))
      .catch((e) => { problems.push(`Search volume & CPC: ${e.message}`); return new Map<string, any>(); }),
    dataForSeo("dataforseo_labs/google/bulk_keyword_difficulty/live", [{ keywords, ...loc }], 40_000)
      .then((raw) => new Map<string, number>((raw.tasks[0].result?.[0]?.items ?? []).map((r: any) => [lower(r.keyword), r.keyword_difficulty])))
      .catch((e) => { problems.push(`Keyword difficulty: ${e.message}`); return new Map<string, number>(); }),
    dataForSeo("dataforseo_labs/google/search_intent/live", [{ keywords, language_code: "en" }], 40_000)
      .then((raw) => new Map<string, any>((raw.tasks[0].result?.[0]?.items ?? []).map((r: any) => [lower(r.keyword), r])))
      .catch((e) => { problems.push(`Search intent: ${e.message}`); return new Map<string, any>(); }),
  ]);

  await runPool(data, 10, async (d) => {
    const k = d.keyword.toLowerCase();
    const a = ads.get(k);
    const i = intent.get(k);
    const update: Record<string, unknown> = problems.length < 3 ? { metrics_at: new Date().toISOString(), volume_at: new Date().toISOString() } : {};
    if (a) {
      update.search_volume = a.search_volume ?? 0;
      update.cpc = a.cpc ?? null;
    }
    if (kd.has(k)) update.keyword_difficulty = kd.get(k) ?? null;
    if (i?.keyword_intent?.label) {
      update.intent = i.keyword_intent.label;
      update.intent_secondary = (i.secondary_keyword_intents ?? []).map((x: any) => x.label).filter(Boolean);
    }
    if (Object.keys(update).length) await db().from("tracked_keywords").update(update).eq("id", d.id);
  });
  clearCache();
  if (problems.length) console.error(`Keyword metrics: ${problems.join(" | ")}`);
  return problems;
}

// Keyword ideas from the brand's tracked questions and topics (GPT, structured output).
export async function suggestKeywords(brandId: string, domain: string, country: string): Promise<string[]> {
  const [{ data: prompts }, { data: topics }, { data: existing }] = await Promise.all([
    db().from("prompts").select("text").eq("brand_id", brandId).limit(40),
    db().from("topics").select("keyword").eq("brand_id", brandId),
    db().from("tracked_keywords").select("keyword").eq("brand_id", brandId).eq("country", country).eq("active", true),
  ]);
  const have = new Set((existing ?? []).map((k) => k.keyword));
  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.parser,
      messages: [
        {
          role: "system",
          content: [
            "You suggest Google keywords to track for a business. Return JSON {\"keywords\": [...]}, 15 keywords.",
            "Short search phrases people actually type (2-5 words, lowercase), not questions. Mix service + location, comparisons and buying terms.",
            `Country: ${countryName(country)}. Don't include the brand's own name. Don't repeat existing keywords.`,
          ].join("\n"),
        },
        {
          role: "user",
          content: `Website: ${domain}\nTopic keywords: ${(topics ?? []).map((t) => t.keyword).join(", ")}\nCustomer questions:\n${(prompts ?? []).map((p) => `- ${p.text}`).join("\n")}\nAlready tracked: ${[...have].join(", ") || "none"}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "keywords", strict: true,
          schema: { type: "object", additionalProperties: false, required: ["keywords"], properties: { keywords: { type: "array", items: { type: "string" } } } },
        },
      },
    },
  );
  const { keywords } = JSON.parse(raw.choices[0].message.content) as { keywords: string[] };
  return [...new Set(keywords.map(clean))].filter((k) => k && !have.has(k)).slice(0, 15);
}

const competitorOf = (c: { name: string; domain: string | null }): Competitor => ({ key: c.domain ?? c.name, domain: c.domain, name: c.name });

// ---- Checking positions ----
export type RunOptions = { maps: boolean; ai: boolean; location?: { code: number; name: string } | null };

// The place to check from: a chosen city, or the whole country.
const locationCode = (country: string, o: RunOptions) => o.location?.code ?? COUNTRIES[country as keyof typeof COUNTRIES]?.locationCode ?? 2840;
const placeName = (country: string, o: RunOptions) => o.location?.name.split(",")[0] ?? COUNTRIES[country as keyof typeof COUNTRIES]?.name ?? "";

export async function setTrackingLocation(brandId: string, country: string, location: { code: number; name: string } | null) {
  const { data } = await db().from("brands").select("tracking_locations").eq("id", brandId).single();
  const all = { ...((data?.tracking_locations as Record<string, unknown>) ?? {}) };
  if (location) all[country] = { code: location.code, name: location.name };
  else delete all[country];
  const { error } = await db().from("brands").update({ tracking_locations: all }).eq("id", brandId);
  if (error) throw error;
  clearCache();
}

// Two-way keyword sync with the brand's Keyword.com project (found by domain, created if missing):
// keywords tracked there for this country are imported; active keywords here that are missing
// there are added. Keywords removed here are left alone in Keyword.com, and keywords removed
// here are not re-imported.
export async function syncKeywordCom(brandId: string, country: string) {
  const region = KC_REGIONS[country];
  if (!region) throw new Error(`Keyword.com tracking isn't set up for ${countryName(country)}.`);
  const { data: b, error } = await db().from("brands").select("domain, tracking_locations").eq("id", brandId).single();
  if (error || !b?.domain) throw new Error("Brand not found.");
  const location = ((b.tracking_locations ?? {}) as Record<string, { name: string }>)[country] ?? null;
  const project = await ensureProject(b.domain);
  const theirs = (await kcListKeywords(project)).filter((k) => k.region === region && k.type === "se");
  const theirSet = new Set(theirs.map((k) => clean(k.kw)));
  const { data: ours } = await db().from("tracked_keywords").select("keyword, active").eq("brand_id", brandId).eq("country", country);
  const known = new Set((ours ?? []).map((k) => k.keyword));
  const imported = [...theirSet].filter((k) => !known.has(k));
  if (imported.length) {
    const { error: e } = await db().from("tracked_keywords")
      .upsert(imported.map((keyword) => ({ brand_id: brandId, keyword, country, active: true })), { onConflict: "brand_id,keyword,country", ignoreDuplicates: true });
    if (e) throw e;
  }
  const missing = (ours ?? []).filter((k) => k.active && !theirSet.has(k.keyword)).map((k) => k.keyword);
  if (missing.length) await kcAddKeywords(project, b.domain, region, location ? location.name.replace(/,\s*/g, ", ") : null, missing);
  if (imported.length) clearCache();
  return { project, region, imported: imported.length, added: missing.length };
}

export async function startPositionRun(brandId: string, country: string, options: RunOptions = { maps: true, ai: true }) {
  if (hasKeywordCom()) {
    const sync = await syncKeywordCom(brandId, country);
    const { count } = await db().from("tracked_keywords").select("id", { count: "exact", head: true })
      .eq("brand_id", brandId).eq("country", country).eq("active", true);
    if (!count) throw new Error("Add some keywords first.");
    await refreshVolumes(brandId, country).catch((e) => console.error(`Keyword metrics failed: ${e.message}`));
    const { data: b } = await db().from("brands").select("tracking_locations").eq("id", brandId).single();
    const location = ((b?.tracking_locations ?? {}) as Record<string, { code: number; name: string }>)[country] ?? null;
    const { data, error } = await db().from("position_runs")
      .insert({ brand_id: brandId, country, options: { maps: false, ai: false, location, source: "keywordcom", project: sync.project, region: sync.region } })
      .select("id").single();
    if (error) throw error;
    return { runId: data.id as string, total: count, imported: sync.imported, added: sync.added };
  }
  if (!hasDataForSeo()) throw new Error("Position tracking needs KEYWORDCOM_API_TOKEN (or DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD) in .env.");
  const { count } = await db().from("tracked_keywords").select("id", { count: "exact", head: true })
    .eq("brand_id", brandId).eq("country", country).eq("active", true);
  if (!count) throw new Error("Add some keywords first.");
  await refreshVolumes(brandId, country).catch((e) => console.error(`Keyword metrics failed: ${e.message}`));
  const { data: b } = await db().from("brands").select("tracking_locations").eq("id", brandId).single();
  const location = ((b?.tracking_locations ?? {}) as Record<string, { code: number; name: string }>)[country] ?? null;
  const { data, error } = await db().from("position_runs").insert({ brand_id: brandId, country, options: { ...options, location } }).select("id").single();
  if (error) throw error;
  return { runId: data.id as string, total: count };
}

// A competitor saved with a domain matches that domain; one saved by name only
// ("ShoutnHike") matches a result whose domain looks like the name (shoutnhike.com).
type Competitor = { key: string; domain: string | null; name: string };
// Words too common to identify a brand on their own ("Digital Infoways" ≠ digital.com).
const GENERIC = new Set(["digital", "marketing", "media", "social", "global", "online", "tech", "technologies", "solutions", "agency", "creative", "smart", "web", "india", "group", "studio", "services", "consulting", "best", "local"]);
const competitorMatches = (c: Competitor, domain: string) => {
  if (c.domain) return matchesDomain(domain, c.domain);
  const n = normalize(c.name);
  const root = normalize(domainRoot(domain));
  // "Elsner Technologies" ↔ elsner.com, "Digital Infoways" ↔ digitalinfoways.com
  return n.length >= 4 && (root === n || (n.length >= 6 && root.includes(n)) || (root.length >= 6 && !GENERIC.has(root) && n.startsWith(root)));
};

// ---- Other platforms ----
type BrandRef = { id: string; domain: string; name: string; aliases: string[] };
const isBrand = (name: string, b: BrandRef) => {
  if (matches(name, { name: b.name, domain: b.domain, aliases: b.aliases })) return true;
  const n = normalize(name), bn = normalize(b.name);
  return bn.length >= 5 && n.includes(bn);
};

// Google Maps: position of the business in the map results (top 20).
async function mapsRank(keyword: string, code: number, b: BrandRef) {
  const raw = await dataForSeo("serp/google/maps/live/advanced", [{ keyword, location_code: code, language_code: "en", depth: 20 }], 45_000);
  const items: any[] = (raw.tasks[0].result?.[0]?.items ?? []).filter((i: any) => i.type === "maps_search");
  const hit = items.find((i) =>
    (i.domain && matchesDomain(String(i.domain).replace(/^www\./, ""), b.domain)) ||
    (i.url && String(i.url).includes(b.domain)) ||
    (i.title && isBrand(String(i.title), b)));
  return { position: hit?.rank_group ?? null, title: hit?.title ?? null };
}

// An AI assistant: ask for recommendations for the keyword, then find where
// the brand is named (1 = first) and whether it links to the brand's site.
async function assistantRank(providerName: string, keyword: string, country: string, place: string, b: BrandRef) {
  const provider = providers.find((p) => p.name === providerName)!;
  const where = place && !keyword.toLowerCase().includes(place.toLowerCase()) ? ` in ${place}` : "";
  const question = `I'm looking for ${keyword}${where}. Which specific businesses or brands do you recommend?`;
  // One retry after a pause if the AI service says "too many requests".
  const raw = await provider.call(question, country).catch(async (e) => {
    if (!/429|rate limit/i.test(String((e as Error).message))) throw e;
    await new Promise((r) => setTimeout(r, 8000));
    return provider.call(question, country);
  });
  const { text, citations } = provider.extract(raw);
  if (!text.trim()) return { position: null, cited: false, top: [] as string[] };
  const parsed = await extractWithModel(text, [b.name]);
  const names = parsed.brands.map((x) => x.name);
  const idx = names.findIndex((n) => isBrand(n, b));
  const cited = [...citations.map((c) => c.url), ...parsed.cited_urls].some((u) => String(u).includes(b.domain));
  return { position: idx >= 0 ? idx + 1 : null, cited, top: names.slice(0, 5) };
}

async function checkKeyword(
  run: { id: string; country: string },
  brand: BrandRef,
  competitors: Competitor[],
  indexed: boolean,
  kw: { id: string; keyword: string },
  options: RunOptions,
) {
  const row: Record<string, unknown> = { run_id: run.id, keyword_id: kw.id, brand_id: brand.id };
  // Maps and AI assistants run alongside the Google check.
  const assistants = options.ai ? providers.filter((p) => p.name !== "ai_overview" && isReady(p)) : [];
  const extra = Promise.all([
    options.maps
      ? mapsRank(kw.keyword, locationCode(run.country, options), brand).catch((e) => ({ position: null, title: null, error: (e as Error).message }))
      : Promise.resolve(null),
    Promise.all(assistants.map(async (p) => [p.name, await assistantRank(p.name, kw.keyword, run.country, placeName(run.country, options), brand)
      .catch((e) => ({ position: null, cited: false, top: [], error: String((e as Error).message).slice(0, 120) }))] as const)),
  ]);
  try {
    // Temporary DataForSEO errors ("Internal SE Server Error"): try up to 3 times.
    let raw: any;
    for (let attempt = 1; ; attempt++) {
      try {
        raw = await dataForSeo("serp/google/organic/live/advanced", [
      {
        keyword: kw.keyword,
        location_code: locationCode(run.country, options),
        language_code: "en",
        device: "desktop",
        depth: 100,
        load_async_ai_overview: true,
      },
    ], 60_000);
        break;
      } catch (e) {
        if (attempt >= 3 || !/internal|server error|timeout|50\d\d\d|temporar/i.test(String((e as Error).message))) throw e;
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    const items: any[] = raw.tasks[0].result?.[0]?.items ?? [];
    const organic = items.filter((i) => i.type === "organic" && i.domain);
    const domainOf = (i: any) => String(i.domain).replace(/^www\./, "");
    const mine = organic.find((i) => matchesDomain(domainOf(i), brand.domain));
    const aio = items.find((i) => i.type === "ai_overview");
    const refs: any[] = aio ? [...(aio.references ?? []), ...(aio.items ?? []).flatMap((p: any) => p.references ?? [])] : [];
    row.position = mine?.rank_group ?? null;
    // Anywhere on the page: regular results plus videos, featured snippets, local pack, etc.
    const isMine = (x: any): boolean =>
      !!x && ((x.domain && matchesDomain(String(x.domain).replace(/^www\./, ""), brand.domain)) || (typeof x.url === "string" && x.url.includes(brand.domain)));
    const anyHit = items.find((i) => isMine(i) || (Array.isArray(i.items) && i.items.some(isMine)));
    row.any_position = anyHit?.rank_absolute ?? null;
    row.any_type = anyHit ? String(anyHit.type) : null;
    row.url = mine?.url ?? null;
    row.serp_features = [...new Set(items.map((i) => String(i.type)).filter((t) => t !== "organic"))];
    row.ai_overview_present = !!aio;
    // Position of the brand among the AI Overview's sources (1 = first source).
    const refDomains = [...new Set(refs.map((r) => String(r?.domain ?? (() => { try { return new URL(r.url).hostname; } catch { return ""; } })()).replace(/^www\./, "")).filter(Boolean))];
    const aioIdx = refDomains.findIndex((d) => matchesDomain(d, brand.domain));
    row.aio_position = aioIdx >= 0 ? aioIdx + 1 : null;
    row.ai_overview_cited = refs.some((r) => r?.domain && matchesDomain(String(r.domain).replace(/^www\./, ""), brand.domain)) ||
      refs.some((r) => r?.url && String(r.url).includes(brand.domain));
    row.competitor_positions = Object.fromEntries(
      competitors.map((c) => [c.key, organic.find((i) => competitorMatches(c, domainOf(i)))?.rank_group ?? null]),
    );
    row.results_count = organic.length;
    // Google's map pack (3 local businesses): matched by website or business name.
    const brandName = normalize(brand.name);
    row.in_local_pack = items.some((i) =>
      (i.type === "local_pack" || i.type === "map") &&
      ((i.domain && matchesDomain(String(i.domain).replace(/^www\./, ""), brand.domain)) ||
        (i.url && String(i.url).includes(brand.domain)) ||
        (brandName.length >= 4 && i.title && normalize(String(i.title)).includes(brandName))),
    );
    row.top_results = organic.slice(0, 10).map((i) => ({ position: i.rank_group, domain: domainOf(i), url: i.url, title: i.title }));
    // Not ranking: retrieve the page of the site that best matches the keyword (RAG search).
    if (!mine && indexed) {
      const [best] = await searchSite(brand.id, kw.keyword, 1);
      if (best) {
        row.suggested_url = best.url;
        row.suggested_similarity = best.similarity;
      }
    }
  } catch (err) {
    row.error = (err as Error).message.slice(0, 300);
  }
  const [maps, ai] = await extra;
  if (maps) {
    row.maps_position = maps.position;
    row.maps_title = maps.title;
  }
  row.platforms = {
    ...Object.fromEntries(ai),
    ...(maps ? { maps: { position: maps.position, cited: false, top: maps.title ? [maps.title] : [], ...("error" in maps ? { error: maps.error } : {}) } } : {}),
  };
  await db().from("keyword_checks").upsert(row, { onConflict: "run_id,keyword_id" });
}

// One keyword from Keyword.com's latest daily check: rank, ranking page, SERP features
// (AI Overview, local pack…) and the top results, which give the competitors' positions.
async function keywordComCheck(
  run: { id: string; project: string },
  brand: BrandRef,
  competitors: Competitor[],
  indexed: boolean,
  kw: { id: string; keyword: string },
  k: KcKeyword | undefined,
) {
  const row: Record<string, unknown> = { run_id: run.id, keyword_id: kw.id, brand_id: brand.id, platforms: {} };
  try {
    if (!k) throw new Error("Not in Keyword.com yet. It's added there on the next check.");
    if (!k.ranking_date) throw new Error("Keyword.com hasn't checked this keyword yet. New keywords usually get their first position within a few hours.");
    const sf = (k.serp_features ?? {}) as Record<string, number>;
    const results = await kcTopResults(run.project, k.id, k.ranking_date).catch(() => []);
    const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
    const organic = results.filter((r) => r.type === "organic" && r.url);
    row.position = k.grank && k.grank > 0 ? k.grank : null;
    row.url = k.rankingurl && /^https?:/.test(k.rankingurl) ? k.rankingurl : null;
    // Not in the regular results: maybe elsewhere on the page (featured snippet, video…).
    const elsewhere = row.position ? null : results.find((r) => r.type !== "organic" && matchesDomain(domainOf(r.url), brand.domain));
    row.any_position = (row.position as number | null) ?? elsewhere?.rank ?? null;
    row.any_type = row.position ? "organic" : elsewhere?.type ?? null;
    row.serp_features = Object.keys(sf).map((f) => KC_FEATURES[f] ?? f);
    row.ai_overview_present = "ai" in sf;
    row.ai_overview_cited = sf.ai === 1;
    row.in_local_pack = !!k.in_local_pack || sf.local_pack === 1;
    row.competitor_positions = Object.fromEntries(competitors.map((c) => [c.key, organic.find((r) => competitorMatches(c, domainOf(r.url)))?.rank ?? null]));
    row.results_count = organic.length;
    row.top_results = organic.slice(0, 10).map((r) => ({ position: r.rank, domain: domainOf(r.url), url: r.url, title: r.title }));
    if (!row.position && indexed) {
      const [best] = await searchSite(brand.id, kw.keyword, 1);
      if (best) {
        row.suggested_url = best.url;
        row.suggested_similarity = best.similarity;
      }
    }
  } catch (err) {
    row.error = (err as Error).message.slice(0, 300);
  }
  await db().from("keyword_checks").upsert(row, { onConflict: "run_id,keyword_id" });
}

export async function positionStep(runId: string, batch = 10) {
  const { data: run, error } = await db().from("position_runs").select("id, brand_id, country, status, options, brands(domain, name, aliases)").eq("id", runId).single();
  if (error) throw error;
  const domain = (run as any).brands?.domain as string;
  const brandName = ((run as any).brands?.name as string) ?? domain;
  const aliases = ((run as any).brands?.aliases as string[]) ?? [];
  const options: RunOptions = { maps: run.options?.maps !== false, ai: run.options?.ai !== false, location: run.options?.location ?? null };
  if (options.ai) batch = Math.min(batch, 4); // AI answers take longer
  const [{ data: keywords }, { data: done }, { data: comps }, indexed] = await Promise.all([
    db().from("tracked_keywords").select("id, keyword").eq("brand_id", run.brand_id).eq("country", run.country).eq("active", true),
    db().from("keyword_checks").select("keyword_id").eq("run_id", runId),
    db().from("competitors").select("name, domain").eq("brand_id", run.brand_id),
    isIndexed(run.brand_id),
  ]);
  const doneIds = new Set((done ?? []).map((d) => d.keyword_id));
  const pending = (keywords ?? []).filter((k) => !doneIds.has(k.id));
  const total = keywords?.length ?? 0;
  if (run.status !== "running") return { status: run.status as string, done: total - pending.length, total };

  const brandRef = { id: run.brand_id, domain, name: brandName, aliases };
  if (run.options?.source === "keywordcom") {
    // Keyword.com: one list call for all keywords, then the top results for each (rate-limited).
    const near = (run.options.location?.name as string | undefined)?.replace(/,\s*/g, ", ") ?? null;
    const byKeyword = new Map<string, KcKeyword>();
    for (const k of await kcListKeywords(run.options.project)) {
      if (k.region !== run.options.region || k.type !== "se") continue;
      const key = clean(k.kw);
      const prev = byKeyword.get(key);
      // Several entries for one keyword (e.g. tracked from different cities): prefer this brand's city, then a checked one.
      if (!prev || (near && k.near === near && prev.near !== near) || (!prev.ranking_date && k.ranking_date)) byKeyword.set(key, k);
    }
    await runPool(pending.slice(0, batch), 2, (kw) =>
      keywordComCheck({ id: run.id, project: run.options.project }, brandRef, (comps ?? []).map(competitorOf), indexed, kw, byKeyword.get(kw.keyword)));
  } else {
    // Fewer at once when asking AI assistants, to stay under their rate limits.
    await runPool(pending.slice(0, batch), options.ai ? 2 : 5, (kw) =>
      checkKeyword(run, brandRef, (comps ?? []).map(competitorOf), indexed, kw, options));
  }
  const remaining = Math.max(0, pending.length - batch);
  if (remaining === 0) {
    // Keyword.com hadn't checked any keyword yet: keep showing the previous results instead.
    const { count: ok } = await db().from("keyword_checks").select("id", { count: "exact", head: true }).eq("run_id", runId).is("error", null);
    const noData = run.options?.source === "keywordcom" && !ok;
    await db().from("position_runs").update({ status: noData ? "failed" : "completed", finished_at: new Date().toISOString() }).eq("id", runId);
    clearCache();
    if (noData) return { status: "no_data", done: total, total };
  }
  return { status: remaining ? "running" : "completed", done: total - remaining, total };
}

// ---- Report ----
type Check = {
  run_id: string; keyword_id: string; position: number | null; url: string | null; serp_features: string[];
  ai_overview_present: boolean; ai_overview_cited: boolean; in_local_pack: boolean; any_position: number | null; any_type: string | null; maps_position: number | null; aio_position: number | null;
  platforms: Record<string, { position: number | null; cited: boolean; top: string[]; error?: string }>; competitor_positions: Record<string, number | null>;
  top_results: { position: number; domain: string; url: string; title: string }[]; suggested_url: string | null;
  suggested_similarity: number | null; error: string | null;
};

export async function loadPositions(brand: { id: string; domain: string; countries: string[] }, country: string, runId?: string) {
  const { data: b } = await db().from("brands").select("tracking_locations").eq("id", brand.id).single();
  const location = ((b?.tracking_locations ?? {}) as Record<string, { code: number; name: string; auto?: boolean }>)[country] ?? null;
  const [{ data: keywords }, { data: runs }, { data: comps }] = await Promise.all([
    db().from("tracked_keywords").select("id, keyword, search_volume, cpc, keyword_difficulty, intent, intent_secondary").eq("brand_id", brand.id).eq("country", country).eq("active", true).order("created_at"),
    db().from("position_runs").select("id, created_at, status").eq("brand_id", brand.id).eq("country", country).eq("status", "completed")
      .order("created_at", { ascending: false }).limit(20),
    db().from("competitors").select("domain, name").eq("brand_id", brand.id),
  ]);
  const runList = (runs ?? []).map((r) => ({ id: r.id, label: formatRun(r.created_at) }));
  const run = runList.find((r) => r.id === runId) ?? runList[0] ?? null;
  const base = {
    countries: brand.countries.map((c) => ({ code: c, name: countryName(c), flag: countryFlag(c) })),
    country,
    location,
    keywordCount: keywords?.length ?? 0,
    runs: runList,
    run,
    competitors: (comps ?? []).map((c) => (c.domain ?? c.name) as string),
  };
  if (!run) return { ...base, rows: [], summary: null, trend: [] };

  const trendRuns = runList.slice(runList.indexOf(run), runList.indexOf(run) + 12).reverse();
  const all = await fetchAll<Check>((from, to) =>
    db().from("keyword_checks")
      .select("id, run_id, keyword_id, position, url, serp_features, ai_overview_present, ai_overview_cited, in_local_pack, any_position, any_type, maps_position, aio_position, platforms, competitor_positions, top_results, suggested_url, suggested_similarity, error")
      .in("run_id", trendRuns.map((r) => r.id)).order("id").range(from, to));
  const kwById = new Map((keywords ?? []).map((k) => [k.id, k]));
  const prevRun = trendRuns.length > 1 ? trendRuns[trendRuns.length - 2] : null;

  const stats = (list: Check[], pos: (c: Check) => number | null) => {
    const n = list.length || 1;
    const positions = list.map(pos);
    const ranked = positions.filter((p): p is number => p !== null);
    return {
      visibility: Math.round((positions.reduce<number>((s, p) => s + ctr(p), 0) / (n * CTR[1])) * 1000) / 10,
      avgPosition: list.length ? Math.round((positions.reduce<number>((s, p) => s + (p ?? 100), 0) / list.length) * 10) / 10 : null,
      traffic: Math.round(list.reduce((s, c, i) => s + ctr(positions[i]) * (kwById.get(c.keyword_id)?.search_volume ?? 0), 0)),
      top3: ranked.filter((p) => p <= 3).length,
      top10: ranked.filter((p) => p <= 10).length,
      top20: ranked.filter((p) => p <= 20).length,
      top100: ranked.length,
    };
  };
  const inRun = (id: string) => all.filter((c) => c.run_id === id && kwById.has(c.keyword_id) && !c.error);
  const current = inRun(run.id);
  const previous = prevRun ? inRun(prevRun.id) : [];

  const summary: {
    you: ReturnType<typeof stats>; prev: ReturnType<typeof stats> | null;
    competitors: ({ domain: string } & ReturnType<typeof stats>)[];
    aiOverview: { present: number; cited: number }; localPack: number; checked: number; errors: number;
    byPlatform: { key: string; label: string; found: number; top3: number; checked: number; avg: number | null }[];
  } = {
    you: stats(current, (c) => c.position),
    prev: prevRun ? stats(previous, (c) => c.position) : null,
    competitors: base.competitors.map((d) => ({ domain: d, ...stats(current, (c) => c.competitor_positions?.[d] ?? null) })),
    aiOverview: { present: current.filter((c) => c.ai_overview_present).length, cited: current.filter((c) => c.ai_overview_cited).length },
    localPack: current.filter((c) => c.in_local_pack).length,
    // How often you're found on each platform (keywords checked on that platform).
    byPlatform: (() => {
      const out: { key: string; label: string; found: number; top3: number; checked: number; avg: number | null }[] = [];
      const add = (key: string, label: string, list: (number | null | undefined)[]) => {
        const checked = list.filter((v) => v !== undefined);
        const ranked = checked.filter((v): v is number => typeof v === "number");
        out.push({ key, label, found: ranked.length, top3: ranked.filter((v) => v <= 3).length, checked: checked.length,
          avg: ranked.length ? Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 10) / 10 : null });
      };
      add("google", "Google", current.map((c) => c.position));
      add("maps", "Google Maps", current.map((c) => (c.platforms?.maps ? c.platforms.maps.position : undefined)));
      // AI Overview: "found" = AI Overviews citing you (Keyword.com reports the citation, not its position).
      const aioRanked = current.map((c) => c.aio_position).filter((v): v is number => typeof v === "number");
      out.push({ key: "ai_overview", label: "AI Overview", found: current.filter((c) => c.ai_overview_cited).length, top3: aioRanked.filter((v) => v <= 3).length,
        checked: current.length, avg: aioRanked.length ? Math.round((aioRanked.reduce((a, b) => a + b, 0) / aioRanked.length) * 10) / 10 : null });
      for (const p of providers.filter((x) => x.name !== "ai_overview")) {
        add(p.name, p.label, current.map((c) => (c.platforms?.[p.name] ? c.platforms[p.name].position : undefined)));
      }
      return out.filter((x) => x.checked > 0);
    })(),
    checked: current.length,
    errors: all.filter((c) => c.run_id === run.id && c.error).length,
  };

  const trend = trendRuns.map((r) => {
    const list = inRun(r.id);
    return {
      label: r.label,
      byProvider: Object.fromEntries([
        ["you", stats(list, (c) => c.position).visibility / 100],
        ...base.competitors.map((d) => [d, stats(list, (c) => c.competitor_positions?.[d] ?? null).visibility / 100]),
      ]),
    };
  });

  const rows = (keywords ?? []).map((k) => {
    const c = current.find((x) => x.keyword_id === k.id);
    const p = previous.find((x) => x.keyword_id === k.id);
    // Checked this run but no data (e.g. Keyword.com hasn't crawled it yet): shown as pending.
    const failed = c ? null : all.find((x) => x.run_id === run.id && x.keyword_id === k.id && x.error);
    const history = trendRuns.map((r) => all.find((x) => x.run_id === r.id && x.keyword_id === k.id)?.position ?? null);
    return {
      id: k.id,
      keyword: k.keyword,
      volume: k.search_volume,
      cpc: k.cpc === null || k.cpc === undefined ? null : Number(k.cpc),
      kd: k.keyword_difficulty ?? null,
      intents: [k.intent, ...(k.intent_secondary ?? [])].filter(Boolean) as string[],
      checked: !!c,
      error: c?.error ?? failed?.error ?? null,
      position: c?.position ?? null,
      previous: p ? p.position : undefined, // undefined = not checked before
      url: c?.url ?? null,
      features: c?.serp_features ?? [],
      localPack: c?.in_local_pack ?? false,
      anyPosition: c?.any_position ?? null,
      anyType: c?.any_type ?? null,
      maps: c?.platforms?.maps ? c.platforms.maps.position : undefined,
      prevMaps: p?.platforms?.maps ? p.platforms.maps.position : undefined,
      aioPosition: c?.aio_position ?? null,
      platforms: c?.platforms ?? {},
      prevPlatforms: p?.platforms ?? null,
      aiOverview: c ? (c.ai_overview_cited ? "cited" : c.ai_overview_present ? "not_cited" : "none") : "none",
      competitors: Object.fromEntries(base.competitors.map((d) => [d, c?.competitor_positions?.[d] ?? null])),
      top: c?.top_results ?? [],
      suggestedUrl: c?.suggested_url ?? null,
      // Monthly visits from Google for this keyword: search volume × click share at your position.
      traffic: c ? Math.round((k.search_volume ?? 0) * ctr(c.position)) : null,
      prevTraffic: p ? Math.round((k.search_volume ?? 0) * ctr(p.position)) : null,
      history,
    };
  });

  return { ...base, rows, summary, trend };
}

export type PositionsData = Awaited<ReturnType<typeof loadPositions>>;
