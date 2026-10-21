import { brandRuns, fetchAll, formatRun, inChunks } from "./data";
import { config, requireEnv } from "./env";
import { postJson, runPool } from "./http";
import { extractWithModel, matches, normalize } from "./parser";
import { isReady, providers } from "./providers";
import { websiteChanges, type PageChange } from "./snapshots";
import { compareRates, type RateTest } from "./stats";
import { db } from "./supabase";

// Visibility Change Explainer. Everything factual is computed here (diffs,
// significance, website changes, re-tests); GPT only writes the explanation,
// and every claim must cite numbered evidence (E1, E2…) from these facts.

type Answer = { id: string; run_id: string; prompt_id: string; provider: string; country: string; attempt: number; answer_text: string };
type Mention = { answer_id: string; name: string; position: number; brand_id: string | null };
type Source = { answer_id: string; url: string; domain: string | null };

export type PromptChange = {
  key: string; prompt: string; type: string; provider: string; country: string; change: "gained" | "lost";
  before: string; after: string; brandsBefore: string[]; brandsAfter: string[];
  rateBefore: number; rateAfter: number; attemptsBefore: number; attemptsAfter: number; consistent: boolean;
};
export type Retest = { key: string; prompt: string; provider: string; country: string; expected: "gained" | "lost"; mentioned: number; asked: number; confirms: boolean };
export type Evidence = { id: string; kind: string; text: string };
export type Explanation = {
  summary: string;
  likely_cause: "website_change" | "ai_results_changed" | "competitor_gains" | "measurement_noise" | "mixed" | "not_enough_data";
  website_vs_ai: string; consistency: string;
  findings: { claim: string; evidence: string[]; confidence: "high" | "medium" | "low" }[];
  next_steps: string[];
};
export type ChangeReport = Awaited<ReturnType<typeof computeDiff>> & { retest: Retest[] | null; evidence: Evidence[]; explanation: Explanation | null; createdAt: string };

const label = (p: string) => providers.find((x) => x.name === p)?.label ?? p;
const snippet = (t: string) => (t.length > 500 ? `${t.slice(0, 500)}…` : t);

export async function listRuns(brandId: string) {
  const { data: prompts } = await db().from("prompts").select("id").eq("brand_id", brandId);
  const runs = await brandRuns((prompts ?? []).map((p) => p.id));
  return runs.map((r) => ({ id: r.id, label: formatRun(r.started_at), at: r.started_at }));
}

