import { countryFlag, countryName } from "./countries";
import { brandRuns, fetchAll, formatRun, inChunks, matchesDomain } from "./data";
import { normalize } from "./parser";
import { providers as ALL_PROVIDERS, type ProviderName } from "./providers";
import { cached } from "./cache";
import { db } from "./supabase";
import { INTENTS, type Intent } from "./topics";
import { topicVolume, type VolumeRow } from "./volumes";

// Everything the Visibility Overview page shows, for one domain, one run and
// the chosen country / AI source filters. All counting happens here.

export const PLATFORMS = ALL_PROVIDERS.map((p) => ({ value: p.name, label: p.label }));
export type Filters = { domain: string; runId?: string; country: string; platform: string };

type Prompt = { id: string; text: string; type: "branded" | "unbranded"; topic: string | null; intent: Intent | null };
type Answer = { id: string; run_id: string; prompt_id: string; provider: ProviderName; country: string; attempt: number; answer_text: string };
type Mention = { answer_id: string; name: string; position: number; brand_id: string | null; competitor_id: string | null };
type Source = { answer_id: string; url: string; domain: string | null };

// Score weight by where the brand appears in an answer (1 = named first).
const weight = (pos: number | undefined) => (pos === undefined ? 0 : pos === 1 ? 1 : pos === 2 ? 0.85 : pos === 3 ? 0.7 : pos <= 5 ? 0.55 : 0.4);
const scoreOf = (answers: Answer[], positionOf: (a: Answer) => number | undefined) =>
  answers.length ? Math.round((answers.reduce((s, a) => s + weight(positionOf(a)), 0) / answers.length) * 100) : null;

export type Overview = Awaited<ReturnType<typeof loadOverview>>;

// Everything the page needs from the database for one domain and check.
async function fetchOverviewData(domain: string, runId?: string) {
  const supabase = db();
  const { data: brand, error } = await supabase.from("brands").select("id, name, domain, countries").eq("domain", domain).maybeSingle();
  if (error) throw error;
  if (!brand) return { state: "no-brand" as const };

  const [{ data: promptRows }, { data: competitors }, { data: volumeRows }, { data: topicRows }] = await Promise.all([
    supabase.from("prompts").select("id, text, type, topic, intent").eq("brand_id", brand.id),
    supabase.from("competitors").select("id, name").eq("brand_id", brand.id),
    supabase.from("topic_volumes").select("topic, country, volume, monthly, source").eq("brand_id", brand.id),
    supabase.from("topics").select("name, keyword").eq("brand_id", brand.id),
  ]);
  const prompts = new Map(((promptRows ?? []) as Prompt[]).map((p) => [p.id, p]));
  const runRows = await brandRuns([...prompts.keys()]);
  if (!runRows.length) return { state: "no-runs" as const, brand };

  const runs = runRows.map((r) => ({ id: r.id, label: formatRun(r.started_at) }));
  const run = runs.find((r) => r.id === runId) ?? runs[0];
  const at = runs.indexOf(run);
  const trendRuns = runs.slice(at, at + 12).reverse();
  const previousRun = trendRuns.length > 1 ? trendRuns[trendRuns.length - 2] : null;

  // ---- Load answers, mentions and sources for the trend window ----
  const allAnswers = (
    await fetchAll<Answer>((from, to) =>
      supabase.from("answers").select("id, run_id, prompt_id, provider, country, attempt, answer_text")
        .in("run_id", trendRuns.map((r) => r.id)).not("answer_text", "is", null).order("id").range(from, to))
  ).filter((a) => prompts.has(a.prompt_id));
  const ids = allAnswers.map((a) => a.id);
  const [mentions, sources] = await Promise.all([
    inChunks<Mention>(ids, (c) => supabase.from("mentions").select("id, answer_id, name, position, brand_id, competitor_id").in("answer_id", c)),
    inChunks<Source>(ids, (c) => supabase.from("sources").select("id, answer_id, url, domain").in("answer_id", c)),
  ]);

  // Why AI Overview may be missing: the latest error from DataForSEO in this run.
  const [{ data: aioRows }, { data: insightRow }] = await Promise.all([
    supabase.from("answers").select("error").eq("run_id", run.id).eq("provider", "ai_overview"),
    supabase.from("brand_insights").select("insights").eq("brand_id", brand.id).eq("run_id", run.id).maybeSingle(),
  ]);
  return {
    state: "ok" as const,
    brand, prompts, competitors: competitors ?? [], volumeRows: volumeRows ?? [], topicRows: topicRows ?? [],
    runs, run, trendRuns, previousRun, allAnswers, mentions, sources,
    // How many Google AI Overview searches failed in this check, and why.
    aiOverviewErrors: {
      total: aioRows?.length ?? 0,
      failed: (aioRows ?? []).filter((r) => r.error).length,
      message: ((aioRows ?? []).find((r) => r.error)?.error as string | undefined) ?? null,
    },
    insights: (insightRow?.insights ?? null) as Insight[] | null,
  };
}

