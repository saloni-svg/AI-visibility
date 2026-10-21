import { countryFlag, countryName } from "./countries";
import { brandRuns, fetchAll, formatRun, inChunks, matchesDomain } from "./data";
import { providers as ALL_PROVIDERS } from "./providers";
import { INTENTS, type Intent } from "./topics";
import { topicVolume, type VolumeRow } from "./volumes";
import { cleanDomain, domainRoot } from "./domain";
import { matches, normalize } from "./parser";
import { cached } from "./cache";
import { db } from "./supabase";

// Competitor research: compares your brand with up to four competitors on the
// answers to UNBRANDED questions (questions that don't name you), so the
// comparison is fair.

export const MAX_COMPETITORS = 4;
export type Status = "missing" | "weak" | "shared" | "strong" | "unique";

type Mention = { id?: string; answer_id: string; name: string; brand_id: string | null; competitor_id: string | null };

async function brandAnswerIds(brandId: string) {
  const { data: prompts, error } = await db().from("prompts").select("id").eq("brand_id", brandId);
  if (error) throw error;
  const promptIds = (prompts ?? []).map((p) => p.id);
  if (!promptIds.length) return [];
  const rows = await inChunks<{ id: string }>(promptIds, (chunk) => db().from("answers").select("id").in("prompt_id", chunk));
  return rows.map((r) => r.id);
}