export async function computeDiff(brandId: string, runId: string, prevId: string) {
  const sb = db();
  const [{ data: brand }, { data: prompts }, { data: runRows }] = await Promise.all([
    sb.from("brands").select("id, name, domain, aliases").eq("id", brandId).single(),
    sb.from("prompts").select("id, text, type").eq("brand_id", brandId),
    sb.from("runs").select("id, started_at, finished_at").in("id", [runId, prevId]),
  ]);
  if (!brand) throw new Error("Brand not found.");
  const promptMap = new Map((prompts ?? []).map((p) => [p.id, p]));
  const run = runRows?.find((r) => r.id === runId);
  const prev = runRows?.find((r) => r.id === prevId);
  if (!run || !prev) throw new Error("Check not found.");

  const answers = (await fetchAll<Answer>((from, to) =>
    sb.from("answers").select("id, run_id, prompt_id, provider, country, attempt, answer_text").in("run_id", [runId, prevId])
      .not("answer_text", "is", null).order("id").range(from, to)))
    .filter((a) => promptMap.has(a.prompt_id) && a.answer_text.trim());
  const ids = answers.map((a) => a.id);
  const [mentions, sources] = await Promise.all([
    inChunks<Mention>(ids, (c) => sb.from("mentions").select("id, answer_id, name, position, brand_id").in("answer_id", c)),
    inChunks<Source>(ids, (c) => sb.from("sources").select("id, answer_id, url, domain").in("answer_id", c)),
  ]);
  const mBy = new Map<string, Mention[]>();
  for (const m of mentions) mBy.set(m.answer_id, [...(mBy.get(m.answer_id) ?? []), m]);
  const sBy = new Map<string, Source[]>();
  for (const s of sources) sBy.set(s.answer_id, [...(sBy.get(s.answer_id) ?? []), s]);

  const named = (a: Answer) => (mBy.get(a.id) ?? []).some((m) => m.brand_id === brand.id);
  const key = (a: Answer) => `${a.prompt_id}|${a.provider}|${a.country}`;

  // Fair comparison: only question × AI × country combinations asked in both checks.
  const beforeKeys = new Set(answers.filter((a) => a.run_id === prevId).map(key));
  const afterKeys = new Set(answers.filter((a) => a.run_id === runId).map(key));
  const shared = new Set([...afterKeys].filter((k) => beforeKeys.has(k)));
  const before = answers.filter((a) => a.run_id === prevId && shared.has(key(a)));
  const after = answers.filter((a) => a.run_id === runId && shared.has(key(a)));
  const unbranded = (l: Answer[]) => l.filter((a) => promptMap.get(a.prompt_id)?.type === "unbranded");
  const test = (b: Answer[], a: Answer[]) => compareRates(b.filter(named).length, b.length, a.filter(named).length, a.length);

  const overall = { all: test(before, after), unbranded: test(unbranded(before), unbranded(after)) };
  const providerKeys = [...new Set(after.map((a) => a.provider))];
  const byProvider = providerKeys.map((p) => ({ provider: p, label: label(p), ...test(before.filter((a) => a.provider === p), after.filter((a) => a.provider === p)) }));
  const countryKeys = [...new Set(after.map((a) => a.country))];
  const byCountry = countryKeys.length > 1 ? countryKeys.map((c) => ({ country: c, ...test(before.filter((a) => a.country === c), after.filter((a) => a.country === c)) })) : [];

  // Question-level gains and losses.
  const promptChanges: PromptChange[] = [];
  for (const k of shared) {
    const b = before.filter((a) => key(a) === k).sort((x, y) => x.attempt - y.attempt);
    const a = after.filter((x) => key(x) === k).sort((x, y) => x.attempt - y.attempt);
    const rb = b.filter(named).length / b.length;
    const ra = a.filter(named).length / a.length;
    if ((rb === 0) === (ra === 0)) continue;
    const p = promptMap.get(b[0].prompt_id)!;
    const brandsOf = (x: Answer) => (mBy.get(x.id) ?? []).sort((m, n) => m.position - n.position).map((m) => m.name).slice(0, 6);
    promptChanges.push({
      key: k, prompt: p.text, type: p.type, provider: b[0].provider, country: b[0].country, change: ra > 0 ? "gained" : "lost",
      before: snippet(b[0].answer_text), after: snippet(a[0].answer_text), brandsBefore: brandsOf(b[0]), brandsAfter: brandsOf(a[0]),
      rateBefore: rb, rateAfter: ra, attemptsBefore: b.length, attemptsAfter: a.length,
      // Consistent = every attempt in each check agreed (only meaningful with 2+ attempts).
      consistent: b.every((x) => named(x) === named(b[0])) && a.every((x) => named(x) === named(a[0])),
    });
  }

  // Brands named instead of (or alongside) the brand, on unbranded questions.
  const brandCounts = (l: Answer[]) => {
    const m = new Map<string, { name: string; n: number }>();
    for (const a of unbranded(l)) for (const k of new Set((mBy.get(a.id) ?? []).filter((x) => x.brand_id !== brand.id).map((x) => normalize(x.name)))) {
      const name = (mBy.get(a.id) ?? []).find((x) => normalize(x.name) === k)!.name;
      m.set(k, { name, n: (m.get(k)?.n ?? 0) + 1 });
    }
    return m;
  };
  const bB = brandCounts(before), bA = brandCounts(after);
  const brandsDelta = [...new Set([...bB.keys(), ...bA.keys()])].map((k) => ({ name: (bA.get(k) ?? bB.get(k))!.name, before: bB.get(k)?.n ?? 0, after: bA.get(k)?.n ?? 0 }));
  const brands = {
    appeared: brandsDelta.filter((x) => x.before === 0 && x.after > 0).sort((a, b) => b.after - a.after).slice(0, 10),
    disappeared: brandsDelta.filter((x) => x.after === 0 && x.before > 0).sort((a, b) => b.before - a.before).slice(0, 10),
    rising: brandsDelta.filter((x) => x.before > 0 && x.after - x.before >= 2).sort((a, b) => (b.after - b.before) - (a.after - a.before)).slice(0, 5),
    falling: brandsDelta.filter((x) => x.after > 0 && x.before - x.after >= 2).sort((a, b) => (b.before - b.after) - (a.before - a.after)).slice(0, 5),
  };

  // Cited websites.
  const domainCounts = (l: Answer[]) => {
    const m = new Map<string, number>();
    for (const a of l) for (const d of new Set((sBy.get(a.id) ?? []).map((s) => (s.domain ?? "").replace(/^www\./, "")).filter(Boolean))) m.set(d, (m.get(d) ?? 0) + 1);
    return m;
  };
  const dB = domainCounts(before), dA = domainCounts(after);
  const isOwn = (d: string) => !!brand.domain && (d === brand.domain || d.endsWith(`.${brand.domain}`));
  const domainDelta = [...new Set([...dB.keys(), ...dA.keys()])].filter((d) => !isOwn(d)).map((d) => ({ domain: d, before: dB.get(d) ?? 0, after: dA.get(d) ?? 0 }));
  const ownPages = (l: Answer[]) => new Set(l.flatMap((a) => (sBy.get(a.id) ?? []).filter((s) => isOwn((s.domain ?? "").replace(/^www\./, ""))).map((s) => s.url)));
  const pB = ownPages(before), pA = ownPages(after);
  const sourcesDiff = {
    appeared: domainDelta.filter((x) => x.before === 0 && x.after > 0).sort((a, b) => b.after - a.after).slice(0, 10),
    disappeared: domainDelta.filter((x) => x.after === 0 && x.before > 0).sort((a, b) => b.before - a.before).slice(0, 10),
    ownCitationsBefore: before.filter((a) => (sBy.get(a.id) ?? []).some((s) => isOwn((s.domain ?? "").replace(/^www\./, "")))).length,
    ownCitationsAfter: after.filter((a) => (sBy.get(a.id) ?? []).some((s) => isOwn((s.domain ?? "").replace(/^www\./, "")))).length,
    ownPagesGained: [...pA].filter((u) => !pB.has(u)).slice(0, 10),
    ownPagesLost: [...pB].filter((u) => !pA.has(u)).slice(0, 10),
  };

  const website = await websiteChanges(brandId, prev.finished_at ?? prev.started_at, run.finished_at ?? new Date().toISOString());

  const attempts = (l: Answer[]) => Math.max(1, ...l.map((a) => a.attempt));
  const caveats: string[] = [];
  const droppedBefore = answers.filter((a) => a.run_id === prevId).length - before.length;
  const droppedAfter = answers.filter((a) => a.run_id === runId).length - after.length;
  if (droppedBefore || droppedAfter) caveats.push(`${droppedBefore + droppedAfter} answers were left out because that question, AI and country wasn't asked in both checks.`);
  if (attempts(before) !== attempts(after)) caveats.push(`The checks asked each question a different number of times (${attempts(before)} vs ${attempts(after)}).`);
  if (shared.size < 10) caveats.push("Few matching questions between the two checks, so conclusions are weak.");

  return {
    brand: { name: brand.name, domain: brand.domain },
    runs: { current: { id: runId, at: run.started_at, label: formatRun(run.started_at) }, previous: { id: prevId, at: prev.started_at, label: formatRun(prev.started_at) } },
    compared: { pairs: shared.size, answersBefore: before.length, answersAfter: after.length },
    overall, byProvider, byCountry,
    promptChanges: promptChanges.sort((a, b) => Number(a.change === "lost") - Number(b.change === "lost") || a.prompt.localeCompare(b.prompt)),
    brands, sources: sourcesDiff, website, caveats,
  };
}

