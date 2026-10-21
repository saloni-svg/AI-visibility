import { COUNTRIES, countryName, isCountry, type CountryCode } from "./countries";
import { fetchAll, inChunks } from "./data";
import { dataForSeo } from "./dataforseo";
import { cleanDomain } from "./domain";
import { config, requireEnv } from "./env";
import { domainOf, postJson, runPool } from "./http";
import { extractWithModel, matches } from "./parser";
import { isReady, providerByName } from "./providers";
import { aiOverview } from "./providers/aiOverview";
import { openai } from "./providers/openai";
import { db } from "./supabase";

// Prompt tracking: a campaign asks a fixed set of prompts to the chosen AI engines and records,
// on every check, whether the answer names the brand (and in which position), whether the site
// is cited as a source, and which other brands and websites appear. Checks run in small steps
// so the page can show progress.

import { ENGINE_LABEL, ENGINES, isEngine, LANGUAGES, MAX_PROMPTS, type Engine } from "./tracking-shared";
export { ENGINE_LABEL, ENGINES, isEngine, LANGUAGES, MAX_PROMPTS, type Engine };
export const engineReady = (e: Engine) => isReady(providerByName[e]);

export type Campaign = {
  id: string; domain: string; brand_name: string; aliases: string[]; engines: Engine[];
  country: CountryCode; location: { code: number; name: string } | null; language: string; device: "desktop" | "mobile";
  competitors: string[]; last_run_at: string | null; created_at: string;
};
export type TrackedPrompt = { id: string; prompt: string; tags: string[]; created_at: string };
export type CampaignInput = {
  domain: string; brandName: string; aliases: string[]; engines: Engine[]; country: string;
  location: { code: number; name: string } | null; language: string; device: string; competitors: string[];
};

const MISSING = "Prompt tracking tables are missing. Run supabase/migrations/0011_prompt_tracking.sql in the Supabase SQL editor.";
const check = <T,>(r: { data: T; error: { message: string; code?: string } | null }) => {
  if (r.error) throw new Error(r.error.code === "PGRST205" || /pt_/.test(r.error.message) ? MISSING : r.error.message);
  return r.data;
};
// A competitor entered as a domain is shown by its name: "zoho.com" -> "Zoho".
const displayName = (n: string) => { const d = cleanDomain(n); if (!d) return n; const r = d.split(".")[0]; return r.charAt(0).toUpperCase() + r.slice(1); };
const splitList = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))].slice(0, 20);

// ---------- Campaigns ----------

function cleanInput(input: CampaignInput) {
  const domain = cleanDomain(input.domain);
  if (!domain) throw new Error("Enter a valid domain, e.g. example.com.");
  if (!isCountry(input.country)) throw new Error("Pick a country.");
  const engines = [...new Set(input.engines.filter(isEngine))];
  if (!engines.length) throw new Error("Pick at least one AI engine.");
  const langs = LANGUAGES[input.country] ?? [{ code: "en", name: "English" }];
  return {
    domain,
    brand_name: input.brandName.trim().slice(0, 80) || domain.split(".")[0],
    aliases: splitList(input.aliases),
    engines,
    country: input.country,
    location: input.location && input.location.code ? { code: input.location.code, name: input.location.name } : null,
    language: langs.some((l) => l.code === input.language) ? input.language : langs[0].code,
    device: input.device === "mobile" ? "mobile" : "desktop",
    competitors: splitList(input.competitors),
  };
}

export async function createCampaign(input: CampaignInput, prompts: { prompt: string; tags: string[] }[]): Promise<string> {
  const row = cleanInput(input);
  const created = check(await db().from("pt_campaigns").insert(row).select("id").single()) as { id: string };
  await addPrompts(created.id, prompts);
  return created.id;
}

export async function updateCampaign(id: string, input: CampaignInput) {
  check(await db().from("pt_campaigns").update(cleanInput(input)).eq("id", id));
}

