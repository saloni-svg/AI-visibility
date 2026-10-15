import { db } from "./supabase";

// Loads and summarises everything the dashboard shows. All counting happens
// here, so the page only has to draw the numbers.

export const PROVIDERS = ["openai", "gemini", "perplexity"] as const;
export type Provider = (typeof PROVIDERS)[number];
export type Scope = "all" | "unbranded" | "branded";

type Entity = { id: string; name: string; domain: string | null };
type Prompt = { id: string; text: string; type: "branded" | "unbranded" };
type Answer = { id: string; run_id: string; prompt_id: string; provider: Provider };
type Mention = { answer_id: string; name: string; position: number; brand_id: string | null; competitor_id: string | null };
type Source = { answer_id: string; domain: string | null };

export type Rate = { hits: number; total: number };
export type RunOption = { id: string; label: string };

export type Dashboard =
  | { state: "no-brand" }
  | { state: "no-runs"; brand: Entity }
  | {
      state: "ok";
      brand: Entity;
      scope: Scope;
      runs: RunOption[];
      run: RunOption;
      providers: Provider[]; // providers that answered in the selected run
      kpis: {
        answers: number;
        mentionRate: Rate;
        previousRate: Rate | null; // same scope, the run before this one
        avgPosition: number | null;
        siteCited: Rate; // answers that cite the brand's own domain
      };
      entities: { id: string; name: string; isBrand: boolean; overall: Rate; byProvider: Partial<Record<Provider, Rate>> }[];
      trend: { runId: string; label: string; byProvider: Partial<Record<Provider, number>> }[];
      topNames: { name: string; answers: number; avgPosition: number; kind: "brand" | "competitor" | null }[];
      topDomains: { domain: string; answers: number; isBrand: boolean }[];
      prompts: { text: string; type: Prompt["type"]; byProvider: Partial<Record<Provider, Rate & { best: number | null }>> }[];
    };

// Supabase returns at most 1000 rows per request, so page through results.
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

const formatRunDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const matchesDomain = (domain: string | null, brandDomain: string | null) =>
  !!domain && !!brandDomain && (domain === brandDomain || domain.endsWith(`.${brandDomain}`));