// Replaces the brand's competitor list, then re-links every past mention so
// all charts (here and on the overview) include the new competitors at once.
export async function saveCompetitors(brandId: string, inputs: string[]) {
  const answerIds = await brandAnswerIds(brandId);
  const mentions = await inChunks<Mention & { id: string }>(answerIds, (chunk) =>
    db().from("mentions").select("id, answer_id, name, brand_id, competitor_id").in("answer_id", chunk));

  // Turn each input into a competitor. For a domain, use the spelling the AI
  // answers use most (e.g. "ShoutnHike" for shoutnhike.com) as its name.
  const seen = new Set<string>();
  const rows = inputs
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPETITORS)
    .map((input) => {
      const domain = cleanDomain(input);
      if (!domain) return { brand_id: brandId, name: input, domain: null, aliases: [] as string[] };
      const counts = new Map<string, number>();
      for (const m of mentions) if (matches(m.name, { name: domain, domain, aliases: [] })) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
      const name = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? domain;
      return { brand_id: brandId, name, domain, aliases: [domainRoot(domain)] };
    })
    .filter((r) => {
      const key = normalize(r.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const { error: delErr } = await db().from("competitors").delete().eq("brand_id", brandId);
  if (delErr) throw delErr;
  let saved: { id: string; name: string; domain: string | null; aliases: string[] }[] = [];
  if (rows.length) {
    const { data, error } = await db().from("competitors").insert(rows).select("id, name, domain, aliases");
    if (error) throw error;
    saved = data ?? [];
  }

  // Re-link mentions: deleting competitors already cleared old links.
  const byCompetitor = new Map<string, string[]>();
  for (const m of mentions) {
    if (m.brand_id) continue;
    const hit = saved.find((c) => matches(m.name, c));
    if (hit) byCompetitor.set(hit.id, [...(byCompetitor.get(hit.id) ?? []), m.id]);
  }
  for (const [competitorId, ids] of byCompetitor) {
    for (let i = 0; i < ids.length; i += 150) {
      const { error } = await db().from("mentions").update({ competitor_id: competitorId }).in("id", ids.slice(i, i + 150));
      if (error) throw error;
    }
  }
}

// Pauses or resumes every question in a topic. Paused questions are skipped
// in future checks, which saves money.
export async function setTopicMonitoring(brandId: string, topic: string, active: boolean) {
  let q = db().from("prompts").update({ active }).eq("brand_id", brandId);
  q = topic === "Other" ? q.is("topic", null) : q.eq("topic", topic);
  const { error } = await q;
  if (error) throw error;
}

export type CompetitorFilters = { domain: string; runId?: string; country: string; platform: string };
export type CompetitorReport = NonNullable<Awaited<ReturnType<typeof buildCompetitorReport>>>;

type Prompt = { id: string; text: string; type: string; topic: string | null; intent: Intent | null; active: boolean };
type Answer = { id: string; run_id: string; prompt_id: string; provider: string; country: string; answer_text: string };
type M = { answer_id: string; name: string; position: number; brand_id: string | null; competitor_id: string | null };

const weight = (pos: number | undefined) => (pos === undefined ? 0 : pos === 1 ? 1 : pos === 2 ? 0.85 : pos === 3 ? 0.7 : pos <= 5 ? 0.55 : 0.4);

function statusOf(counts: number[], hasCompetitors: boolean): Status | null {
  const you = counts[0];
  const best = Math.max(0, ...counts.slice(1));
  if (you === 0 && best > 0) return "missing";
  if (you > 0 && best === 0) return hasCompetitors ? "unique" : null;
  if (you > best) return "strong";
  if (you > 0 && you === best) return "shared";
  if (you > 0) return "weak";
  return null;
}

export function loadCompetitorReport(f: CompetitorFilters) {
  return cached(`competitors|${f.domain}|${f.runId ?? "latest"}|${f.country}|${f.platform}`, () => buildCompetitorReport(f));
}

async function buildCompetitorReport(f: CompetitorFilters) {
  const supabase = db();
  const { data: brand, error } = await supabase.from("brands").select("id, name, domain, countries").eq("domain", f.domain).maybeSingle();
  if (error) throw error;
  if (!brand) return null;

  const [{ data: competitors }, { data: promptRows }, { data: volumeRows }] = await Promise.all([
    supabase.from("competitors").select("id, name, domain").eq("brand_id", brand.id).order("created_at"),
    supabase.from("prompts").select("id, text, type, topic, intent, active").eq("brand_id", brand.id),
    supabase.from("topic_volumes").select("topic, country, volume, monthly, source").eq("brand_id", brand.id),
  ]);
  const allPrompts = (promptRows ?? []) as Prompt[];
  // Compared on questions that don't name you, so your own name doesn't skew it.
  const prompts = new Map(allPrompts.filter((p) => p.type === "unbranded").map((p) => [p.id, p]));
  const runRows = await brandRuns(allPrompts.map((p) => p.id));
  const runs = runRows.map((r) => ({ id: r.id, label: formatRun(r.started_at) }));
  const run = runs.find((r) => r.id === f.runId) ?? runs[0] ?? null;
  const countries = (brand.countries as string[]).map((code) => ({ code, name: countryName(code), flag: countryFlag(code) }));

  const entities = [
    { id: brand.id, name: brand.domain ?? brand.name, label: brand.name, domain: brand.domain as string | null, isBrand: true },
    ...(competitors ?? []).map((c) => ({ id: c.id, name: c.domain ?? c.name, label: c.name, domain: c.domain as string | null, isBrand: false })),
  ];
  const base = {
    brand,
    runs,
    run,
    countries,
    platforms: ALL_PROVIDERS.map((p) => ({ value: p.name, label: p.label })),
    entities,
    competitorInputs: (competitors ?? []).map((c) => c.domain ?? c.name),
  };
  if (!run) return { ...base, empty: true as const };

  const at = runs.indexOf(run);
  const trendRuns = runs.slice(at, at + 12).reverse();
  const answers = (
    await fetchAll<Answer>((from, to) =>
      supabase.from("answers").select("id, run_id, prompt_id, provider, country, answer_text")
        .in("run_id", trendRuns.map((r) => r.id)).not("answer_text", "is", null).order("id").range(from, to))
  ).filter(
    (a) => prompts.has(a.prompt_id) && a.answer_text.trim() &&
      (f.country === "all" || a.country === f.country) && (f.platform === "all" || a.provider === f.platform),
  );
  const current = answers.filter((a) => a.run_id === run.id);
  const [mentions, sources] = await Promise.all([
    inChunks<M>(answers.map((a) => a.id), (c) => supabase.from("mentions").select("id, answer_id, name, position, brand_id, competitor_id").in("answer_id", c)),
    inChunks<{ answer_id: string; url: string; domain: string | null }>(current.map((a) => a.id), (c) =>
      supabase.from("sources").select("id, answer_id, url, domain").in("answer_id", c)),
  ]);

  // Best (lowest) position of each entity in each answer.
  const pos = new Map<string, number>();
  for (const m of mentions) {
    const id = m.brand_id === brand.id ? brand.id : m.competitor_id;
    if (!id) continue;
    const k = `${m.answer_id}|${id}`;
    pos.set(k, Math.min(pos.get(k) ?? Infinity, m.position));
  }
  const posOf = (answerId: string, entityId: string) => pos.get(`${answerId}|${entityId}`);
  const named = (answerId: string, entityId: string) => pos.has(`${answerId}|${entityId}`);
  const countIn = (list: Answer[]) => entities.map((e) => list.filter((a) => named(a.id, e.id)).length);
  const scoreIn = (list: Answer[]) =>
    entities.map((e) => (list.length ? Math.round((list.reduce((s, a) => s + weight(posOf(a.id, e.id)), 0) / list.length) * 100) : 0));
  const hasCompetitors = entities.length > 1;

  // Headline numbers and trend, per brand.
  const mentionTotals = countIn(current);
  const mentionSum = mentionTotals.reduce((s, n) => s + n, 0);
  const totals = entities.map((_, i) => ({
    mentions: mentionTotals[i],
    visibility: scoreIn(current)[i],
    share: mentionSum ? mentionTotals[i] / mentionSum : 0,
  }));
  const trend = trendRuns.map((r) => {
    const list = answers.filter((a) => a.run_id === r.id);
    const m = countIn(list);
    const v = scoreIn(list);
    const sum = m.reduce((s, n) => s + n, 0);
    return {
      label: r.label,
      visibility: Object.fromEntries(entities.map((e, i) => [e.id, v[i] / 100])),
      mentions: Object.fromEntries(entities.map((e, i) => [e.id, m[i]])),
      share: Object.fromEntries(entities.map((e, i) => [e.id, sum ? m[i] / sum : 0])),
    };
  });

  // Topics and their questions, with each brand's mention count.
  const volumeCountries = f.country === "all" ? (brand.countries as string[]) : [f.country];
  const topicNames = [...new Set([...prompts.values()].map((p) => p.topic ?? "Other"))];
  const topics = topicNames
    .map((name) => {
      const tPrompts = [...prompts.values()].filter((p) => (p.topic ?? "Other") === name);
      const list = current.filter((a) => tPrompts.some((p) => p.id === a.prompt_id));
      const counts = countIn(list);
      return {
        name,
        answers: list.length,
        counts,
        status: statusOf(counts, hasCompetitors),
        volume: topicVolume((volumeRows ?? []) as VolumeRow[], name, volumeCountries),
        intents: Object.fromEntries(INTENTS.map((i) => [i, tPrompts.filter((p) => p.intent === i).length])) as Record<Intent, number>,
        monitoring: tPrompts.every((p) => p.active),
        prompts: tPrompts
          .map((p) => {
            const pl = list.filter((a) => a.prompt_id === p.id);
            const c = countIn(pl);
            return { text: p.text, intent: p.intent, answers: pl.length, counts: c, status: statusOf(c, hasCompetitors) };
          })
          .filter((p) => p.answers > 0),
      };
    })
    .filter((t) => t.answers > 0)
    .sort((a, b) => (b.volume?.volume ?? 0) - (a.volume?.volume ?? 0) || b.answers - a.answers);

  // Websites cited, and how often each brand appears in the answers citing them.
  const siteMap = new Map<string, { urls: Map<string, number>; answers: Set<string> }>();
  for (const s of sources) {
    const d = s.domain?.replace(/^www\./, "");
    if (!d) continue;
    const e = siteMap.get(d) ?? { urls: new Map<string, number>(), answers: new Set<string>() };
    e.answers.add(s.answer_id);
    e.urls.set(s.url, (e.urls.get(s.url) ?? 0) + 1);
    siteMap.set(d, e);
  }
  const sites = [...siteMap]
    .map(([domain, e]) => {
      const ids = [...e.answers];
      const counts = entities.map((en) => ids.filter((id) => named(id, en.id)).length);
      return {
        domain,
        url: [...e.urls].sort((a, b) => b[1] - a[1])[0][0],
        answers: ids.length,
        counts,
        owner: entities.findIndex((en) => matchesDomain(domain, en.domain)),
      };
    })
    .sort((a, b) => b.answers - a.answers)
    .slice(0, 100);

  // Insights: sites that lead AI to your competitors but never to you.
  const insights = sites
    .filter((s) => s.owner === -1 && s.counts[0] === 0 && s.counts.slice(1).some((n) => n > 0))
    .slice(0, 8)
    .map((s) => ({
      domain: s.domain,
      url: s.url,
      answers: s.answers,
      competitors: entities.filter((_, i) => i > 0 && s.counts[i] > 0).map((e) => e.label),
    }));

  // Brands the AI recommends that you aren't tracking yet.
  const currentIds = new Set(current.map((a) => a.id));
  const other = new Map<string, { name: string; answers: Set<string> }>();
  for (const m of mentions) {
    if (m.brand_id || m.competitor_id || !currentIds.has(m.answer_id)) continue;
    const key = normalize(m.name);
    const entry = other.get(key) ?? { name: m.name, answers: new Set<string>() };
    entry.answers.add(m.answer_id);
    other.set(key, entry);
  }

  const count = (list: { status: Status | null }[]) => {
    const c: Record<Status, number> = { missing: 0, weak: 0, shared: 0, strong: 0, unique: 0 };
    for (const x of list) if (x.status) c[x.status]++;
    return c;
  };

  return {
    ...base,
    empty: false as const,
    answers: current.length,
    totals,
    trend,
    topics,
    topicStatus: count(topics),
    promptStatus: count(topics.flatMap((t) => t.prompts)),
    sites,
    insights,
    suggestions: [...other.values()].map((o) => ({ name: o.name, answers: o.answers.size })).sort((a, b) => b.answers - a.answers).slice(0, 8),
  };
}