// Asks each changed question again (3 times) right now: does the change hold?
export async function retestChanges(brandId: string, diff: Awaited<ReturnType<typeof computeDiff>>): Promise<Retest[]> {
  const { data: brand } = await db().from("brands").select("name, domain, aliases").eq("id", brandId).single();
  const b = { name: brand!.name, domain: brand!.domain, aliases: brand!.aliases ?? [] };
  const picks = diff.promptChanges.filter((c) => providers.some((p) => p.name === c.provider && isReady(p) && p.name !== "ai_overview")).slice(0, 6);
  const out: Retest[] = [];
  await runPool(picks, 3, async (c) => {
    const provider = providers.find((p) => p.name === c.provider)!;
    let mentioned = 0, asked = 0;
    for (let i = 0; i < 3; i++) {
      try {
        const { text } = provider.extract(await provider.call(c.prompt, c.country));
        asked++;
        if (!text.trim()) continue;
        const parsed = await extractWithModel(text, [b.name]);
        if (parsed.brands.some((x) => matches(x.name, b) || (normalize(b.name).length >= 5 && normalize(x.name).includes(normalize(b.name))))) mentioned++;
      } catch { /* a failed call doesn't count */ }
    }
    out.push({
      key: c.key, prompt: c.prompt, provider: c.provider, country: c.country, expected: c.change, mentioned, asked,
      confirms: asked > 0 && (c.change === "gained" ? mentioned / asked >= 0.5 : mentioned / asked < 0.5),
    });
  });
  return out;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const testText = (t: RateTest) => `${pct(t.before)} → ${pct(t.after)} (${t.nBefore} vs ${t.nAfter} answers; ${t.verdict === "too_few" ? "too few answers to test" : `p = ${t.pValue}, ${t.verdict === "significant" ? "statistically significant" : "within normal variation"}`})`;

// Numbered facts the explanation may cite.
export function buildEvidence(d: Awaited<ReturnType<typeof computeDiff>>, retest: Retest[] | null): Evidence[] {
  const ev: Evidence[] = [];
  const add = (kind: string, text: string) => ev.push({ id: `E${ev.length + 1}`, kind, text });
  add("metric", `Mention rate on all compared answers: ${testText(d.overall.all)}`);
  add("metric", `Mention rate on unbranded questions: ${testText(d.overall.unbranded)}`);
  for (const p of d.byProvider) add("metric", `${p.label}: ${testText(p)}`);
  for (const c of d.byCountry) add("metric", `${c.country}: ${testText(c)}`);
  for (const c of d.promptChanges.slice(0, 10)) {
    add("question", `${c.change === "gained" ? "Now named" : "No longer named"} by ${label(c.provider)} (${c.country}) for "${c.prompt}" [${c.type}]. Named before: ${c.brandsBefore.join(", ") || "none"}. Named now: ${c.brandsAfter.join(", ") || "none"}.${c.attemptsBefore > 1 || c.attemptsAfter > 1 ? ` Attempts agreed: ${c.consistent ? "yes" : "no"}.` : ""}`);
  }
  for (const x of d.brands.appeared.slice(0, 5)) add("brand", `${x.name} newly named in ${x.after} unbranded answers (0 before).`);
  for (const x of d.brands.disappeared.slice(0, 5)) add("brand", `${x.name} no longer named (${x.before} unbranded answers before).`);
  for (const x of d.brands.rising) add("brand", `${x.name} named more often: ${x.before} → ${x.after} answers.`);
  for (const x of d.sources.appeared.slice(0, 5)) add("source", `${x.domain} newly cited in ${x.after} answers.`);
  for (const x of d.sources.disappeared.slice(0, 5)) add("source", `${x.domain} no longer cited (${x.before} answers before).`);
  add("source", `Answers citing the brand's own site: ${d.sources.ownCitationsBefore} → ${d.sources.ownCitationsAfter}.`);
  if (!d.website.hasBaseline) add("website", "No earlier snapshot of the website exists, so website changes can't be confirmed or ruled out for this period.");
  else if (!d.website.changes.length) add("website", `No changes found on ${d.website.pagesCompared} saved pages of the website between the two checks.`);
  for (const c of d.website.changes.slice(0, 8)) add("website", describeChange(c));
  for (const r of retest ?? []) add("retest", `Re-test now: ${label(r.provider)} named the brand in ${r.mentioned} of ${r.asked} new answers to "${r.prompt}" (expected ${r.expected}; ${r.confirms ? "confirms" : "does not confirm"} the change).`);
  for (const c of d.caveats) add("caveat", c);
  return ev;
}

function describeChange(c: PageChange) {
  const u = c.url.replace(/^https?:\/\/(www\.)?/, "");
  if (c.kind === "status") return `${u}: status ${c.statusBefore} → ${c.statusAfter}.`;
  if (c.kind === "new") return `${u}: new page (${c.wordsAfter ?? "?"} words).`;
  const bits = [`${u} changed`];
  if (c.titleBefore !== c.titleAfter) bits.push(`title "${c.titleBefore}" → "${c.titleAfter}"`);
  if (c.wordsBefore !== c.wordsAfter) bits.push(`${c.wordsBefore} → ${c.wordsAfter} words`);
  if (c.added.length) bits.push(`added e.g. "${c.added[0].slice(0, 120)}"`);
  return bits.join("; ") + ".";
}

const schema = {
  name: "explanation", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["summary", "likely_cause", "website_vs_ai", "consistency", "findings", "next_steps"],
    properties: {
      summary: { type: "string" },
      likely_cause: { type: "string", enum: ["website_change", "ai_results_changed", "competitor_gains", "measurement_noise", "mixed", "not_enough_data"] },
      website_vs_ai: { type: "string" },
      consistency: { type: "string" },
      findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "evidence", "confidence"],
        properties: { claim: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, confidence: { type: "string", enum: ["high", "medium", "low"] } } } },
      next_steps: { type: "array", items: { type: "string" } },
    },
  },
};

