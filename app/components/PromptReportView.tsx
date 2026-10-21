"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { brandKey } from "@/lib/brand-key";
import type { BrandRow, Intent, Platform, PromptReport, PromptRow, SourceRow, TopicRow } from "@/lib/prompt-research";
import { researchPrompts } from "../(dashboard)/actions";
import { fmtDay, fmtMonth } from "./format";
import { MATCH_HELP, promptsHref } from "./PromptSearch";

type Country = { code: string; name: string; flag: string };
type Tab = "topics" | "prompts" | "brands" | "sources";
type Focus = { kind: "topic"; index: number } | { kind: "brand"; name: string } | { kind: "source"; domain: string } | null;

const INTENTS: Intent[] = ["informational", "navigational", "commercial", "transactional", "task"];
const INTENT_LABEL: Record<Intent, string> = { informational: "Informational", navigational: "Navigational", commercial: "Commercial", transactional: "Transactional", task: "Task" };
const PLATFORM_LABEL: Record<Platform, string> = { google: "AI Overviews", chat_gpt: "ChatGPT" };
const INTENT_SHORT: Record<Intent, string> = { informational: "I", navigational: "N", commercial: "C", transactional: "T", task: "Tk" };
const REL_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

const compact = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n);
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

// Growth of the last 3 covered months over the 3 before them; null without enough data.
function growth(trend: (number | null)[]) {
  const v = trend.map((x) => x ?? 0);
  if (v.length < 6) return null;
  const recent = v.slice(-3).reduce((a, b) => a + b, 0);
  const before = v.slice(-6, -3).reduce((a, b) => a + b, 0);
  return before > 0 ? (recent - before) / before : null;
}

function Spark({ values, w = 72, h = 26 }: { values: (number | null)[]; w?: number; h?: number }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return <span className="pr-spark pr-spark-empty" style={{ width: w }} aria-hidden="true" />;
  const max = Math.max(1, ...pts.map((p) => p.v));
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * w;
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg className="pr-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${line} L${x(pts.at(-1)!.i).toFixed(1)},${h} L${x(pts[0].i).toFixed(1)},${h} Z`} fill="var(--pr-area)" />
      <path d={line} fill="none" stroke="var(--pr-line)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IntentBar({ counts, total }: { counts: Record<Intent, number>; total: number }) {
  return (
    <span className="pr-ibar" role="img" aria-label={INTENTS.filter((k) => counts[k]).map((k) => `${INTENT_LABEL[k]} ${pct(counts[k], total)}%`).join(", ")}>
      {INTENTS.map((k) => counts[k] ? <span key={k} className={`pr-bg-${k}`} style={{ flexGrow: counts[k] }} title={`${INTENT_LABEL[k]}: ${pct(counts[k], total)}%`} /> : null)}
    </span>
  );
}

function IntentPill({ intent, short }: { intent: Intent; short?: boolean }) {
  return <span className={`pr-intent ${intent}${short ? " sm" : ""}`} title={INTENT_LABEL[intent]}>{short ? INTENT_SHORT[intent] : INTENT_LABEL[intent]}</span>;
}