export async function deleteCampaign(id: string) {
  check(await db().from("pt_campaigns").delete().eq("id", id));
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db().from("pt_campaigns").select("*").eq("id", id).maybeSingle();
  return check(r) as Campaign | null;
}

export const cleanPrompt = (p: string) => p.trim().replace(/\s+/g, " ").slice(0, 300);

export async function addPrompts(campaignId: string, prompts: { prompt: string; tags: string[] }[]) {
  const existing = check(await db().from("pt_prompts").select("id, prompt, active").eq("campaign_id", campaignId)) as { id: string; prompt: string; active: boolean }[];
  const activeCount = existing.filter((e) => e.active).length;
  const seen = new Map<string, { prompt: string; tags: string[] }>();
  for (const p of prompts) {
    const prompt = cleanPrompt(p.prompt);
    if (prompt.length >= 3) seen.set(prompt.toLowerCase(), { prompt, tags: splitList(p.tags).map((t) => t.toLowerCase()).slice(0, 5) });
  }
  const list = [...seen.values()];
  const isNew = (p: { prompt: string }) => !existing.some((e) => e.active && e.prompt.toLowerCase() === p.prompt.toLowerCase());
  if (activeCount + list.filter(isNew).length > MAX_PROMPTS) throw new Error(`A campaign can track up to ${MAX_PROMPTS} prompts.`);
  if (!list.length) return 0;
  check(await db().from("pt_prompts").upsert(list.map((p) => ({ campaign_id: campaignId, prompt: p.prompt, tags: p.tags, active: true })), { onConflict: "campaign_id,prompt" }));
  return list.length;
}

export async function removePrompt(campaignId: string, promptId: string) {
  check(await db().from("pt_prompts").update({ active: false }).eq("id", promptId).eq("campaign_id", campaignId));
}

export async function listPrompts(campaignId: string): Promise<TrackedPrompt[]> {
  return check(await db().from("pt_prompts").select("id, prompt, tags, created_at").eq("campaign_id", campaignId).eq("active", true).order("created_at")) as TrackedPrompt[];
}

// ---------- Runs ----------

export async function startRun(campaignId: string): Promise<{ runId: string; total: number; done: number }> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found.");
  // A check started in the last 30 minutes is resumed instead of starting another.
  const recent = new Date(Date.now() - 30 * 60_000).toISOString();
  const running = check(await db().from("pt_runs").select("id, total, done").eq("campaign_id", campaignId).eq("status", "running").gte("created_at", recent).order("created_at", { ascending: false }).limit(1)) as { id: string; total: number; done: number }[];
  if (running[0]) return { runId: running[0].id, total: running[0].total, done: running[0].done };
  const prompts = await listPrompts(campaignId);
  const engines = campaign.engines.filter(engineReady);
  if (!prompts.length) throw new Error("Add at least one prompt first.");
  if (!engines.length) throw new Error("None of this campaign's AI engines has an API key in .env.");
  const run = check(await db().from("pt_runs").insert({ campaign_id: campaignId, total: prompts.length * engines.length }).select("id, total").single()) as { id: string; total: number };
  return { runId: run.id, total: run.total, done: 0 };
}

const STEP = 8;

