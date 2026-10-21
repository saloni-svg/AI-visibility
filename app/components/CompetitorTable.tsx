"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { toggleTopicMonitoring } from "../(dashboard)/actions";
import Icon from "./Icon";
import Sparkline from "./Sparkline";

type Status = "missing" | "weak" | "shared" | "strong" | "unique";
type Intents = Record<string, number>;
type Entity = { id: string; name: string; isBrand: boolean };
type PromptRow = { text: string; intent: string | null; answers: number; counts: number[]; status: Status | null };
type Topic = {
  name: string; answers: number; counts: number[]; status: Status | null;
  volume: { volume: number; monthly: number[] } | null; intents: Intents; monitoring: boolean; prompts: PromptRow[];
};
type Site = { domain: string; url: string; answers: number; counts: number[]; owner: number };

const STATUSES: { key: Status; label: string; hint: string }[] = [
  { key: "missing", label: "Missing", hint: "Competitors appear, you don't" },
  { key: "weak", label: "Weak", hint: "You appear less often than a competitor" },
  { key: "shared", label: "Shared", hint: "You appear as often as the top competitor" },
  { key: "strong", label: "Strong", hint: "You appear more often than every competitor" },
  { key: "unique", label: "Unique", hint: "Only you appear" },
];
const VOLUMES = [
  { key: "all", label: "AI Volume", min: 0, max: Infinity },
  { key: "0", label: "0–100", min: 0, max: 100 },
  { key: "100", label: "101–1K", min: 101, max: 1000 },
  { key: "1k", label: "1K–10K", min: 1001, max: 10000 },
  { key: "10k", label: "10K+", min: 10001, max: Infinity },
];
const INTENT_COLORS: Record<string, string> = { informational: "var(--c4)", commercial: "var(--c1)", transactional: "var(--c2)", navigational: "var(--c3)" };
const PAGE = 10;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n));