function Chevron({ open }: { open: boolean }) {
  return <svg className={`pr-chev${open ? " open" : ""}`} viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function download(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export default function PromptReportView({ report, stale, countries }: { report: PromptReport; stale: boolean; countries: Country[] }) {
  const router = useRouter();
  const r = report;
  const match = r.match ?? "exact";
  const [tab, setTab] = useState<Tab>("topics");
  const [focus, setFocus] = useState<Focus>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("default");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const switchTab = (t: Tab, f: Focus = null) => { setTab(t); setFocus(f); setPage(1); setQuery(""); setSort("default"); setOpen(new Set()); if (t !== "prompts") setIntent(null); };

  async function refresh() {
    setRefreshing(true);
    setRefreshError("");
    const res = await researchPrompts(r.topic, r.country, r.platform, match);
    setRefreshing(false);
    if ("error" in res) return setRefreshError(res.error);
    router.refresh();
  }
  async function copy(key: string, lines: string[]) {
    try { await navigator.clipboard.writeText(lines.join("\n")); setCopied(key); setTimeout(() => setCopied(null), 1800); } catch { /* clipboard blocked */ }
  }

  // ---- Summary figures ----
  const totalIntent = INTENTS.reduce((s, k) => s + r.intents[k], 0);
  const lastMonth = r.months.at(-1);
  const opportunities = useMemo(() => {
    const relevant = r.topics.map((t, i) => ({ t, i })).filter(({ t }) => t.relevance !== "low");
    const biggest = [...relevant].sort((a, b) => b.t.volume - a.t.volume)[0];
    const rising = relevant.map((x) => ({ ...x, g: growth(x.t.trend) })).filter((x) => x.g !== null && x.t.prompts >= 5 && x.t.volume >= r.totals.volume * 0.01)
      .sort((a, b) => b.g! - a.g!)[0];
    const commercial = [...r.prompts.map((p, i) => ({ p, i }))].filter(({ p }) => p.intent === "commercial" || p.intent === "transactional")
      .sort((a, b) => b.p.volume - a.p.volume)[0];
    return { biggest, rising, commercial, source: r.sources[0] };
  }, [r]);

  // ---- Rows for the current tab ----
  const q = query.trim().toLowerCase();
  const focusLabel = focus?.kind === "topic" ? r.topics[focus.index]?.name : focus?.kind === "brand" ? focus.name : focus?.kind === "source" ? focus.domain : null;

  const topicRows = useMemo(() => {
    let rows = r.topics.map((t, i) => ({ t, i }));
    if (q) rows = rows.filter(({ t, i }) => t.name.toLowerCase().includes(q) || r.prompts.some((p) => p.topic === i && p.q.toLowerCase().includes(q)));
    if (sort === "volume") rows = [...rows].sort((a, b) => b.t.volume - a.t.volume);
    if (sort === "prompts") rows = [...rows].sort((a, b) => b.t.prompts - a.t.prompts);
    if (sort === "growth") rows = [...rows].sort((a, b) => (growth(b.t.trend) ?? -9) - (growth(a.t.trend) ?? -9));
    return rows;
  }, [r, q, sort]);

  const promptRows = useMemo(() => {
    let rows = r.prompts.map((p, i) => ({ p, i }));
    if (focus?.kind === "topic") rows = rows.filter(({ p }) => p.topic === focus.index);
    if (focus?.kind === "brand") rows = rows.filter(({ p }) => p.brands.some((b) => brandKey(b) === brandKey(focus.name)));
    if (focus?.kind === "source") rows = rows.filter(({ p }) => p.sources.some((s) => s.domain === focus.domain));
    if (intent) rows = rows.filter(({ p }) => p.intent === intent);
    if (q) rows = rows.filter(({ p }) => p.q.toLowerCase().includes(q));
    if (sort === "growth") rows = [...rows].sort((a, b) => (growth(b.p.trend) ?? -9) - (growth(a.p.trend) ?? -9));
    if (sort === "sources") rows = [...rows].sort((a, b) => b.p.sources.length - a.p.sources.length);
    return rows;
  }, [r, focus, intent, q, sort]);

  const brandRows = useMemo(() => {
    let rows = r.brands;
    if (q) rows = rows.filter((b) => b.name.toLowerCase().includes(q));
    if (sort === "volume") rows = [...rows].sort((a, b) => b.volume - a.volume);
    return rows;
  }, [r, q, sort]);

  const sourceRows = useMemo(() => {
    let rows = r.sources;
    if (q) rows = rows.filter((s) => s.domain.includes(q));
    if (sort === "volume") rows = [...rows].sort((a, b) => b.volume - a.volume);
    if (sort === "citations") rows = [...rows].sort((a, b) => b.citations - a.citations);
    return rows;
  }, [r, q, sort]);

  const count = tab === "topics" ? topicRows.length : tab === "prompts" ? promptRows.length : tab === "brands" ? brandRows.length : sourceRows.length;
  const pages = Math.max(1, Math.ceil(count / perPage));
  const at = Math.min(page, pages);
  const from = (at - 1) * perPage;
  const slice = <T,>(rows: T[]) => rows.slice(from, from + perPage);

  const SORTS: Record<Tab, [string, string][]> = {
    topics: [["default", "Relevance"], ["volume", "AI volume"], ["prompts", "Prompts"], ["growth", "Growth"]],
    prompts: [["default", "AI volume"], ["growth", "Growth"], ["sources", "Sources cited"]],
    brands: [["default", "Prompts mentioning"], ["volume", "AI volume"]],
    sources: [["default", "Prompts citing"], ["citations", "Citations"], ["volume", "AI volume"]],
  };

  function exportCsv() {
    const name = `prompt-research-${r.topic.replace(/\W+/g, "-")}-${r.country}-${tab}.csv`;
    if (tab === "topics") download(name, [["Topic", "Relevance", "AI volume", "Prompts", ...INTENTS.map((k) => `${INTENT_LABEL[k]} prompts`)], ...topicRows.map(({ t }) => [t.name, t.relevance, t.volume, t.prompts, ...INTENTS.map((k) => t.intents[k])])]);
    if (tab === "prompts") download(name, [["Prompt", "Platform", "Topic", "Intent", "AI volume", "Brands", "Sources"], ...promptRows.map(({ p }) => [p.q, PLATFORM_LABEL[p.platform], r.topics[p.topic]?.name ?? "", p.intent, p.volume, p.brands.join("; "), p.sources.map((s) => s.url).join(" ")])]);
    if (tab === "brands") download(name, [["Brand", "Prompts mentioning", "Share of prompts %", "AI volume", "Platforms"], ...brandRows.map((b) => [b.name, b.prompts, pct(b.prompts, r.analyzed), b.volume, b.platforms.map((p) => PLATFORM_LABEL[p]).join("; ")])]);
    if (tab === "sources") download(name, [["Domain", "Prompts citing", "Share of prompts %", "Citations", "AI volume"], ...sourceRows.map((s) => [s.domain, s.prompts, pct(s.prompts, r.analyzed), s.citations, s.volume])]);
  }

  const countryCode = (c: string) => (c === "GB" ? "UK" : c);

  return (
    <div className="pr-report">
      {/* ---- Header ---- */}
      <header className="pr-head">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> AI analysis <span aria-hidden="true">›</span> Prompt research</p>
          <h1>Prompt Research: <span className="muted-strong">{r.topic}</span></h1>
        </div>
        <div className="pr-head-right">
          <span className="note">Data as of {fmtDay(r.createdAt)}{stale && " · over a week old"}</span>
          <button type="button" className="btn-secondary btn-small" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh data"}</button>
        </div>
      </header>
      <div className="pr-filters">
        <nav className="pr-countries" aria-label="Country">
          {countries.map((c) => (
            <Link key={c.code} href={promptsHref(r.topic, c.code, c.code !== "US" && r.platform === "chat_gpt" ? "all" : r.platform, match)}
              aria-current={c.code === r.country ? "true" : undefined} title={c.name}>
              <span aria-hidden="true">{c.flag}</span> {countryCode(c.code)}
            </Link>
          ))}
        </nav>
        <nav className="seg pr-platforms" aria-label="AI platform">
          {(["all", "google", "chat_gpt"] as const).map((p) => {
            const off = p === "chat_gpt" && r.country !== "US";
            const label = p === "all" ? "All AI platforms" : PLATFORM_LABEL[p];
            return off
              ? <span key={p} className="pr-platform-off" title="ChatGPT prompts are only available for the United States">{label}</span>
              : <Link key={p} href={promptsHref(r.topic, r.country, p, match)} aria-current={p === r.platform ? "true" : undefined}>{label}</Link>;
          })}
        </nav>
        <nav className="seg pr-platforms" aria-label="Match">
          {(["broad", "exact"] as const).map((x) => (
            <Link key={x} href={promptsHref(r.topic, r.country, r.platform, x)} aria-current={x === match ? "true" : undefined} title={MATCH_HELP[x]}>
              {x === "broad" ? "Broad match" : "Exact match"}
            </Link>
          ))}
        </nav>
      </div>
      {refreshError && <p className="field-error">{refreshError}</p>}
      {r.unsaved && (
        <p className="pr-setup">
          <b>Not saved yet.</b> This report is only kept until the server restarts because the <code>prompt_research</code> table
          doesn&apos;t exist. Run <code>supabase/migrations/0010_prompt_research.sql</code> once in the Supabase SQL editor, then refresh the data.
        </p>
      )}
      {r.problems.length > 0 && <p className="pr-problem">Some data couldn&apos;t be loaded: {r.problems.join(" · ")}</p>}

      {r.notice ? <p className="pr-notice card">{r.notice}</p> : (
        <>
          {/* ---- Summary ---- */}
          <section className="card pr-summary" aria-label="Summary">
            <div className="pr-sum pr-sum-volume">
              <p className="pr-sum-label">AI search volume <span className="pr-help" title={`Monthly AI search volume across all ${match === "broad" ? "prompts whose question or AI answer mentions" : "prompts that ask about"} this topic (DataForSEO). The chart sums the analysed prompts, month by month.`}>?</span></p>
              <p className="pr-sum-big">{compact(r.totals.volume)}</p>
              {r.months.length > 1 && (
                <>
                  <Spark values={r.trend} w={220} h={56} />
                  <p className="pr-sum-axis"><span>{fmtMonth(r.months[0])}</span><span>{lastMonth && fmtMonth(lastMonth)}</span></p>
                </>
              )}
            </div>
            <div className="pr-sum pr-sum-counts">
              <div>
                <p className="pr-sum-label">Topics</p>
                <p className="pr-sum-big pr-accent">{r.topics.length}</p>
              </div>
              <div>
                <p className="pr-sum-label">Prompts</p>
                <p className="pr-sum-big pr-accent">{compact(r.totals.prompts)}</p>
                {r.analyzed < r.totals.prompts && <p className="note">top {compact(r.analyzed)} analysed</p>}
              </div>
            </div>
            <div className="pr-sum">
              <p className="pr-sum-label">Intent</p>
              <IntentBar counts={r.intents} total={totalIntent} />
              <ul className="pr-legend">
                {INTENTS.map((k) => (
                  <li key={k}><button type="button" onClick={() => { switchTab("prompts"); setIntent(k); }} disabled={!r.intents[k]}>
                    <IntentPill intent={k} short /> {INTENT_LABEL[k]} <b>{pct(r.intents[k], totalIntent)}%</b>
                  </button></li>
                ))}
              </ul>
            </div>
            <div className="pr-sum">
              <p className="pr-sum-label">Brands mentioned</p>
              <p className="pr-sum-big pr-accent">{compact(r.brands.length)}</p>
              <p className="pr-sum-sub">Top brands</p>
              <ol className="pr-toplist">
                {r.brands.slice(0, 3).map((b) => <li key={b.name}><button type="button" onClick={() => switchTab("prompts", { kind: "brand", name: b.name })}>{b.name}</button><span>{pct(b.prompts, r.analyzed)}%</span></li>)}
                {!r.brands.length && <li className="muted">None named in answers</li>}
              </ol>
            </div>
            <div className="pr-sum">
              <p className="pr-sum-label">Source domains</p>
              <p className="pr-sum-big pr-accent">{compact(r.sources.length)}</p>
              <p className="pr-sum-sub">Top sources</p>
              <ol className="pr-toplist">
                {r.sources.slice(0, 3).map((s) => <li key={s.domain}><button type="button" onClick={() => switchTab("prompts", { kind: "source", domain: s.domain })}>{s.domain}</button><span>{pct(s.prompts, r.analyzed)}%</span></li>)}
              </ol>
            </div>
          </section>

          {r.totals.byPlatform.length > 1 && (
            <section className="pr-split" aria-label="Platform split">
              {r.totals.byPlatform.map((b) => (
                <div key={b.platform} className="pr-split-item">
                  <span className={`pr-pdot ${b.platform}`} aria-hidden="true" />
                  <b>{PLATFORM_LABEL[b.platform]}</b>
                  <span className="note">{compact(b.prompts)} prompts · {compact(b.volume)} AI volume</span>
                  <span className="pr-split-bar"><span style={{ width: `${pct(b.volume, r.totals.volume)}%` }} /></span>
                </div>
              ))}
            </section>
          )}

          {/* ---- Opportunities ---- */}
          <section className="pr-opps" aria-label="Opportunities">
            {opportunities.biggest && (
              <button type="button" className="card pr-opp" onClick={() => switchTab("prompts", { kind: "topic", index: opportunities.biggest!.i })}>
                <span className="pr-opp-kicker">Biggest AI demand</span>
                <b>{opportunities.biggest.t.name}</b>
                <span className="note">{compact(opportunities.biggest.t.volume)} AI volume across {opportunities.biggest.t.prompts} prompts</span>
              </button>
            )}
            {opportunities.rising && opportunities.rising.g! > 0 && (
              <button type="button" className="card pr-opp" onClick={() => switchTab("prompts", { kind: "topic", index: opportunities.rising!.i })}>
                <span className="pr-opp-kicker">Rising fastest</span>
                <b>{opportunities.rising.t.name}</b>
                <span className="note pr-up">+{Math.round(opportunities.rising.g! * 100)}% in the last 3 months</span>
              </button>
            )}
            {opportunities.commercial && (
              <button type="button" className="card pr-opp" onClick={() => { switchTab("prompts"); setQuery(opportunities.commercial!.p.q); }}>
                <span className="pr-opp-kicker">Top buying-stage prompt</span>
                <b>{opportunities.commercial.p.q}</b>
                <span className="note">{compact(opportunities.commercial.p.volume)} AI volume · {INTENT_LABEL[opportunities.commercial.p.intent].toLowerCase()}</span>
              </button>
            )}
            {opportunities.source && (
              <button type="button" className="card pr-opp" onClick={() => switchTab("prompts", { kind: "source", domain: opportunities.source!.domain })}>
                <span className="pr-opp-kicker">Most-cited source</span>
                <b>{opportunities.source.domain}</b>
                <span className="note">Cited in {pct(opportunities.source.prompts, r.analyzed)}% of answers</span>
              </button>
            )}
          </section>

          {/* ---- Explorer ---- */}
          <section className="card pr-explorer">
            <div className="pr-ex-head">
              <h2>Explore <span className="muted">{count ? `${from + 1}–${Math.min(from + perPage, count)}` : 0} of {count}</span></h2>
              <button type="button" className="btn-secondary btn-small" onClick={exportCsv} disabled={!count}>
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Export CSV
              </button>
            </div>
            <div className="pr-ex-tools">
              <div className="pr-tabs" role="tablist">
                {([["topics", "Topics", r.topics.length], ["prompts", "Prompts", r.prompts.length], ["brands", "Brands", r.brands.length], ["sources", "Source domains", r.sources.length]] as [Tab, string, number][]).map(([k, label, n]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => switchTab(k)}>{label} <span>{compact(n)}</span></button>
                ))}
              </div>
              <div className="pr-ex-right">
                <label className="pr-filter">
                  <span className="sr-only">Filter</span>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder={`Filter ${tab === "sources" ? "domains" : tab}`} />
                </label>
                <label className="pr-sort">
                  <span className="note">Sort</span>
                  <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                    {SORTS[tab].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {tab === "prompts" && (focusLabel || intent || r.platform === "all") && (
              <div className="pr-active">
                {focusLabel && <button type="button" className="pr-chip pr-chip-on" onClick={() => setFocus(null)}>{focus!.kind === "topic" ? "Topic" : focus!.kind === "brand" ? "Brand" : "Source"}: {focusLabel} <span aria-hidden="true">×</span><span className="sr-only">Remove filter</span></button>}
                {INTENTS.map((k) => (
                  <button key={k} type="button" className={`pr-chip${intent === k ? " pr-chip-on" : ""}`} aria-pressed={intent === k} onClick={() => { setIntent(intent === k ? null : k); setPage(1); }}>
                    <IntentPill intent={k} short /> {INTENT_LABEL[k]}
                  </button>
                ))}
              </div>
            )}

            <div className="pr-table-wrap">
              {tab === "topics" && <TopicsTable rows={slice(topicRows)} report={r} open={open} toggle={toggle} copied={copied}
                onCopy={(i) => copy(`t${i}`, r.prompts.filter((p) => p.topic === i).map((p) => p.q))}
                onView={(i) => switchTab("prompts", { kind: "topic", index: i })} />}
              {tab === "prompts" && <PromptsTable rows={slice(promptRows)} report={r} open={open} toggle={toggle} showPlatform={r.platform === "all"}
                onTopic={(i) => switchTab("prompts", { kind: "topic", index: i })} onBrand={(n) => switchTab("prompts", { kind: "brand", name: n })} />}
              {tab === "brands" && <BrandsTable rows={slice(brandRows)} offset={from} analyzed={r.analyzed} onView={(n) => switchTab("prompts", { kind: "brand", name: n })} />}
              {tab === "sources" && <SourcesTable rows={slice(sourceRows)} offset={from} analyzed={r.analyzed} onView={(d) => switchTab("prompts", { kind: "source", domain: d })} />}
              {!count && <p className="pr-empty note">Nothing matches these filters.</p>}
            </div>

            <div className="pr-pager">
              <button type="button" className="btn-secondary btn-small" onClick={() => setPage(1)} disabled={at === 1} aria-label="First page">«</button>
              <button type="button" className="btn-secondary btn-small" onClick={() => setPage(at - 1)} disabled={at === 1}>Prev</button>
              <button type="button" className="btn-dark btn-small" onClick={() => setPage(at + 1)} disabled={at === pages}>Next</button>
              <label className="pr-page-input">Page
                <input type="number" min={1} max={pages} value={at} onChange={(e) => setPage(Math.min(pages, Math.max(1, Number(e.target.value) || 1)))} />
                of {pages}
              </label>
              <label className="pr-sort pr-per">
                <span className="note">Rows</span>
                <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </section>

          <p className="note pr-footnote">
            Prompts, AI search volume, answers, cited sources and fan-out queries: DataForSEO LLM Mentions ({r.totals.byPlatform.map((b) => PLATFORM_LABEL[b.platform]).join(" and ")}, {countries.find((c) => c.code === r.country)?.name}).
            {r.classifier === "ai" ? " Topics, intent and brand names are worked out by AI from the prompts and their answers." : " Topics and intent are estimated from the wording of each prompt."}
            {r.months.length > 1 && " The trend only includes months that most prompts have data for."}
          </p>
        </>
      )}
    </div>
  );
}

// ---------- Tables ----------

function TopicsTable({ rows, report, open, toggle, onCopy, onView, copied }: {
  rows: { t: TopicRow; i: number }[]; report: PromptReport; open: Set<string>; toggle: (k: string) => void;
  onCopy: (i: number) => void; onView: (i: number) => void; copied: string | null;
}) {
  return (
    <table className="pr-table">
      <thead>
        <tr><th className="pr-c-chev" /><th>Topic</th><th>Relevance</th><th className="num" colSpan={2}>AI volume</th><th className="num">Prompts</th><th>Intent</th><th className="pr-c-act" /></tr>
      </thead>
      <tbody>
        {rows.map(({ t, i }) => {
          const k = `t${i}`;
          const isOpen = open.has(k);
          const top = report.prompts.filter((p) => p.topic === i).slice(0, 8);
          return (
            <Fragment key={k}>
              <tr className={`pr-row${isOpen ? " is-open" : ""}`} onClick={() => toggle(k)}>
                <td className="pr-c-chev"><button type="button" aria-expanded={isOpen} aria-label={`Show prompts in ${t.name}`} onClick={(e) => { e.stopPropagation(); toggle(k); }}><Chevron open={isOpen} /></button></td>
                <td className="pr-c-main"><b>{t.name}</b></td>
                <td><span className={`pr-rel ${t.relevance}`}><span aria-hidden="true" />{REL_LABEL[t.relevance]}</span></td>
                <td className="pr-c-spark"><Spark values={t.trend} /></td>
                <td className="num"><b>{compact(t.volume)}</b></td>
                <td className="num">{t.prompts}</td>
                <td className="pr-c-intent"><IntentBar counts={t.intents} total={t.prompts} /></td>
                <td className="pr-c-act"><button type="button" className="btn-dark btn-small" onClick={(e) => { e.stopPropagation(); onView(i); }}>View prompts</button></td>
              </tr>
              {isOpen && (
                <tr className="pr-detail"><td /><td colSpan={7}>
                  <ul className="pr-mini">
                    {top.map((p) => (
                      <li key={`${p.platform}|${p.q}`}><IntentPill intent={p.intent} short /><span className="pr-mini-q">{p.q}</span><span className={`pr-pdot ${p.platform}`} title={PLATFORM_LABEL[p.platform]} /><b>{compact(p.volume)}</b></li>
                    ))}
                  </ul>
                  <div className="pr-detail-actions">
                    {t.prompts > top.length && <button type="button" className="link-btn" onClick={() => onView(i)}>See all {t.prompts} prompts →</button>}
                    <button type="button" className="btn-secondary btn-small" onClick={() => onCopy(i)}>{copied === `t${i}` ? "Copied" : `Copy ${t.prompts} prompts`}</button>
                  </div>
                </td></tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function PromptsTable({ rows, report, open, toggle, showPlatform, onTopic, onBrand }: {
  rows: { p: PromptRow; i: number }[]; report: PromptReport; open: Set<string>; toggle: (k: string) => void; showPlatform: boolean;
  onTopic: (i: number) => void; onBrand: (n: string) => void;
}) {
  return (
    <table className="pr-table">
      <thead>
        <tr><th className="pr-c-chev" /><th>Prompt</th><th>Intent</th><th className="num" colSpan={2}>AI volume</th><th className="num">Brands</th><th className="num">Sources</th></tr>
      </thead>
      <tbody>
        {rows.map(({ p, i }) => {
          const k = `p${i}`;
          const isOpen = open.has(k);
          return (
            <Fragment key={k}>
              <tr className={`pr-row${isOpen ? " is-open" : ""}`} onClick={() => toggle(k)}>
                <td className="pr-c-chev"><button type="button" aria-expanded={isOpen} aria-label="Show the AI answer" onClick={(e) => { e.stopPropagation(); toggle(k); }}><Chevron open={isOpen} /></button></td>
                <td className="pr-c-main">
                  <span className="pr-q">{p.q}</span>
                  <span className="pr-q-meta">
                    {showPlatform && <span className="pr-plat"><span className={`pr-pdot ${p.platform}`} aria-hidden="true" />{PLATFORM_LABEL[p.platform]}</span>}
                    {report.topics[p.topic] && <button type="button" className="pr-topic-link" onClick={(e) => { e.stopPropagation(); onTopic(p.topic); }}>{report.topics[p.topic].name}</button>}
                  </span>
                </td>
                <td><IntentPill intent={p.intent} /></td>
                <td className="pr-c-spark"><Spark values={p.trend} /></td>
                <td className="num"><b>{compact(p.volume)}</b></td>
                <td className="num">{p.brands.length || <span className="muted">0</span>}</td>
                <td className="num">{p.sources.length || <span className="muted">0</span>}</td>
              </tr>
              {isOpen && (
                <tr className="pr-detail"><td /><td colSpan={6}>
                  <div className="pr-answer">
                    <div>
                      <p className="pr-detail-label">AI answer <span className="muted">· {p.model.replace(/_/g, " ").replace(/-/g, ".")}{p.lastSeen && ` · seen ${fmtDay(p.lastSeen.replace(" +00:00", "Z").replace(" ", "T"))}`}</span></p>
                      <p className="pr-answer-text">{p.answer || <span className="muted">No answer text stored.</span>}{p.answer.length >= 700 && "…"}</p>
                      {p.brands.length > 0 && (
                        <>
                          <p className="pr-detail-label">Brands named</p>
                          <div className="pr-chips">{p.brands.map((b) => <button key={b} type="button" className="pr-chip" onClick={() => onBrand(b)}>{b}</button>)}</div>
                        </>
                      )}
                    </div>
                    <div>
                      <p className="pr-detail-label">Sources cited</p>
                      {p.sources.length ? (
                        <ol className="pr-srcs">
                          {p.sources.map((s) => (
                            <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="url">{s.domain}</a><span className="note">{s.title}</span></li>
                          ))}
                        </ol>
                      ) : <p className="note">No sources listed.</p>}
                      {p.fanOut.length > 0 && (
                        <>
                          <p className="pr-detail-label">Searches the AI ran <span className="pr-help" title="Fan-out queries: the web searches the AI made to build its answer.">?</span></p>
                          <ul className="pr-fan">{p.fanOut.map((f) => <li key={f}>{f}</li>)}</ul>
                        </>
                      )}
                    </div>
                  </div>
                </td></tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function BrandsTable({ rows, offset, analyzed, onView }: { rows: BrandRow[]; offset: number; analyzed: number; onView: (n: string) => void }) {
  const max = Math.max(1, ...rows.map((b) => b.prompts));
  return (
    <table className="pr-table">
      <thead><tr><th className="num pr-c-rank">#</th><th>Brand</th><th>Share of prompts</th><th className="num">Prompts</th><th className="num">AI volume</th><th>Platforms</th><th className="pr-c-act" /></tr></thead>
      <tbody>
        {rows.map((b, j) => (
          <tr key={b.name} className="pr-row" onClick={() => onView(b.name)}>
            <td className="num pr-c-rank muted">{offset + j + 1}</td>
            <td className="pr-c-main"><b>{b.name}</b></td>
            <td><span className="pr-share"><span style={{ width: `${(b.prompts / max) * 100}%` }} /></span> {pct(b.prompts, analyzed)}%</td>
            <td className="num">{b.prompts}</td>
            <td className="num">{compact(b.volume)}</td>
            <td>{b.platforms.map((p) => <span key={p} className="pr-plat"><span className={`pr-pdot ${p}`} aria-hidden="true" />{PLATFORM_LABEL[p]}</span>)}</td>
            <td className="pr-c-act"><button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); onView(b.name); }}>Prompts →</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourcesTable({ rows, offset, analyzed, onView }: { rows: SourceRow[]; offset: number; analyzed: number; onView: (d: string) => void }) {
  const max = Math.max(1, ...rows.map((s) => s.prompts));
  return (
    <table className="pr-table">
      <thead><tr><th className="num pr-c-rank">#</th><th>Domain</th><th>Share of answers</th><th className="num">Prompts</th><th className="num">Citations</th><th className="num">AI volume</th><th className="pr-c-act" /></tr></thead>
      <tbody>
        {rows.map((s, j) => (
          <tr key={s.domain} className="pr-row" onClick={() => onView(s.domain)}>
            <td className="num pr-c-rank muted">{offset + j + 1}</td>
            <td className="pr-c-main">
              <img className="pr-fav" src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=32`} alt="" width={16} height={16} loading="lazy" />
              <a href={`https://${s.domain}`} target="_blank" rel="noreferrer" className="url" onClick={(e) => e.stopPropagation()}>{s.domain}</a>
            </td>
            <td><span className="pr-share"><span style={{ width: `${(s.prompts / max) * 100}%` }} /></span> {pct(s.prompts, analyzed)}%</td>
            <td className="num">{s.prompts}</td>
            <td className="num">{s.citations}</td>
            <td className="num">{compact(s.volume)}</td>
            <td className="pr-c-act"><button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); onView(s.domain); }}>Prompts →</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