export async function explain(brandName: string, evidence: Evidence[]): Promise<Explanation> {
  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.agent,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            `You explain why ${brandName}'s visibility in AI assistants changed between two checks. You get numbered evidence (E1, E2…). Use ONLY that evidence.`,
            "summary: 2-3 plain sentences on what changed.",
            "likely_cause: website_change only if website evidence shows relevant changes; ai_results_changed if AI answers changed without website changes; competitor_gains if other brands took the place; measurement_noise if changes are not significant and re-tests don't confirm; mixed; or not_enough_data.",
            "website_vs_ai: say whether the website changed, or whether the AI results changed without a website update; if there's no website baseline, say it can't be confirmed.",
            "consistency: whether the change is statistically significant and whether re-tests confirm it.",
            "findings: 2-6 claims, each citing the evidence ids that support it. Confidence high only with significant tests or confirming re-tests.",
            "next_steps: 2-4 concrete actions.",
            "Never claim causation the evidence doesn't support; say 'likely' or 'possibly' when unsure.",
          ].join("\n"),
        },
        { role: "user", content: evidence.map((e) => `${e.id} [${e.kind}] ${e.text}`).join("\n") },
      ],
      response_format: { type: "json_schema", json_schema: schema },
    },
    2,
    120_000,
  );
  const out = JSON.parse(raw.choices[0].message.content) as Explanation;
  // Grounding check: keep only real evidence ids; drop claims that cite nothing real.
  const valid = new Set(evidence.map((e) => e.id));
  out.findings = out.findings.map((f) => ({ ...f, evidence: f.evidence.filter((id) => valid.has(id)) })).filter((f) => f.evidence.length);
  return out;
}

export async function loadExplanation(runId: string, prevId: string): Promise<ChangeReport | null> {
  const { data } = await db().from("visibility_explanations").select("report").eq("run_id", runId).eq("prev_run_id", prevId).maybeSingle();
  return (data?.report as ChangeReport) ?? null;
}

export async function buildExplanation(brandId: string, runId: string, prevId: string, withRetest: boolean, previous?: ChangeReport | null): Promise<ChangeReport> {
  const diff = await computeDiff(brandId, runId, prevId);
  const retest = withRetest ? await retestChanges(brandId, diff) : previous?.retest ?? null;
  const evidence = buildEvidence(diff, retest);
  const explanation = await explain(diff.brand.name, evidence).catch(() => null);
  const report: ChangeReport = { ...diff, retest, evidence, explanation, createdAt: new Date().toISOString() };
  await db().from("visibility_explanations").upsert({ brand_id: brandId, run_id: runId, prev_run_id: prevId, report, created_at: report.createdAt }, { onConflict: "run_id,prev_run_id" });
  return report;
}
