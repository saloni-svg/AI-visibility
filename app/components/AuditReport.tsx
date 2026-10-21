"use client";

import { useMemo, useState } from "react";
import type { AuditData } from "@/lib/audit/report";
import AuditGauge from "./AuditGauge";
import AuditPages from "./AuditPages";
import Icon from "./Icon";

type Tab = "overview" | "issues" | "pages";
type Sev = "all" | "error" | "warning" | "notice";
const SEV_LABEL = { error: "Errors", warning: "Warnings", notice: "Notices" } as const;
const CATEGORIES = [
  { key: "ai", label: "AI Search" }, { key: "crawlability", label: "Crawlability" }, { key: "content", label: "Content" },
  { key: "meta", label: "Meta tags" }, { key: "linking", label: "Internal linking" }, { key: "https", label: "HTTPS" },
  { key: "performance", label: "Performance" }, { key: "markup", label: "Markup" }, { key: "international", label: "International" },
];
const BOTS = [
  { name: "ChatGPT-User", label: "ChatGPT-User" }, { name: "OAI-SearchBot", label: "OAI-SearchBot" }, { name: "Googlebot", label: "Googlebot" },
  { name: "Google-Extended", label: "Google-Extended" }, { name: "PerplexityBot", label: "PerplexityBot" }, { name: "ClaudeBot", label: "ClaudeBot" },
  { name: "GPTBot", label: "GPTBot" },
];
// "have duplicate titles" → "has duplicate titles" when there's one page.
const SINGULAR: Record<string, string> = { have: "has", are: "is", "don't": "doesn't", need: "needs", return: "returns", show: "shows", load: "loads", link: "links", "aren't": "isn't" };
const agree = (label: string, n: number) => {
  if (n !== 1) return label;
  const [first, ...rest] = label.split(" ");
  return [SINGULAR[first] ?? first, ...rest].join(" ");
};
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");
const inCategory = (i: AuditData["issues"][number], cat: string) => (cat === "ai" ? i.ai : i.category === cat);