export async function loadOverview(f: Filters) {
  const data = await cached(`overview|${f.domain}|${f.runId ?? "latest"}`, () => fetchOverviewData(f.domain, f.runId));
  if (data.state !== "ok") return data;
  return buildOverview(data, f);
}

// Calculates every number on the page from loaded data and the filters (no database calls).
function buildOverview(d: Extract<Awaited<ReturnType<typeof fetchOverviewData>>, { state: "ok" }>, f: Filters) {
  const { brand, prompts, competitors, volumeRows, topicRows, runs, run, trendRuns, previousRun, allAnswers, mentions, sources } = d;
  const mentionsBy = new Map<string, Mention[]>();
  for (const m of mentions) mentionsBy.set(m.answer_id, [...(mentionsBy.get(m.answer_id) ?? []), m]);
  const sourcesBy = new Map<string, Source[]>();
  for (const s of sources) sourcesBy.set(s.answer_id, [...(sourcesBy.get(s.answer_id) ?? []), s]);

  const brandPos = (a: Answer) => {
    const own = (mentionsBy.get(a.id) ?? []).filter((m) => m.brand_id === brand.id).map((m) => m.position);
    return own.length ? Math.min(...own) : undefined;
  };
  const mentioned = (a: Answer) => brandPos(a) !== undefined;
  const brandSources = (a: Answer) => (sourcesBy.get(a.id) ?? []).filter((s) => matchesDomain(s.domain, brand.domain));
  const hasText = (a: Answer) => a.answer_text.trim().length > 0;

  // Filters. "all" = worldwide / every AI source.
  const byCountry = (a: Answer) => f.country === "all" || a.country === f.country;
  const byPlatform = (a: Answer) => f.platform === "all" || a.provider === f.platform;
  const inRun = (runId: string) => allAnswers.filter((a) => a.run_id === runId && hasText(a));
  const current = inRun(run.id).filter((a) => byCountry(a) && byPlatform(a));
  // The score uses questions that don't name the brand, when there are any.
  const scoreBase = (list: Answer[]) => {
    const unbranded = list.filter((a) => prompts.get(a.prompt_id)?.type === "unbranded");
    return unbranded.length ? unbranded : list;
  };

  // ---- Headline numbers ----
  const metricsOf = (list: Answer[]) => {
    const pages = list.flatMap((a) => brandSources(a).map((s) => s.url));
    return { mentions: list.filter(mentioned).length, citations: pages.length, citedPages: new Set(pages).size };
  };
  const now = metricsOf(current);
  const prevList = previousRun ? inRun(previousRun.id).filter((a) => byCountry(a) && byPlatform(a)) : [];
  // Scale the previous check to this check's size: a check that asked each question
  // 3 times shouldn't look like a drop next to one that asked once.
  const prevRaw = previousRun && prevList.length ? metricsOf(prevList) : null;
  const scale = prevList.length ? current.length / prevList.length : 1;
  const prev = prevRaw
    ? { mentions: Math.round(prevRaw.mentions * scale), citations: Math.round(prevRaw.citations * scale), citedPages: Math.round(prevRaw.citedPages * scale) }
    : null;

  const score = now.mentions ? scoreOf(scoreBase(current), brandPos) : null;
  const competitorScores = (competitors ?? []).map((c) =>
    scoreOf(scoreBase(current), (a) => {
      const pos = (mentionsBy.get(a.id) ?? []).filter((m) => m.competitor_id === c.id).map((m) => m.position);
      return pos.length ? Math.min(...pos) : undefined;
    }) ?? 0,
  );
  const ahead = competitorScores.filter((s) => s > (score ?? 0)).length;
  const band = score === null ? "n/a" : score < 30 ? "Low" : score < 60 ? "Medium" : "High";
  const scoreNote =
    score === null
      ? "Not mentioned in these AI answers yet"
      : competitorScores.length
        ? ahead === 0
          ? "Mentioned more often than your competitors"
          : `Mentioned less often than ${ahead} of ${competitorScores.length} competitors`
        : score < 30
          ? "Rarely mentioned in AI answers"
          : score < 60
            ? "Mentioned in some AI answers"
            : "Often recommended in AI answers";

  const trend = trendRuns.map((r) => {
    const m = metricsOf(inRun(r.id).filter((a) => byCountry(a) && byPlatform(a)));
    return { label: r.label, byProvider: { mentions: m.mentions, citations: m.citations, citedPages: m.citedPages } };
  });

  // ---- Distribution by AI source (ignores the AI source filter) ----
  const countryRun = inRun(run.id).filter(byCountry);
  const asked = allAnswers.filter((a) => a.run_id === run.id && byCountry(a));
  const totalMentions = countryRun.filter(mentioned).length;
  const allPages = new Set(countryRun.flatMap((a) => brandSources(a).map((s) => s.url)));
  const distribution = ALL_PROVIDERS.map((p) => {
    const list = countryRun.filter((a) => a.provider === p.name);
    const pages = new Set(list.flatMap((a) => brandSources(a).map((s) => s.url)));
    const m = list.filter(mentioned).length;
    return {
      provider: p.name,
      label: p.label,
      available: asked.some((a) => a.provider === p.name),
      answers: list.length,
      mentions: m,
      mentionShare: totalMentions ? m / totalMentions : 0,
      pages: pages.size,
      pageShare: allPages.size ? pages.size / allPages.size : 0,
    };
  });

  // ---- Mentions by country (ignores the country filter) ----
  const platformRun = inRun(run.id).filter(byPlatform);
  const countryMentions = (brand.countries as string[]).map((code) => ({
    code,
    name: countryName(code),
    flag: countryFlag(code),
    mentions: platformRun.filter((a) => a.country === code && mentioned(a)).length,
    answers: platformRun.filter((a) => a.country === code).length,
  }));
  const countryTotal = countryMentions.reduce((s, c) => s + c.mentions, 0);
  const countries = countryMentions.map((c) => ({ ...c, share: countryTotal ? c.mentions / countryTotal : 0 }));

  // ---- Topics ----
  const volumeCountries = f.country === "all" ? (brand.countries as string[]) : [f.country];
  const volumeOf = (topic: string) => topicVolume((volumeRows ?? []) as VolumeRow[], topic, volumeCountries);

  const topicNames = [...new Set([...(topicRows ?? []).map((t) => t.name), ...[...prompts.values()].map((p) => p.topic ?? "Other")])];
  const topicList = topicNames
    .map((name) => {
      const topicPrompts = [...prompts.values()].filter((p) => (p.topic ?? "Other") === name);
      const list = current.filter((a) => topicPrompts.some((p) => p.id === a.prompt_id));
      const intents = Object.fromEntries(INTENTS.map((i) => [i, topicPrompts.filter((p) => p.intent === i).length])) as Record<Intent, number>;
      // Brands the AI names instead of you in this topic.
      const others = new Map<string, { name: string; answers: Set<string> }>();
      for (const a of list) for (const m of mentionsBy.get(a.id) ?? []) {
        if (m.brand_id === brand.id) continue;
        const k = normalize(m.name);
        const e = others.get(k) ?? { name: m.name, answers: new Set<string>() };
        e.answers.add(a.id);
        others.set(k, e);
      }
      return {
        name,
        keyword: (topicRows ?? []).find((t) => t.name === name)?.keyword ?? null,
        answers: list.length,
        mentions: list.filter(mentioned).length,
        visibility: list.length ? scoreOf(list, brandPos) ?? 0 : 0,
        volume: volumeOf(name),
        intents,
        topBrands: [...others.values()].sort((a, b) => b.answers.size - a.answers.size).slice(0, 3).map((o) => o.name),
        prompts: topicPrompts
          .map((p) => ({
            text: p.text,
            type: p.type,
            intent: p.intent,
            answers: list
              .filter((a) => a.prompt_id === p.id && a.attempt === 1)
              .map((a) => ({
                id: a.id,
                provider: a.provider,
                label: ALL_PROVIDERS.find((x) => x.name === a.provider)?.label ?? a.provider,
                country: a.country,
                flag: countryFlag(a.country),
                text: a.answer_text,
                mentioned: mentioned(a),
                position: brandPos(a) ?? null,
                cited: brandSources(a).length > 0,
                brands: new Set((mentionsBy.get(a.id) ?? []).map((m) => normalize(m.name))).size,
                sources: (sourcesBy.get(a.id) ?? []).length,
              })),
          }))
          .filter((p) => p.answers.length),
      };
    })
    .filter((t) => t.answers > 0)
    .sort((a, b) => b.visibility - a.visibility || (b.volume?.volume ?? 0) - (a.volume?.volume ?? 0));

  // ---- Sources ----
  const domainMap = new Map<string, { answers: Set<string>; withYou: Set<string>; brands: Map<string, string> }>();
  for (const a of current) for (const s of sourcesBy.get(a.id) ?? []) {
    const d = s.domain?.replace(/^www\./, "");
    if (!d) continue;
    const e = domainMap.get(d) ?? { answers: new Set<string>(), withYou: new Set<string>(), brands: new Map<string, string>() };
    e.answers.add(a.id);
    if (mentioned(a)) e.withYou.add(a.id);
    for (const m of mentionsBy.get(a.id) ?? []) if (m.brand_id !== brand.id) e.brands.set(normalize(m.name), m.name);
    domainMap.set(d, e);
  }
  const citedSources = [...domainMap]
    .map(([domain, e]) => ({ domain, answers: e.answers.size, withYou: e.withYou.size, isYou: matchesDomain(domain, brand.domain) }))
    .sort((a, b) => b.answers - a.answers)
    .slice(0, 50);
  const sourceOpportunities = [...domainMap]
    .filter(([domain, e]) => e.withYou.size === 0 && e.brands.size > 0 && !matchesDomain(domain, brand.domain))
    .map(([domain, e]) => ({ domain, answers: e.answers.size, brands: [...e.brands.values()].slice(0, 4) }))
    .sort((a, b) => b.answers - a.answers)
    .slice(0, 50);

  const pageMap = new Map<string, { count: number; sources: Set<string> }>();
  for (const a of current) for (const s of brandSources(a)) {
    const e = pageMap.get(s.url) ?? { count: 0, sources: new Set<string>() };
    e.count++;
    e.sources.add(ALL_PROVIDERS.find((p) => p.name === a.provider)?.label ?? a.provider);
    pageMap.set(s.url, e);
  }
  const citedPages = [...pageMap].map(([url, e]) => ({ url, count: e.count, sources: [...e.sources] })).sort((a, b) => b.count - a.count);

  return {
    state: "ok" as const,
    brand,
    runs,
    run,
    filters: f,
    countryOptions: (brand.countries as string[]).map((code) => ({ code, name: countryName(code), flag: countryFlag(code) })),
    answers: current.length,
    score,
    band,
    scoreNote,
    metrics: {
      mentions: { value: now.mentions, prev: prev?.mentions ?? null },
      citations: { value: now.citations, prev: prev?.citations ?? null },
      citedPages: { value: now.citedPages, prev: prev?.citedPages ?? null },
    },
    trend,
    distribution,
    countries,
    performingTopics: topicList.filter((t) => t.mentions > 0),
    topicOpportunities: topicList.filter((t) => t.mentions === 0).sort((a, b) => (b.volume?.volume ?? 0) - (a.volume?.volume ?? 0)),
    citedSources,
    sourceOpportunities,
    citedPages,
    insights: d.insights,
    aiOverviewErrors: d.aiOverviewErrors,
  };
}

export type Insight = { title: string; body: string; action: string; tab: string };