export async function runStep(runId: string): Promise<{ status: string; done: number; total: number }> {
  const run = check(await db().from("pt_runs").select("id, campaign_id, status, total").eq("id", runId).single()) as { id: string; campaign_id: string; status: string; total: number };
  if (run.status !== "running") return { status: run.status, done: run.total, total: run.total };
  const campaign = (await getCampaign(run.campaign_id))!;
  const prompts = await listPrompts(campaign.id);
  const engines = campaign.engines.filter(engineReady);
  const done = check(await db().from("pt_checks").select("prompt_id, engine").eq("run_id", runId)) as { prompt_id: string; engine: string }[];
  const have = new Set(done.map((d) => `${d.prompt_id}|${d.engine}`));
  const pending = prompts.flatMap((p) => engines.map((e) => ({ p, e }))).filter(({ p, e }) => !have.has(`${p.id}|${e}`));
  const total = prompts.length * engines.length;

  if (!pending.length) {
    const finished = new Date().toISOString();
    check(await db().from("pt_runs").update({ status: "completed", done: total, total, finished_at: finished }).eq("id", runId));
    check(await db().from("pt_campaigns").update({ last_run_at: finished }).eq("id", campaign.id));
    return { status: "completed", done: total, total };
  }

  const rows: Record<string, unknown>[] = [];
  await runPool(pending.slice(0, STEP), STEP, async ({ p, e }) => {
    rows.push({ run_id: runId, campaign_id: campaign.id, prompt_id: p.id, engine: e, ...(await checkPrompt(campaign, p.prompt, e)) });
  });
  check(await db().from("pt_checks").upsert(rows, { onConflict: "run_id,prompt_id,engine" }));
  const nowDone = have.size + rows.length;
  check(await db().from("pt_runs").update({ done: nowDone, total }).eq("id", runId));
  return { status: "running", done: nowDone, total };
}

// ---------- One prompt on one engine ----------

const isMine = (url: string, domain: string) => {
  const d = domainOf(url);
  return !!d && (d === domain || d.endsWith(`.${domain}`));
};
// Gemini links go through vertexaisearch.cloud.google.com and put the site in the title.
const sourceDomain = (url: string, title?: string) => {
  const d = domainOf(url) ?? "";
  if (/vertexaisearch|googleusercontent/.test(d) && title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title.trim())) return title.trim().toLowerCase().replace(/^www\./, "");
  return d;
};