function download(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export default function CompetitorTable({
  domain, entities, colors, topics, topicStatus, promptStatus, sites,
}: {
  domain: string; entities: Entity[]; colors: string[]; topics: Topic[];
  topicStatus: Record<Status, number>; promptStatus: Record<Status, number>; sites: Site[];
}) {
  const router = useRouter();
  const [section, setSection] = useState<"topics" | "sources">("topics");
  const [view, setView] = useState<"topics" | "prompts">("topics");
  const [status, setStatus] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [volume, setVolume] = useState("all");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [busyTopic, setBusyTopic] = useState<string | null>(null);

  const reset = () => setPage(1);
  const term = search.trim().toLowerCase();
  const range = VOLUMES.find((v) => v.key === volume)!;
  const inRange = (t: Topic) => volume === "all" || ((t.volume?.volume ?? 0) >= range.min && (t.volume?.volume ?? 0) <= range.max);

  const topicRows = useMemo(
    () =>
      topics
        .filter((t) => (status === "all" || t.status === status) && inRange(t) &&
          (!term || t.name.toLowerCase().includes(term) || t.prompts.some((p) => p.text.toLowerCase().includes(term))))
        .sort((a, b) => ((a.volume?.volume ?? 0) - (b.volume?.volume ?? 0)) * (sortAsc ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topics, status, term, volume, sortAsc],
  );
  const promptRows = useMemo(
    () =>
      topics
        .filter(inRange)
        .flatMap((t) => t.prompts.map((p) => ({ ...p, topic: t.name, volume: t.volume, intents: { [p.intent ?? ""]: 1 } })))
        .filter((p) => (status === "all" || p.status === status) && (!term || p.text.toLowerCase().includes(term) || p.topic.toLowerCase().includes(term)))
        .sort((a, b) => ((a.volume?.volume ?? 0) - (b.volume?.volume ?? 0)) * (sortAsc ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topics, status, term, volume, sortAsc],
  );
  const siteRows = sites.filter((s) => !term || s.domain.includes(term));

  const rows = section === "sources" ? siteRows : view === "topics" ? topicRows : promptRows;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const from = (Math.min(page, pages) - 1) * PAGE;
  const counts = view === "topics" ? topicStatus : promptStatus;
  const total = view === "topics" ? topics.length : topics.reduce((s, t) => s + t.prompts.length, 0);

  function monitor(t: Topic) {
    setBusyTopic(t.name);
    start(async () => {
      await toggleTopicMonitoring(domain, t.name, !t.monitoring);
      setBusyTopic(null);
      router.refresh();
    });
  }

  function exportCsv() {
    const names = entities.map((e) => e.name);
    if (section === "sources") {
      download(`${domain}-sources.csv`, [["Website", "Answers citing it", ...names], ...siteRows.map((s) => [s.domain, s.answers, ...s.counts])]);
    } else if (view === "topics") {
      download(`${domain}-topics.csv`, [["Topic", ...names, "AI volume", "Result"], ...topicRows.map((t) => [t.name, ...t.counts, t.volume?.volume ?? "", t.status ?? ""])]);
    } else {
      download(`${domain}-prompts.csv`, [["Prompt", "Topic", ...names, "Result"], ...promptRows.map((p) => [p.text, p.topic, ...p.counts, p.status ?? ""])]);
    }
  }

  const cell = (c: number, list: number[], i: number) => {
    const lead = c > 0 && c === Math.max(...list);
    return (
      <span key={i} className={`cr-num${lead ? " cr-lead" : ""}`} style={lead ? { ["--lead" as string]: colors[i] } : undefined}>
        {c}
      </span>
    );
  };
  const intentBar = (intents: Intents) => {
    const sum = Object.values(intents).reduce((s, n) => s + n, 0) || 1;
    return (
      <span className="cr-intent" title={Object.entries(intents).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join(", ")}>
        <span className="intent-bar">
          {Object.entries(intents).map(([k, n]) => n > 0 && <span key={k} style={{ width: `${(n / sum) * 100}%`, background: INTENT_COLORS[k] ?? "var(--other)" }} />)}
        </span>
      </span>
    );
  };
  const grid = { gridTemplateColumns: `minmax(240px, 2.2fr) repeat(${entities.length}, minmax(76px, 1fr)) 150px 120px 190px` };
  const promptGrid = { gridTemplateColumns: `minmax(280px, 2.6fr) repeat(${entities.length}, minmax(76px, 1fr)) 150px 110px 110px` };
  const siteGrid = { gridTemplateColumns: `minmax(240px, 2.2fr) 130px repeat(${entities.length}, minmax(76px, 1fr)) 140px` };

  return (
    <>
      <div className="cr-sections" role="tablist" aria-label="Breakdown">
        <button role="tab" aria-selected={section === "topics"} onClick={() => { setSection("topics"); reset(); }}>
          <span className="cr-section-title">Topics &amp; Prompts <span>{topics.length}</span></span>
          <span className="cr-section-sub">Find out which content works best for competitors</span>
        </button>
        <button role="tab" aria-selected={section === "sources"} onClick={() => { setSection("sources"); reset(); }}>
          <span className="cr-section-title">Sources <span>{sites.length}</span></span>
          <span className="cr-section-sub">See where AI finds information about your brand and competitors</span>
        </button>
      </div>

      <section className="card cr-table-card">
        <div className="cr-table-head">
          <h2>{section === "sources" ? "Sources" : "Topics & Prompts"} <span className="muted">{rows.length ? `${from + 1}–${Math.min(from + PAGE, rows.length)} (${rows.length})` : "(0)"}</span></h2>
          <button type="button" className="btn-secondary btn-small" onClick={exportCsv}><Icon name="download" size={15} /> Export</button>
        </div>

        <div className="cr-toolbar">
          {section === "topics" && (
            <>
              <div className="seg" role="group" aria-label="Show">
                <button aria-pressed={view === "topics"} onClick={() => { setView("topics"); reset(); }}>Topics</button>
                <button aria-pressed={view === "prompts"} onClick={() => { setView("prompts"); reset(); }}>Prompts</button>
              </div>
              <div className="seg" role="group" aria-label="Result">
                <button aria-pressed={status === "all"} onClick={() => { setStatus("all"); reset(); }}>All <span>{total}</span></button>
                {STATUSES.map((s) => (
                  <button key={s.key} aria-pressed={status === s.key} title={s.hint} onClick={() => { setStatus(s.key); reset(); }}>
                    {s.label} <span>{counts[s.key]}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="cr-search">
            <label htmlFor="cr-search" className="sr-only">Filter</label>
            <input id="cr-search" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} placeholder={section === "sources" ? "Filter by website" : "Filter by topic"} />
            <Icon name="search" size={16} />
          </div>
          {section === "topics" && (
            <label>
              <span className="sr-only">AI volume range</span>
              <select value={volume} onChange={(e) => { setVolume(e.target.value); reset(); }}>
                {VOLUMES.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="table-scroll">
          {section === "sources" ? (
            <div className="cr-grid-table">
              <div className="cr-row cr-head" style={siteGrid}>
                <span>Website</span>
                <span className="cr-num">Answers citing it</span>
                {entities.map((e, i) => <span key={e.id} className="cr-num cr-ent"><span className="dot" style={{ background: colors[i] }} /><span className="cr-ent-name">{e.name}</span></span>)}
                <span />
              </div>
              {siteRows.slice(from, from + PAGE).map((s) => (
                <div className="cr-row" style={siteGrid} key={s.domain}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="url">{s.domain}</a>
                  <span className="cr-num">{s.answers}</span>
                  {s.counts.map((c, i) => cell(c, s.counts, i))}
                  <span>{s.owner === 0 ? <span className="pill pill-shared">Your site</span> : s.counts[0] === 0 && s.counts.some(Boolean) ? <span className="pill pill-bad">You&apos;re missing</span> : null}</span>
                </div>
              ))}
            </div>
          ) : view === "topics" ? (
            <div className="cr-grid-table">
              <div className="cr-row cr-head" style={grid}>
                <span>Topic</span>
                {entities.map((e, i) => <span key={e.id} className="cr-num cr-ent" title={e.name}><span className="dot" style={{ background: colors[i] }} /><span className="cr-ent-name">{e.name}</span></span>)}
                <button className="cr-sort" onClick={() => setSortAsc(!sortAsc)} aria-label="Sort by AI volume">AI Volume <Icon name="sort" size={14} /></button>
                <span>Intent</span>
                <span />
              </div>
              {topicRows.slice(from, from + PAGE).map((t) => {
                const isOpen = open.has(t.name);
                return (
                  <Fragment key={t.name}>
                    <div className="cr-row" style={grid}>
                      <button className="cr-expand" aria-expanded={isOpen}
                        onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(t.name)) n.delete(t.name); else n.add(t.name); return n; })}>
                        <Icon name="chevron" size={14} />{t.name}
                      </button>
                      {t.counts.map((c, i) => cell(c, t.counts, i))}
                      <span className="cr-vol"><Sparkline values={t.volume?.monthly ?? []} /><b>{t.volume ? compact(t.volume.volume) : "n/a"}</b></span>
                      {intentBar(t.intents)}
                      <span className="cr-act">
                        <button type="button" className={t.monitoring ? "btn-dark btn-small" : "btn-secondary btn-small"} disabled={pending && busyTopic === t.name}
                          onClick={() => monitor(t)} title={t.monitoring ? "These questions are checked in every run. Click to pause them." : "Paused: click to check these questions again."}>
                          <Icon name="search" size={14} /> {t.monitoring ? "Monitoring" : "Monitor all prompts"}
                        </button>
                      </span>
                    </div>
                    {isOpen && t.prompts.map((p) => (
                      <div className="cr-row cr-sub" style={grid} key={p.text}>
                        <span className="cr-sub-text">{p.text}</span>
                        {p.counts.map((c, i) => cell(c, p.counts, i))}
                        <span className="muted cr-num">{p.answers} answers</span>
                        <span className="muted">{p.intent ?? ""}</span>
                        <span>{p.status && <span className={`pill pill-${p.status}`}>{STATUSES.find((s) => s.key === p.status)!.label}</span>}</span>
                      </div>
                    ))}
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <div className="cr-grid-table">
              <div className="cr-row cr-head" style={promptGrid}>
                <span>Prompt</span>
                {entities.map((e, i) => <span key={e.id} className="cr-num cr-ent" title={e.name}><span className="dot" style={{ background: colors[i] }} /><span className="cr-ent-name">{e.name}</span></span>)}
                <button className="cr-sort" onClick={() => setSortAsc(!sortAsc)} aria-label="Sort by AI volume">Topic volume <Icon name="sort" size={14} /></button>
                <span>Intent</span>
                <span>Result</span>
              </div>
              {promptRows.slice(from, from + PAGE).map((p) => (
                <div className="cr-row" style={promptGrid} key={p.topic + p.text}>
                  <span className="cr-sub-text">{p.text}<small className="muted">{p.topic}</small></span>
                  {p.counts.map((c, i) => cell(c, p.counts, i))}
                  <span className="cr-vol"><Sparkline values={p.volume?.monthly ?? []} /><b>{p.volume ? compact(p.volume.volume) : "n/a"}</b></span>
                  <span className="muted">{p.intent ?? ""}</span>
                  <span>{p.status && <span className={`pill pill-${p.status}`}>{STATUSES.find((s) => s.key === p.status)!.label}</span>}</span>
                </div>
              ))}
            </div>
          )}
          {rows.length === 0 && <p className="note cr-empty">Nothing matches these filters.</p>}
        </div>

        <div className="cr-pagination">
          <label>
            Page
            <input type="number" min={1} max={pages} value={Math.min(page, pages)} onChange={(e) => setPage(Math.max(1, Math.min(pages, Number(e.target.value) || 1)))} />
          </label>
          <span>of {pages}</span>
          <button type="button" className="icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><Icon name="chevron" size={16} /></button>
          <button type="button" className="icon-btn" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><Icon name="chevron" size={16} /></button>
        </div>
      </section>
    </>
  );
}