export async function loadDashboard(opts: { runId?: string; scope: Scope }): Promise<Dashboard> {
  const supabase = db();

  const { data: brand, error: brandErr } = await supabase
    .from("brands")
    .select("id, name, domain")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (brandErr) throw brandErr;
  if (!brand) return { state: "no-brand" };

  const [{ data: competitors, error: cErr }, { data: promptRows, error: pErr }, { data: runRows, error: rErr }] =
    await Promise.all([
      supabase.from("competitors").select("id, name, domain").eq("brand_id", brand.id),
      supabase.from("prompts").select("id, text, type").eq("brand_id", brand.id),
      supabase.from("runs").select("id, started_at").eq("status", "completed").order("started_at", { ascending: false }).limit(30),
    ]);
  if (cErr) throw cErr;
  if (pErr) throw pErr;
  if (rErr) throw rErr;
  if (!runRows?.length) return { state: "no-runs", brand };

  const runs: RunOption[] = runRows.map((r) => ({ id: r.id, label: formatRunDate(r.started_at) }));
  const run = runs.find((r) => r.id === opts.runId) ?? runs[0];

  // Only answers to this brand's prompts of the chosen type count.
  const prompts = new Map((promptRows as Prompt[]).map((p) => [p.id, p]));
  const inScope = (a: Answer) => {
    const p = prompts.get(a.prompt_id);
    return !!p && (opts.scope === "all" || p.type === opts.scope);
  };

  // Trend covers up to 20 runs ending at the selected one (oldest first).
  const selectedIndex = runs.indexOf(run);
  const trendRuns = runs.slice(selectedIndex, selectedIndex + 20).reverse();
  const trendIds = trendRuns.map((r) => r.id);

  const [trendAnswers, brandMentions, mentions, sources] = await Promise.all([
    fetchAll<Answer>((from, to) =>
      supabase.from("answers").select("id, run_id, prompt_id, provider").in("run_id", trendIds)
        .not("answer_text", "is", null).order("id").range(from, to)),
    fetchAll<{ answer_id: string }>((from, to) =>
      supabase.from("mentions").select("answer_id, answers!inner(run_id)").eq("brand_id", brand.id)
        .in("answers.run_id", trendIds).order("id").range(from, to)),
    fetchAll<Mention>((from, to) =>
      supabase.from("mentions").select("answer_id, name, position, brand_id, competitor_id, answers!inner(run_id)")
        .eq("answers.run_id", run.id).order("id").range(from, to)),
    fetchAll<Source>((from, to) =>
      supabase.from("sources").select("answer_id, domain, answers!inner(run_id)")
        .eq("answers.run_id", run.id).order("id").range(from, to)),
  ]);

  const scopedTrendAnswers = trendAnswers.filter(inScope);
  const answers = scopedTrendAnswers.filter((a) => a.run_id === run.id);
  const answerIds = new Set(answers.map((a) => a.id));
  const runMentions = mentions.filter((m) => answerIds.has(m.answer_id));
  const runSources = sources.filter((s) => answerIds.has(s.answer_id));
  const providers = PROVIDERS.filter((p) => answers.some((a) => a.provider === p));

  // Rate helper: share of `pool` answers whose id is in `hitIds`.
  const rate = (pool: Answer[], hitIds: Set<string>): Rate => ({
    hits: pool.filter((a) => hitIds.has(a.id)).length,
    total: pool.length,
  });
  const byProvider = (hitIds: Set<string>) =>
    Object.fromEntries(providers.map((p) => [p, rate(answers.filter((a) => a.provider === p), hitIds)])) as Partial<
      Record<Provider, Rate>
    >;

  // Brand + competitors, brand first, competitors by overall rate.
  const entityHits = (match: (m: Mention) => boolean) =>
    new Set(runMentions.filter(match).map((m) => m.answer_id));
  const brandHits = entityHits((m) => m.brand_id === brand.id);
  const entities = [
    { id: brand.id, name: brand.name, isBrand: true, hits: brandHits },
    ...(competitors ?? []).map((c) => ({ id: c.id, name: c.name, isBrand: false, hits: entityHits((m) => m.competitor_id === c.id) })),
  ]
    .map((e) => ({ id: e.id, name: e.name, isBrand: e.isBrand, overall: rate(answers, e.hits), byProvider: byProvider(e.hits) }))
    .sort((a, b) => Number(b.isBrand) - Number(a.isBrand) || b.overall.hits - a.overall.hits);

  const brandPositions = runMentions.filter((m) => m.brand_id === brand.id).map((m) => m.position);
  const avgPosition = brandPositions.length ? brandPositions.reduce((s, p) => s + p, 0) / brandPositions.length : null;

  // Trend: brand mention rate per run and provider.
  const brandMentionIds = new Set(brandMentions.map((m) => m.answer_id));
  const trend = trendRuns.map((r) => {
    const pool = scopedTrendAnswers.filter((a) => a.run_id === r.id);
    const values: Partial<Record<Provider, number>> = {};
    for (const p of PROVIDERS) {
      const sub = pool.filter((a) => a.provider === p);
      if (sub.length) values[p] = sub.filter((a) => brandMentionIds.has(a.id)).length / sub.length;
    }
    return { runId: r.id, label: r.label, byProvider: values };
  });
  const previousRun = trendRuns[trendRuns.length - 2];
  const previousPool = previousRun ? scopedTrendAnswers.filter((a) => a.run_id === previousRun.id) : [];
  const previousRate = previousPool.length ? rate(previousPool, brandMentionIds) : null;

  // Every brand the AIs named, grouped case-insensitively.
  type NameStats = { label: Map<string, number>; answers: Set<string>; positions: number[]; kind: "brand" | "competitor" | null };
  const names = new Map<string, NameStats>();
  for (const m of runMentions) {
    const key = m.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const entry: NameStats = names.get(key) ?? { label: new Map(), answers: new Set(), positions: [], kind: null };
    entry.label.set(m.name, (entry.label.get(m.name) ?? 0) + 1);
    entry.answers.add(m.answer_id);
    entry.positions.push(m.position);
    if (m.brand_id) entry.kind = "brand";
    else if (m.competitor_id && entry.kind !== "brand") entry.kind = "competitor";
    names.set(key, entry);
  }
  const topNames = [...names.values()]
    .map((e) => ({
      name: [...e.label].sort((a, b) => b[1] - a[1])[0][0],
      answers: e.answers.size,
      avgPosition: e.positions.reduce((s, p) => s + p, 0) / e.positions.length,
      kind: e.kind,
    }))
    .sort((a, b) => b.answers - a.answers || a.avgPosition - b.avgPosition)
    .slice(0, 15);

  // Most-cited websites, counted once per answer.
  const domains = new Map<string, Set<string>>();
  for (const s of runSources) {
    if (!s.domain) continue;
    const d = s.domain.replace(/^www\./, "");
    if (!domains.has(d)) domains.set(d, new Set());
    domains.get(d)!.add(s.answer_id);
  }
  const topDomains = [...domains]
    .map(([domain, ids]) => ({ domain, answers: ids.size, isBrand: matchesDomain(domain, brand.domain) }))
    .sort((a, b) => b.answers - a.answers)
    .slice(0, 15);
  const siteCitedIds = new Set(runSources.filter((s) => matchesDomain(s.domain?.replace(/^www\./, "") ?? null, brand.domain)).map((s) => s.answer_id));

  // Per-prompt breakdown.
  const bestPosition = new Map<string, number>();
  for (const m of runMentions) {
    if (m.brand_id !== brand.id) continue;
    bestPosition.set(m.answer_id, Math.min(bestPosition.get(m.answer_id) ?? Infinity, m.position));
  }
  const promptStats = [...new Set(answers.map((a) => a.prompt_id))]
    .map((id) => prompts.get(id)!)
    .map((p) => {
      const cells: Partial<Record<Provider, Rate & { best: number | null }>> = {};
      for (const prov of providers) {
        const pool = answers.filter((a) => a.prompt_id === p.id && a.provider === prov);
        if (!pool.length) continue;
        const positions = pool.map((a) => bestPosition.get(a.id)).filter((x): x is number => x !== undefined);
        cells[prov] = { ...rate(pool, brandHits), best: positions.length ? Math.min(...positions) : null };
      }
      return { text: p.text, type: p.type, byProvider: cells };
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.text.localeCompare(b.text));

  return {
    state: "ok",
    brand,
    scope: opts.scope,
    runs,
    run,
    providers,
    kpis: {
      answers: answers.length,
      mentionRate: rate(answers, brandHits),
      previousRate,
      avgPosition,
      siteCited: rate(answers, siteCitedIds),
    },
    entities,
    trend,
    topNames,
    topDomains,
    prompts: promptStats,
  };
}