export async function checkPrompt(c: Campaign, prompt: string, engine: Engine): Promise<Record<string, unknown>> {
  try {
    const city = c.location?.name.split(",")[0];
    let text = "";
    let citations: { url: string; title?: string }[] = [];
    let organic: number | null = null;
    let answered = true;

    if (engine === "ai_overview") {
      const raw = await dataForSeo("serp/google/organic/live/advanced", [{
        keyword: prompt, location_code: c.location?.code ?? COUNTRIES[c.country].locationCode,
        language_code: c.language, device: c.device, load_async_ai_overview: true,
      }], 90_000);
      ({ text, citations } = aiOverview.extract(raw));
      answered = !!text;
      const items: any[] = raw?.tasks?.[0]?.result?.[0]?.items ?? [];
      organic = items.find((i) => i.type === "organic" && isMine(String(i.url ?? ""), c.domain))?.rank_group ?? null;
    } else if (engine === "openai") {
      // ChatGPT's web search runs from the campaign's country (and city, when set).
      const raw = await postJson(
        "https://api.openai.com/v1/responses",
        { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
        { model: config.models.openai, input: prompt, tools: [{ type: "web_search", user_location: { type: "approximate", country: c.country, ...(city ? { city } : {}) } }] },
        2, 120_000,
      );
      ({ text, citations } = openai.extract(raw));
    } else {
      // Gemini and Perplexity have no location setting, so the location is added to the question.
      const p = providerByName[engine];
      const asked = city ? `${prompt}\n\n(I'm based in ${city}, ${countryName(c.country)}.)` : prompt;
      const raw = await p.call(asked, city ? "" : c.country);
      ({ text, citations } = p.extract(raw));
    }

    const parsed = text ? await extractWithModel(text, [c.brand_name, ...c.competitors.map(displayName)]) : { brands: [], cited_urls: [] };
    const me = { name: c.brand_name, domain: c.domain, aliases: c.aliases };
    const mine = parsed.brands.find((b) => matches(b.name, me));
    const urls = new Map<string, { domain: string; url: string; title: string }>();
    for (const s of [...citations, ...parsed.cited_urls.map((url) => ({ url, title: "" }))]) {
      const url = s.url.startsWith("http") ? s.url : `https://${s.url}`;
      const domain = sourceDomain(url, s.title);
      if (domain && !urls.has(url)) urls.set(url, { domain, url: url.replace(/[?&]utm_source=[^&]+/, ""), title: s.title ?? "" });
    }
    const sources = [...urls.values()];
    const citedUrls = sources.filter((s) => s.domain === c.domain || s.domain.endsWith(`.${c.domain}`)).map((s) => s.url);
    return {
      answered, mentioned: !!mine, position: mine?.position ?? null,
      cited: citedUrls.length > 0, cited_urls: citedUrls.slice(0, 10),
      brands: parsed.brands.slice(0, 25), sources: sources.slice(0, 15),
      organic_position: organic, answer: text.slice(0, 6000), error: null,
    };
  } catch (e) {
    return { answered: false, error: (e as Error).message.slice(0, 500) };
  }
}

// ---------- Dashboard ----------

type CheckRow = {
  id: string; run_id: string; prompt_id: string; engine: Engine; answered: boolean; mentioned: boolean; position: number | null;
  cited: boolean; cited_urls: string[]; brands: { name: string; position: number }[]; sources: { domain: string; url: string; title: string }[];
  organic_position: number | null; error: string | null;
};
type RunRow = { id: string; status: string; total: number; done: number; created_at: string; finished_at: string | null };

// How much an answer is worth to the brand: named first = 100, lower down less, only linked = 10.
export function weight(c: Pick<CheckRow, "mentioned" | "position" | "cited">) {
  if (c.mentioned && c.position) return c.position === 1 ? 1 : c.position === 2 ? 0.85 : c.position === 3 ? 0.7 : c.position <= 5 ? 0.55 : c.position <= 10 ? 0.35 : 0.2;
  return c.cited ? 0.1 : 0;
}

export type Metrics = { answers: number; visibility: number; mentionRate: number; citeRate: number; avgPosition: number | null; top1: number; top3: number; top10: number; mentioned: number; cited: number };
function metrics(rows: CheckRow[]): Metrics {
  const ok = rows.filter((r) => !r.error);
  const ment = ok.filter((r) => r.mentioned && r.position);
  const pct = (n: number) => (ok.length ? Math.round((n / ok.length) * 1000) / 10 : 0);
  return {
    answers: ok.length,
    visibility: ok.length ? Math.round((ok.reduce((s, r) => s + weight(r), 0) / ok.length) * 1000) / 10 : 0,
    mentionRate: pct(ment.length), citeRate: pct(ok.filter((r) => r.cited).length),
    avgPosition: ment.length ? Math.round((ment.reduce((s, r) => s + r.position!, 0) / ment.length) * 10) / 10 : null,
    top1: ment.filter((r) => r.position === 1).length, top3: ment.filter((r) => r.position! <= 3).length,
    top10: ment.filter((r) => r.position! <= 10).length, mentioned: ment.length, cited: ok.filter((r) => r.cited).length,
  };
}
const bucket = (r: CheckRow) => (r.error ? null : r.mentioned && r.position ? (r.position === 1 ? "first" : r.position <= 3 ? "top3" : "top10") : r.cited ? "cited" : "absent");

export type TrackingData = Awaited<ReturnType<typeof loadTracking>>;

export async function loadTracking(campaignId: string, opts: { engine?: string; runId?: string }) {
  const campaign = await getCampaign(campaignId);
  if (!campaign) return null;
  const engine = isEngine(opts.engine) && campaign.engines.includes(opts.engine) ? opts.engine : "all";
  const [prompts, runs] = await Promise.all([
    listPrompts(campaignId),
    db().from("pt_runs").select("id, status, total, done, created_at, finished_at").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(60).then(check) as Promise<RunRow[]>,
  ]);
  const completed = runs.filter((r) => r.status === "completed");
  const running = runs.find((r) => r.status === "running" && Date.now() - new Date(r.created_at).getTime() < 30 * 60_000) ?? null;
  const current = completed.find((r) => r.id === opts.runId) ?? completed[0] ?? null;
  const previous = current ? completed[completed.indexOf(current) + 1] ?? null : null;
  // Trend: up to the last 30 completed checks, oldest first.
  const history = completed.slice(0, 30).reverse();

  const cols = "id, run_id, prompt_id, engine, answered, mentioned, position, cited, cited_urls, brands, sources, organic_position, error";
  const histCols = "id, run_id, prompt_id, engine, answered, mentioned, position, cited, error";
  const [currentRows, previousRows, historyRows] = await Promise.all([
    current ? fetchAll<CheckRow>((a, b) => db().from("pt_checks").select(cols).eq("run_id", current.id).range(a, b)) : Promise.resolve([]),
    previous ? fetchAll<CheckRow>((a, b) => db().from("pt_checks").select(cols).eq("run_id", previous.id).range(a, b)) : Promise.resolve([]),
    history.length ? inChunks<CheckRow>(history.map((h) => h.id), (ids) => db().from("pt_checks").select(histCols).in("run_id", ids)) : Promise.resolve([]),
  ]);
  const active = new Set(prompts.map((p) => p.id));
  const keep = (r: CheckRow) => active.has(r.prompt_id) && (engine === "all" || r.engine === engine);
  const cur = currentRows.filter(keep);
  const prev = previousRows.filter(keep);

  const now = metrics(cur);
  const before = previous ? metrics(prev) : null;
  const trend = history.map((h) => {
    const rows = historyRows.filter((r) => r.run_id === h.id && keep(r));
    const m = metrics(rows);
    const dist = { first: 0, top3: 0, top10: 0, cited: 0, absent: 0 };
    for (const r of rows) { const b = bucket(r); if (b) dist[b]++; }
    return { runId: h.id, date: h.finished_at ?? h.created_at, visibility: m.visibility, mentionRate: m.mentionRate, avgPosition: m.avgPosition, dist };
  });

  // ---- Per prompt (each engine's result, now and at the previous check) ----
  const key = (r: Pick<CheckRow, "prompt_id" | "engine">) => `${r.prompt_id}|${r.engine}`;
  const prevBy = new Map(prev.map((r) => [key(r), r]));
  const engines = engine === "all" ? campaign.engines : [engine];
  const rows = prompts.map((p) => {
    const cells = Object.fromEntries(engines.map((e) => {
      const c = cur.find((r) => r.prompt_id === p.id && r.engine === e);
      const b = prevBy.get(`${p.id}|${e}`);
      return [e, c ? {
        checkId: c.id, answered: c.answered, mentioned: c.mentioned, position: c.position, cited: c.cited, error: c.error,
        organic: c.organic_position, prevPosition: b ? (b.mentioned ? b.position : 0) : null,
      } : null];
    })) as Record<string, { checkId: string; answered: boolean; mentioned: boolean; position: number | null; cited: boolean; error: string | null; organic: number | null; prevPosition: number | null } | null>;
    const mine = cur.filter((r) => r.prompt_id === p.id);
    const mineBefore = prev.filter((r) => r.prompt_id === p.id);
    const vis = mine.length ? Math.round((mine.reduce((s, r) => s + weight(r), 0) / mine.length) * 1000) / 10 : null;
    const visBefore = mineBefore.length ? Math.round((mineBefore.reduce((s, r) => s + weight(r), 0) / mineBefore.length) * 1000) / 10 : null;
    const positions = mine.filter((r) => r.mentioned && r.position).map((r) => r.position!);
    return { id: p.id, prompt: p.prompt, tags: p.tags, cells, visibility: vis, prevVisibility: visBefore, best: positions.length ? Math.min(...positions) : null };
  });

  // New / lost compared with the previous check, per answer.
  const newLost = (test: (r: CheckRow) => boolean) => {
    if (!previous) return { now: cur.filter(test).length, new: null, lost: null };
    const was = new Set(prev.filter(test).map(key));
    const is = new Set(cur.filter(test).map(key));
    return { now: is.size, new: [...is].filter((k) => !was.has(k)).length, lost: [...was].filter((k) => !is.has(k)).length };
  };
  const ranks = {
    top1: newLost((r) => r.mentioned && r.position === 1),
    top3: newLost((r) => r.mentioned && !!r.position && r.position <= 3),
    top10: newLost((r) => r.mentioned && !!r.position && r.position <= 10),
    mentioned: newLost((r) => r.mentioned),
    cited: newLost((r) => r.cited),
  };
  const changed = rows.filter((r) => r.visibility !== null && r.prevVisibility !== null && r.visibility !== r.prevVisibility)
    .map((r) => ({ id: r.id, prompt: r.prompt, from: r.prevVisibility!, to: r.visibility!, diff: r.visibility! - r.prevVisibility! }));

  // ---- Tags ----
  const tagMap = new Map<string, CheckRow[]>();
  const promptTags = new Map(prompts.map((p) => [p.id, p.tags]));
  for (const r of cur) for (const t of promptTags.get(r.prompt_id) ?? []) tagMap.set(t, [...(tagMap.get(t) ?? []), r]);
  const tags = [...tagMap].map(([tag, list]) => ({ tag, prompts: new Set(list.map((r) => r.prompt_id)).size, ...metrics(list) })).sort((a, b) => b.visibility - a.visibility);

  // ---- Brands in the answers (competitors) ----
  const me = { name: campaign.brand_name, domain: campaign.domain, aliases: campaign.aliases };
  const tracked = campaign.competitors.map((n) => ({ name: displayName(n), domain: cleanDomain(n), aliases: [n] }));
  const brandMap = new Map<string, { name: string; answers: number; positions: number[]; weight: number; you: boolean; tracked: boolean }>();
  const ok = cur.filter((r) => !r.error);
  for (const r of ok) {
    const seen = new Set<string>();
    for (const b of r.brands ?? []) {
      const you = matches(b.name, me);
      const t = tracked.find((x) => matches(b.name, { ...x, domain: x.domain }));
      const name = you ? campaign.brand_name : t ? t.name : b.name;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const e = brandMap.get(k) ?? brandMap.set(k, { name, answers: 0, positions: [], weight: 0, you, tracked: !!t }).get(k)!;
      e.answers++; e.positions.push(b.position); e.weight += weight({ mentioned: true, position: b.position, cited: false });
    }
  }
  const brands = [...brandMap.values()].map((b) => ({
    name: b.name, you: b.you, tracked: b.tracked, answers: b.answers,
    share: ok.length ? Math.round((b.answers / ok.length) * 1000) / 10 : 0,
    avgPosition: Math.round((b.positions.reduce((s, x) => s + x, 0) / b.positions.length) * 10) / 10,
    visibility: ok.length ? Math.round((b.weight / ok.length) * 1000) / 10 : 0,
  })).sort((a, b) => b.visibility - a.visibility);
  if (!brands.some((b) => b.you)) brands.push({ name: campaign.brand_name, you: true, tracked: false, answers: 0, share: 0, avgPosition: 0, visibility: 0 });
  for (const t of tracked) if (!brands.some((b) => b.name.toLowerCase() === t.name.toLowerCase())) brands.push({ name: t.name, you: false, tracked: true, answers: 0, share: 0, avgPosition: 0, visibility: 0 });

  // ---- Sources and your pages ----
  const srcMap = new Map<string, { domain: string; answers: number; citations: number; you: boolean }>();
  const pageMap = new Map<string, { url: string; answers: number; prompts: Set<string>; engines: Set<string>; positions: number[] }>();
  for (const r of ok) {
    const domains = new Set<string>();
    for (const s of r.sources ?? []) {
      const e = srcMap.get(s.domain) ?? srcMap.set(s.domain, { domain: s.domain, answers: 0, citations: 0, you: s.domain === campaign.domain || s.domain.endsWith(`.${campaign.domain}`) }).get(s.domain)!;
      e.citations++;
      if (!domains.has(s.domain)) { domains.add(s.domain); e.answers++; }
    }
    for (const u of r.cited_urls ?? []) {
      const p = pageMap.get(u) ?? pageMap.set(u, { url: u, answers: 0, prompts: new Set(), engines: new Set(), positions: [] }).get(u)!;
      p.answers++; p.prompts.add(r.prompt_id); p.engines.add(r.engine);
      if (r.mentioned && r.position) p.positions.push(r.position);
    }
  }
  const sources = [...srcMap.values()].map((s) => ({ ...s, share: ok.length ? Math.round((s.answers / ok.length) * 1000) / 10 : 0 })).sort((a, b) => b.answers - a.answers || b.citations - a.citations);
  const pages = [...pageMap.values()].map((p) => ({
    url: p.url, answers: p.answers, prompts: p.prompts.size, engines: [...p.engines] as Engine[],
    avgPosition: p.positions.length ? Math.round((p.positions.reduce((s, x) => s + x, 0) / p.positions.length) * 10) / 10 : null,
  })).sort((a, b) => b.answers - a.answers);

  // ---- Per engine (for the engine comparison) ----
  const byEngine = campaign.engines.map((e) => ({ engine: e, ready: engineReady(e), ...metrics(currentRows.filter((r) => active.has(r.prompt_id) && r.engine === e)) }));

  // ---- Same domain, other targets ----
  const siblings = (check(await db().from("pt_campaigns").select("id, country, location, engines, last_run_at").eq("domain", campaign.domain).order("created_at")) as Pick<Campaign, "id" | "country" | "location" | "engines" | "last_run_at">[]);
  const siblingStats = await campaignVisibility(siblings.map((s) => s.id));
  const targets = siblings.map((s) => ({ ...s, visibility: siblingStats.get(s.id)?.visibility ?? null, current: s.id === campaign.id }));

  const errors = cur.filter((r) => r.error).length;
  return {
    campaign, engine, prompts: prompts.length, engines: campaign.engines,
    runs: completed.map((r) => ({ id: r.id, date: r.finished_at ?? r.created_at })),
    running: running ? { id: running.id, done: running.done, total: running.total } : null,
    current: current ? { id: current.id, date: current.finished_at ?? current.created_at } : null,
    previous: previous ? { id: previous.id, date: previous.finished_at ?? previous.created_at } : null,
    now, before, trend, ranks, rows,
    improved: changed.filter((c) => c.diff > 0).sort((a, b) => b.diff - a.diff),
    declined: changed.filter((c) => c.diff < 0).sort((a, b) => a.diff - b.diff),
    tags, brands, sources, pages, byEngine, targets, errors,
    noOverview: cur.filter((r) => r.engine === "ai_overview" && !r.error && !r.answered).length,
  };
}

// Latest visibility per campaign (all engines), for the campaign list and other targets.
export async function campaignVisibility(ids: string[]) {
  const out = new Map<string, { visibility: number; mentionRate: number; runId: string }>();
  if (!ids.length) return out;
  const runs = check(await db().from("pt_runs").select("id, campaign_id, created_at").in("campaign_id", ids).eq("status", "completed").order("created_at", { ascending: false })) as { id: string; campaign_id: string }[];
  const latest = new Map<string, string>();
  for (const r of runs) if (!latest.has(r.campaign_id)) latest.set(r.campaign_id, r.id);
  if (!latest.size) return out;
  const rows = await inChunks<CheckRow & { campaign_id: string }>([...latest.values()], (chunk) =>
    db().from("pt_checks").select("id, run_id, campaign_id, mentioned, position, cited, error").in("run_id", chunk));
  for (const [cid, rid] of latest) {
    const m = metrics(rows.filter((r) => r.run_id === rid));
    out.set(cid, { visibility: m.visibility, mentionRate: m.mentionRate, runId: rid });
  }
  return out;
}

export async function listCampaigns() {
  const list = check(await db().from("pt_campaigns").select("id, domain, brand_name, engines, country, location, last_run_at, created_at").order("created_at", { ascending: false })) as Campaign[];
  const [stats, counts] = await Promise.all([
    campaignVisibility(list.map((c) => c.id)),
    list.length ? (db().from("pt_prompts").select("campaign_id").in("campaign_id", list.map((c) => c.id)).eq("active", true).then(check) as Promise<{ campaign_id: string }[]>) : Promise.resolve([]),
  ]);
  return list.map((c) => ({ ...c, prompts: counts.filter((x) => x.campaign_id === c.id).length, visibility: stats.get(c.id)?.visibility ?? null, mentionRate: stats.get(c.id)?.mentionRate ?? null }));
}

// Full answer for one check (loaded when a row is opened).
export async function checkDetail(checkId: string) {
  return check(await db().from("pt_checks").select("engine, answered, mentioned, position, cited, cited_urls, brands, sources, organic_position, answer, error, checked_at").eq("id", checkId).single()) as {
    engine: Engine; answered: boolean; mentioned: boolean; position: number | null; cited: boolean; cited_urls: string[];
    brands: { name: string; position: number }[]; sources: { domain: string; url: string; title: string }[]; organic_position: number | null;
    answer: string | null; error: string | null; checked_at: string;
  };
}

// ---------- Prompt ideas ----------

// Prompts a buyer would ask an AI assistant about this business, written by GPT from the homepage.
export async function suggestPrompts(domain: string, brandName: string, country: string, existing: string[]): Promise<string[]> {
  const site = await fetch(`https://${domain}`, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; AIVisibilityTracker/1.0)" } })
    .then((r) => r.text()).then((h) => h.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000))
    .catch(() => "(website could not be read)");
  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.parser,
      messages: [
        {
          role: "system",
          content: "Write 15 prompts that potential customers would type into ChatGPT or Gemini when looking for what this business offers. " +
            "Mostly unbranded (they don't name the business): best/top lists, comparisons, how-to-choose, recommendations for a need, local where relevant. " +
            "Include 2 prompts that name the brand (reviews, alternatives). Natural, specific, under 15 words each. No numbering.",
        },
        { role: "user", content: `Brand: ${brandName}\nDomain: ${domain}\nCustomers are in: ${countryName(country)}\nAlready tracked: ${existing.slice(0, 50).join(" | ") || "none"}\nWebsite text: ${site}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "prompts", strict: true, schema: { type: "object", additionalProperties: false, required: ["prompts"], properties: { prompts: { type: "array", items: { type: "string" } } } } } },
    },
  );
  const { prompts } = JSON.parse(raw.choices[0].message.content) as { prompts: string[] };
  const have = new Set(existing.map((e) => e.toLowerCase()));
  return prompts.map(cleanPrompt).filter((p) => p.length > 3 && !have.has(p.toLowerCase())).slice(0, 15);
}

// Known domains to offer on the first page: analysed brands and existing campaigns.
export async function knownDomains(): Promise<{ domain: string; name: string }[]> {
  const [brands, campaigns] = await Promise.all([
    db().from("brands").select("name, domain").not("domain", "is", null).order("created_at", { ascending: false }).limit(30),
    db().from("pt_campaigns").select("brand_name, domain").order("created_at", { ascending: false }).limit(30),
  ]);
  const out = new Map<string, { domain: string; name: string }>();
  for (const c of (campaigns.data ?? []) as { brand_name: string; domain: string }[]) out.set(c.domain, { domain: c.domain, name: c.brand_name });
  for (const b of (brands.data ?? []) as { name: string; domain: string }[]) if (!out.has(b.domain)) out.set(b.domain, { domain: b.domain, name: b.name });
  return [...out.values()].slice(0, 30);
}