function Trend({ values, color, height = 56 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return <svg className="au-trend" viewBox={`0 0 300 ${height}`}><line x1="0" x2="300" y1={height - 6} y2={height - 6} stroke={color} strokeWidth="2" /></svg>;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 296 + 2, height - 6 - (v / max) * (height - 14)]);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <svg className="au-trend" viewBox={`0 0 300 ${height}`} aria-hidden="true">
      <polygon points={`2,${height - 6} ${line} 298,${height - 6}`} fill={color} opacity="0.15" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill={color} />)}
    </svg>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  if (values.length < 2) return <span className="au-spark empty" />;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 96 + 2},${24 - (v / max) * 20}`).join(" ");
  return <svg className="au-spark" viewBox="0 0 100 28" aria-hidden="true"><polygon points={`2,26 ${pts} 98,26`} fill="var(--accent-soft)" /><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" /></svg>;
}

function Ring({ value }: { value: number }) {
  const c = 2 * Math.PI * 9;
  return (
    <svg viewBox="0 0 24 24" className="au-ring" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--grid)" strokeWidth="4" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--you)" strokeWidth="4" strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 12 12)" />
    </svg>
  );
}

export default function AuditReport({ data, domain }: { data: AuditData; domain: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [sev, setSev] = useState<Sev>("all");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{ code: string; part: "fix" | "pages" } | null>(null);
  const [showCwv, setShowCwv] = useState(false);
  const [scope, setScope] = useState<"triggered" | "all">("triggered");
  const found = useMemo(() => data.issues.filter((i) => i.triggered), [data.issues]);
  const r = data.run;
  const prev = data.previous;
  const change = (a: number | null, b: number | null | undefined) => (a === null || b === null || b === undefined ? null : a - b);

  const filtered = useMemo(
    () => (scope === "all" ? data.issues : found).filter((i) =>
      (sev === "all" || i.severity === sev) && (cat === "all" || inCategory(i, cat)) &&
      (!q || `${i.title} ${i.label}`.toLowerCase().includes(q.toLowerCase()))),
    [data.issues, found, scope, sev, cat, q],
  );
  const sevCount = (s: Sev) => found.filter((i) => (s === "all" || i.severity === s) && (cat === "all" || inCategory(i, cat))).length;
  const catCount = (c: string) => found.filter((i) => inCategory(i, c)).length;
  const aiIssues = found.filter((i) => i.ai).reduce((s, i) => s + (i.siteWide ? 1 : i.pages.length), 0);
  const blocked = new Set<string>([...(r.checks.blocked_ai_bots ?? []), ...(r.checks.blocked_search_bots ?? [])]);
  const goIssues = (c = "all", s: Sev = "all") => { setCat(c); setSev(s); setTab("issues"); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const exportCsv = () => {
    const rows = [["Severity", "Issue", "Pages", "URL"], ...found.flatMap((i) =>
      i.siteWide ? [[i.severity, i.title, "site-wide", ""]] : i.pages.map((u) => [i.severity, i.title, String(i.pages.length), u]))];
    const csv = rows.map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `${domain}-site-audit.csv` }).click();
    URL.revokeObjectURL(url);
  };

  const statusRows = [
    { key: "healthy", label: "Healthy", color: "var(--good)" },
    { key: "broken", label: "Broken", color: "var(--bad)" },
    { key: "issues", label: "Have issues", color: "#e0a030" },
    { key: "redirects", label: "Redirects", color: "var(--c1)" },
    { key: "blocked", label: "Blocked", color: "var(--other)" },
  ] as const;
  const totalPages = Math.max(1, statusRows.reduce((s, x) => s + data.status[x.key], 0));
  const aiMsg = r.scores.aiHealth >= 80 ? "Website is well optimized for AI search engines" : r.scores.aiHealth >= 60 ? "Some pages are hard for AI search engines to use" : "AI search engines struggle to use this website";

  const thematic: { key: string; label: string; value: number | null; empty: string }[] = [
    { key: "crawlability", label: "Crawlability", value: r.scores.crawlability, empty: "–" },
    { key: "https", label: "HTTPS", value: r.scores.https, empty: "–" },
    { key: "international", label: "International SEO", value: r.scores.international, empty: "International SEO is not implemented on this site." },
    { key: "cwv", label: "Core Web Vitals", value: r.scores.cwv, empty: "Not measured. Add PAGESPEED_API_KEY to .env and rerun." },
    { key: "performance", label: "Site Performance", value: r.scores.performance, empty: "–" },
    { key: "linking", label: "Internal Linking", value: r.scores.linking, empty: "–" },
    { key: "markup", label: "Markup", value: r.scores.markup, empty: "–" },
  ];

  return (
    <>
      <div className="au-actions-row">
        <nav className="au-tabs" role="tablist" aria-label="Report">
          {([["overview", "Overview"], ["issues", "Issues"], ["pages", "Crawled Pages"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
        <div className="au-tools">
          <button type="button" className="btn-secondary btn-small" onClick={exportCsv}><Icon name="download" size={14} /> Export</button>
          <button type="button" className="btn-secondary btn-small" onClick={() => window.print()}>PDF</button>
        </div>
      </div>

      {tab === "overview" && (
        <div className="au-overview">
          <section className="au-row4">
            <div className="card au-split">
              <div className="au-box">
                <h3>Site Health</h3>
                <AuditGauge value={r.scores.siteHealth} change={change(r.scores.siteHealth, prev?.scores.siteHealth)} />
              </div>
              <div className="au-box">
                <h3>Crawled Pages</h3>
                <p className="au-big">{r.pages}{prev && r.pages !== prev.pages && <span className="au-delta">{r.pages > prev.pages ? "+" : ""}{r.pages - prev.pages}</span>}</p>
                <div className="au-stack" aria-hidden="true">
                  {statusRows.map((x) => <span key={x.key} style={{ width: `${(data.status[x.key] / totalPages) * 100}%`, background: x.color }} />)}
                </div>
                <ul className="au-legend">
                  {statusRows.map((x) => <li key={x.key}><span className="dot" style={{ background: x.color }} />{x.label}<b>{data.status[x.key]}</b></li>)}
                </ul>
              </div>
            </div>
            <div className="card au-split">
              <div className="au-box">
                <h3>AI Search Health <span className="au-beta">AI</span></h3>
                <AuditGauge value={r.scores.aiHealth} change={change(r.scores.aiHealth, prev?.scores.aiHealth)} color="#2dbf8f" />
                <p className="au-msg">{aiMsg}</p>
                <button type="button" className="link-btn au-link" onClick={() => goIssues("ai")}>{aiIssues} issues</button>
              </div>
              <div className="au-box">
                <h3>Blocked from AI Search</h3>
                <p className="note au-crawled">Pages crawled: {r.pages}</p>
                <ul className="au-bots">
                  {BOTS.map((b) => (
                    <li key={b.name}>
                      <span>{b.label}</span>
                      {r.checks.robots === undefined ? <span className="muted">–</span>
                        : blocked.has(b.name) ? <span className="au-bad-mark" title="Blocked in robots.txt">✕</span>
                        : <span className="au-ok-mark" title="Allowed">✓</span>}
                    </li>
                  ))}
                </ul>
                <p className="note">{r.checks.llms_txt ? "✓ llms.txt found" : "No llms.txt"}</p>
              </div>
            </div>
          </section>

          <section className="au-row2">
            <div className="card au-ew">
              <div>
                <h3>Errors</h3>
                <p className="au-big err">{r.counts.errors}<span className="au-delta-txt">{prev ? (r.counts.errors === prev.counts.errors ? "no changes" : `${r.counts.errors > prev.counts.errors ? "+" : ""}${r.counts.errors - prev.counts.errors}`) : ""}</span></p>
                <Trend values={data.history.map((h) => h.errors)} color="var(--bad)" />
              </div>
              <div>
                <h3>Warnings</h3>
                <p className="au-big warn">{r.counts.warnings}<span className="au-delta-txt">{prev ? (r.counts.warnings === prev.counts.warnings ? "no changes" : `${r.counts.warnings > prev.counts.warnings ? "+" : ""}${r.counts.warnings - prev.counts.warnings}`) : ""}</span></p>
                <Trend values={data.history.map((h) => h.warnings)} color="#e0a030" />
              </div>
            </div>
            <div className="au-top-issues">
              <div className="card">
                {found.slice(0, 5).map((i) => (
                  <div key={i.code} className="au-ti">
                    <span className={`au-sev-icon ${i.severity}`} aria-label={i.severity}>{i.severity === "notice" ? "i" : "!"}</span>
                    <span className="au-ti-title">{i.title}{i.ai && <span className="au-ai-tag">AI Search</span>}</span>
                    <button type="button" className="link-btn" onClick={() => { goIssues(); setOpen({ code: i.code, part: "pages" }); }}>
                      {i.siteWide ? "site-wide" : `${i.pages.length} ${i.pages.length === 1 ? i.unit.replace(/s$/, "") : i.unit}`}
                    </button>
                    <button type="button" className="au-howto" onClick={() => { goIssues(); setOpen({ code: i.code, part: "fix" }); }}>How to fix</button>
                  </div>
                ))}
                {found.length === 0 && <p className="note cr-empty">No issues found. 🎉</p>}
              </div>
              <button type="button" className="au-viewall" onClick={() => goIssues()}>View all issues →</button>
            </div>
          </section>

          <section className="card au-thematic">
            <h3>Thematic Reports</h3>
            <div className="au-th-grid">
              <div className="au-th">
                <span className="au-th-label">Robots.txt</span>
                <span className="note">{r.checks.robots ? "Found" : "Not found"}</span>
                {r.checks.robots && <a className="btn-secondary btn-small" href={`https://${domain}/robots.txt`} target="_blank" rel="noreferrer">Open file ↗</a>}
              </div>
              {thematic.map((t) => (
                <div key={t.key} className="au-th">
                  <span className="au-th-label">{t.label}</span>
                  {t.value === null ? <span className="note au-th-empty">{t.empty}</span> : (
                    <>
                      <span className="au-th-value"><Ring value={t.value} />{t.value}%
                        {(() => { const c = change(t.value, (prev?.scores as Record<string, number | null> | undefined)?.[t.key]); return c ? <span className={`au-delta ${c > 0 ? "up" : "down"}`}>{c > 0 ? "+" : ""}{c}</span> : null; })()}
                      </span>
                      <button type="button" className="btn-secondary btn-small" onClick={() => (t.key === "cwv" ? setShowCwv(!showCwv) : goIssues(t.key))}>View details</button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {showCwv && data.cwv.length > 0 && (
              <ul className="au-cwv-list">
                {data.cwv.map((c) => (
                  <li key={c.url}>
                    <span className={`pill ${c.pass ? "pill-strong" : "pill-missing"}`}>{c.pass ? "Pass" : "Fail"}</span>
                    <b>{short(c.url)}</b>
                    <span className="muted">LCP {c.lcp ? `${(c.lcp / 1000).toFixed(1)}s` : "–"} · CLS {c.cls ?? "–"} · {c.inp ? `INP ${c.inp}ms` : `TBT ${c.tbt ?? "–"}ms`} · {c.source === "field" ? "real users" : "lab test"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "issues" && (
        <div className="au-issues-tab">
          <div className="au-filters">
            <div className="cr-search">
              <label htmlFor="au-iq" className="sr-only">Search issues</label>
              <input id="au-iq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
              <Icon name="search" size={16} />
            </div>
            <div className="seg au-cats-seg" role="group" aria-label="Category">
              <button aria-pressed={cat === "all"} onClick={() => setCat("all")}>All <span>{found.length}</span></button>
              {CATEGORIES.filter((c) => catCount(c.key) || scope === "all").map((c) => (
                <button key={c.key} aria-pressed={cat === c.key} onClick={() => setCat(c.key)}>
                  {c.key === "ai" && <Icon name="sparkles" size={12} />} {c.label} <span>{catCount(c.key)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="au-filter-row">
            <div className="seg" role="group" aria-label="Severity">
              {(["all", "error", "warning", "notice"] as const).map((s) => (
                <button key={s} aria-pressed={sev === s} onClick={() => setSev(s)}>{s === "all" ? "All" : SEV_LABEL[s]} <span>{sevCount(s)}</span></button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Checks shown">
              <button aria-pressed={scope === "triggered"} onClick={() => setScope("triggered")}>Triggered checks</button>
              <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>All checks <span>{data.issues.length}</span></button>
            </div>
          </div>

          {(["error", "warning", "notice"] as const).filter((s) => sev === "all" || sev === s).map((s) => {
            const items = filtered.filter((i) => i.severity === s);
            if (!items.length) return null;
            return (
              <section key={s} className={`card au-group ${s}`}>
                <h3>{SEV_LABEL[s]} <span className="muted">({items.filter((i) => i.triggered).length})</span></h3>
                {items.map((i) => {
                  const isOpen = open?.code === i.code;
                  if (!i.triggered) {
                    return (
                      <div key={i.code} className="au-irow passed">
                        <div className="au-irow-main">
                          <p className="au-irow-text">
                            {i.siteWide ? <span className="au-pass">✓ Passed:</span> : <span className="au-zero">0 {i.unit}</span>}
                            <span className="au-irow-label">{i.siteWide ? i.passed ?? i.title : i.label}</span>
                            {i.ai && <span className="au-ai-tag">AI Search</span>}
                            <button type="button" className="au-howto" onClick={() => setOpen(isOpen ? null : { code: i.code, part: "fix" })}>Learn more</button>
                          </p>
                          <span />
                          <Spark values={i.trend} />
                          <span />
                        </div>
                        {isOpen && (
                          <div className="au-fix">
                            <p><b>What we check:</b> {i.why}</p>
                            <p><b>Good practice:</b> {i.fix}</p>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={i.code} className="au-irow">
                      <div className="au-irow-main">
                        <p className="au-irow-text">
                          {i.siteWide ? <span className="au-irow-label">{i.label}</span> : (
                            <>
                              <button type="button" className="link-btn" onClick={() => setOpen(isOpen && open?.part === "pages" ? null : { code: i.code, part: "pages" })}>
                                {i.pages.length} {i.pages.length === 1 ? i.unit.replace(/s$/, "") : i.unit}
                              </button>{" "}
                              <span className="au-irow-label">{agree(i.label, i.pages.length)}</span>
                            </>
                          )}
                          {i.ai && <span className="au-ai-tag">AI Search</span>}
                          <button type="button" className="au-howto" onClick={() => setOpen(isOpen && open?.part === "fix" ? null : { code: i.code, part: "fix" })}>How to fix</button>
                        </p>
                        <span className="au-new">{i.newCount ? `${i.newCount} new ${i.newCount === 1 ? "issue" : "issues"}` : ""}</span>
                        <Spark values={i.trend} />
                        {!i.siteWide && (
                          <button type="button" className="icon-btn" aria-label="Show affected pages" onClick={() => setOpen(isOpen && open?.part === "pages" ? null : { code: i.code, part: "pages" })}>
                            <Icon name="list" size={15} />
                          </button>
                        )}
                      </div>
                      {isOpen && open?.part === "fix" && (
                        <div className="au-fix">
                          <p><b>Why it matters:</b> {i.why}</p>
                          <p><b>How to fix:</b> {i.fix}</p>
                        </div>
                      )}
                      {isOpen && open?.part === "pages" && !i.siteWide && (
                        <ul className="au-urls">
                          {i.pages.slice(0, 200).map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer" className="url">{short(u)}</a></li>)}
                          {i.pages.length > 200 && <li className="muted">…and {i.pages.length - 200} more (use Export)</li>}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
          {filtered.length === 0 && <div className="card"><p className="note cr-empty">No issues match these filters.</p></div>}
        </div>
      )}

      {tab === "pages" && <AuditPages pages={data.pages} />}
    </>
  );
}
