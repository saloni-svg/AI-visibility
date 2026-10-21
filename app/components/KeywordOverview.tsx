"use client";
import { fmtDay, fmtMonth, fmtNum } from "./format";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Idea, KeywordReport } from "@/lib/keyword-research";
import { researchKeyword } from "../(dashboard)/actions";
import Icon from "./Icon";

const flag = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0))) : "🌐");
const compact = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n);
const kdBand = (kd: number) =>
  kd < 15 ? { label: "Very easy", color: "#2db67c", text: "Easy to rank for with good, relevant content." }
    : kd < 30 ? { label: "Easy", color: "#7ccf6b", text: "Rankable with well-optimized content and a few quality links." }
    : kd < 50 ? { label: "Possible", color: "#f2c94c", text: "You'll need well-structured, unique content and some backlinks." }
    : kd < 70 ? { label: "Difficult", color: "#f2994a", text: "You'll need strong content and quality referring domains to compete." }
    : kd < 85 ? { label: "Hard", color: "#eb5757", text: "Requires many quality backlinks and highly optimized content." }
    : { label: "Very hard", color: "#b3261e", text: "Dominated by strong sites: a long-term effort with heavy link building." };
const INTENT: Record<string, string> = { informational: "Informational", navigational: "Navigational", commercial: "Commercial", transactional: "Transactional", local: "Local" };
const FEATURE: Record<string, string> = {
  ai_overview: "AI Overview", featured_snippet: "Featured snippet", local_pack: "Local pack", people_also_ask: "People also ask", video: "Videos",
  images: "Images", top_stories: "Top stories", knowledge_graph: "Knowledge panel", paid: "Ads", google_reviews: "Reviews", related_searches: "Related searches",
  popular_products: "Popular products", google_shopping: "Shopping", twitter: "X posts", perspectives: "Perspectives", discussions_and_forums: "Forums", map: "Map",
};
const PAGE = 10;
const money = (n: number, currency = "USD") => new Intl.NumberFormat("en", { style: "currency", currency }).format(n);

function KdDot({ kd }: { kd: number | null }) {
  if (kd === null) return <span className="muted">n/a</span>;
  return <span className="kw-kd">{kd}<span className="dot" style={{ background: kdBand(kd).color }} /></span>;
}

function IdeasTable({ items, limit }: { items: Idea[]; limit: number }) {
  return (
    <table className="kw-ideas">
      <thead><tr><th>Keywords</th><th className="num">Volume</th><th className="num">KD %</th></tr></thead>
      <tbody>
        {items.slice(0, limit).map((i) => (
          <tr key={i.keyword}>
            <td><a href={`/keywords?q=${encodeURIComponent(i.keyword)}`} className="url">{i.keyword}</a></td>
            <td className="num">{compact(i.volume)}</td>
            <td className="num"><KdDot kd={i.kd} /></td>
          </tr>
        ))}
        {items.length === 0 && <tr><td colSpan={3} className="muted">No keywords found.</td></tr>}
      </tbody>
    </table>
  );
}

function download(name: string, rows: (string | number | null)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export default function KeywordOverview({ report: r, rates }: { report: KeywordReport; rates: Record<string, number> | null }) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");
  // CPCs are saved in the report's currency; any other currency is converted through USD at today's rate.
  const saved = r.currency ?? "USD";
  // CPCs come in USD, the figure Semrush also shows, so USD is the default.
  const [cur, setCur] = useState(rates ? "USD" : saved);
  const toUsd = r.usdRate ?? (saved === "USD" ? 1 : rates?.[saved] ?? null);
  const currencies = rates && toUsd ? Object.keys(rates) : [saved];
  const cpc = (n: number) => (cur === saved || !rates?.[cur] || !toUsd ? money(n, saved) : money((n / toUsd) * rates[cur], cur));
  const [mine, setMine] = useState("");
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<"url" | "domain">("url");
  const [full, setFull] = useState<"variations" | "questions" | null>(null);
  const [fullQ, setFullQ] = useState("");
  const [fullPage, setFullPage] = useState(0);
  const [showClusters, setShowClusters] = useState(false);
  const myDomain = mine.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

  const kd = r.kd !== null ? kdBand(r.kd) : null;
  const topCountries = r.byCountry.slice(0, 6);
  const otherVolume = r.globalVolume !== null ? Math.max(0, r.globalVolume - topCountries.reduce((s, c) => s + c.volume, 0)) : 0;
  const maxCountry = Math.max(1, ...topCountries.map((c) => c.volume), otherVolume);
  const maxTrend = Math.max(1, ...r.trend.map((t) => t.volume));
  const myRow = myDomain ? r.serp.rows.find((x) => x.domain === myDomain || x.domain.endsWith(`.${myDomain}`)) : null;

  const fullList = useMemo(() => {
    const list = full === "questions" ? r.questions.items : r.variations.items;
    const t = fullQ.trim().toLowerCase();
    return t ? list.filter((i) => i.keyword.includes(t)) : list;
  }, [full, fullQ, r]);

  async function update() {
    setUpdating(true);
    setUpdateError("");
    const res = await researchKeyword(r.keyword, r.country, r.device);
    setUpdating(false);
    if ("error" in res) return setUpdateError(res.error);
    router.refresh();
  }

  return (
    <div className="kw-overview">
      <div className="kw-meta">
        <span>{flag(r.country)} {r.country}</span>
        <span><Icon name="grid" size={13} /> {r.device === "mobile" ? "Mobile" : "Desktop"}</span>
        <span>{fmtDay(r.createdAt)}</span>
        <label className="kw-currency">
          <span className="sr-only">Currency</span>
          <select value={cur} onChange={(e) => setCur(e.target.value)} disabled={currencies.length < 2}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <span className="muted" title="Volume, CPC and trend are Google Ads figures; difficulty, intent and keyword ideas come from DataForSEO Labs. Other tools (e.g. Semrush) use their own models, so their numbers differ slightly.">Source: {r.source ?? "DataForSEO"}</span>
        <div className="kw-meta-right">
          <div className="kw-mine">
            <Icon name="sparkles" size={13} />
            <label htmlFor="kw-mine" className="sr-only">Your domain</label>
            <input id="kw-mine" value={mine} onChange={(e) => setMine(e.target.value)} placeholder="Enter domain for personalized data" />
          </div>
          <button type="button" className="btn-secondary btn-small" onClick={update} disabled={updating}>{updating ? "Updating…" : "↻ Update metrics"}</button>
          <button type="button" className="btn-secondary btn-small" onClick={() => window.print()}><Icon name="download" size={13} /> Export to PDF</button>
        </div>
      </div>
      {myDomain && (
        <p className={`kw-mine-result ${myRow ? "ok" : ""}`}>
          {myRow ? <>✓ <b>{myDomain}</b> ranks <b>#{myRow.position}</b> for this keyword ({myRow.url.replace(/^https?:\/\/(www\.)?/, "")})</> : <><b>{myDomain}</b> isn&apos;t in the top 100 for this keyword.</>}
        </p>
      )}
      {updateError && <p className="field-error">Couldn&apos;t update: {updateError}</p>}
      {r.notice && <p className="note kw-notice">{r.notice}</p>}
      {r.problems.length > 0 &&<p className="note kw-problems">Some data couldn&apos;t be loaded: {r.problems.join(" · ")}</p>}

      {/* ---- Top cards ---- */}
      <div className="kw-layout">
        <aside className="kw-metrics" aria-label="Key metrics">
  <div className="card kw-card">
          <span className="kw-label">Volume</span>
          <span className="kw-big">{compact(r.volume)} <span className="kw-flag">{flag(r.country)}</span></span>
          <hr />
          <span className="kw-label">Keyword Difficulty</span>
          {r.kd === null || !kd ? <span className="kw-big muted">n/a</span> : (
            <>
              <span className="kw-kd-big">
                {r.kd}%
                <svg viewBox="0 0 36 36" className="kw-ring" aria-hidden="true">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="var(--grid)" strokeWidth="6" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke={kd.color} strokeWidth="6" strokeDasharray={`${(2 * Math.PI * 14 * r.kd) / 100} 100`} transform="rotate(-90 18 18)" />
                </svg>
              </span>
              <span className="kw-kd-label">{kd.label}</span>
              <p className="note">{kd.text}</p>
            </>
          )}
        </div>
          <div className="card kw-card kw-small">
            <span className="kw-label">Intent</span>
            <div className="kw-intents">
              {r.intents.length ? r.intents.slice(0, 1).map((i) => <span key={i} className={`kw-intent ${i}`}>{INTENT[i] ?? i}</span>) : <span className="muted">n/a</span>}
            </div>
          </div>
  <div className="card kw-card">
          <span className="kw-label">CPC</span>
          <span className="kw-big">{r.cpc !== null ? cpc(r.cpc) : "n/a"}</span>
          <hr />
          <span className="kw-label" title="How many advertisers bid on this keyword (0 = none, 1 = 50 or more)">Competitive Density</span>
          <span className="kw-big">{r.competition !== null ? r.competition.toFixed(2) : "n/a"}</span>
          {r.advertisers != null && <span className="note">{r.advertisers} advertiser{r.advertisers === 1 ? "" : "s"} seen</span>}
          <hr />
          <div className="kw-two">
            <div><span className="kw-label">PLA</span><span className="kw-big">{r.pla.length ? r.pla.length : "n/a"}</span></div>
            <div><span className="kw-label">Ads</span><span className="kw-big">{r.ads.length ? r.ads.length : "n/a"}</span></div>
          </div>
        </div>
        </aside>
        <div className="kw-results">
          <div className="kw-charts">
    <div className="card kw-card">
          <span className="kw-label" title="Sum of this keyword's volume across the 15 biggest markets">Global Volume</span>
          <span className="kw-big">{compact(r.globalVolume)}</span>
          {topCountries.length > 0 ? (
            <ul className="kw-countries">
              {topCountries.map((c) => (
                <li key={c.code}>
                  <span className={c.code === r.country ? "kw-cc on" : "kw-cc"}>{flag(c.code)} {c.code}</span>
                  <span className="dist-track"><span style={{ width: `${(c.volume / maxCountry) * 100}%`, background: c.code === r.country ? "var(--you)" : "var(--select-line)" }} /></span>
                  <b>{compact(c.volume)}</b>
                </li>
              ))}
              {otherVolume > 0 && (
                <li className="kw-other"><span>Other</span><span className="dist-track"><span style={{ width: `${(otherVolume / maxCountry) * 100}%`, background: "var(--select-line)" }} /></span><b>{compact(otherVolume)}</b></li>
              )}
            </ul>
          ) : <p className="note">No country breakdown available.</p>}
        </div>
            <div className="card kw-card kw-grow">
            <span className="kw-label">Trend</span>
            {r.trend.length ? (
              <div className="kw-trend" role="img" aria-label="Search volume over the last 12 months">
                {r.trend.map((t) => (
                  <span key={t.month} title={`${fmtMonth(t.month)}: ${fmtNum(t.volume)}`}
                    style={{ height: `${Math.max(3, (t.volume / maxTrend) * 100)}%` }} />
                ))}
              </div>
            ) : <p className="note">No trend data.</p>}
          </div>
          </div>


      {/* ---- Keyword ideas ---- */}
      <section className="card kw-section">
        <h2>Keyword ideas</h2>
        <div className="kw-ideas-grid">
          <div>
            <span className="kw-label">Keyword Variations</span>
            <p className="kw-count"><b>{compact(r.variations.total)}</b>{r.variations.items.length > 0 && <> Volume of top {r.variations.items.length}: <b>{compact(r.variations.totalVolume)}</b></>}</p>
            <IdeasTable items={r.variations.items} limit={5} />
            <button type="button" className="btn-secondary btn-small" onClick={() => { setFull("variations"); setFullPage(0); }}>View all {compact(r.variations.items.length)} keywords</button>
          </div>
          <div>
            <span className="kw-label">Questions</span>
            <p className="kw-count"><b>{compact(r.questions.total)}</b>{r.questions.items.length > 0 && <> Volume of top {r.questions.items.length}: <b>{compact(r.questions.totalVolume)}</b></>}</p>
            <IdeasTable items={r.questions.items} limit={5} />
            <button type="button" className="btn-secondary btn-small" onClick={() => { setFull("questions"); setFullPage(0); }}>View all {r.questions.items.length} keywords</button>
          </div>
          <div>
            <span className="kw-label">Keyword Strategy</span>
            <p className="note kw-strategy-note">Topics, pillar and subpages, grouped <b>automatically</b> by AI</p>
            <ul className="kw-tree">
              <li className="kw-pillar">{r.clusters.pillar}</li>
              {r.clusters.pages.map((p) => (
                <li key={p.title}>
                  <span className="kw-branch" aria-hidden="true" />
                  <span>
                    {p.title}
                    {showClusters && <span className="kw-cluster-kws">{p.keywords.slice(0, 8).join(" · ")}</span>}
                  </span>
                </li>
              ))}
              {r.clusters.pages.length === 0 && <li className="muted">Not enough keyword ideas to plan a strategy.</li>}
            </ul>
            {r.clusters.pages.length > 0 && (
              <button type="button" className="btn-secondary btn-small" onClick={() => setShowClusters(!showClusters)}>{showClusters ? "Hide keywords" : "View all clusters"}</button>
            )}
          </div>
        </div>

        {full && (
          <div className="kw-full">
            <div className="kw-full-head">
              <h3>{full === "questions" ? "Questions" : "Keyword variations"} <span className="muted">({fullList.length})</span></h3>
              <div className="kw-full-tools">
                <div className="cr-search">
                  <label htmlFor="kw-f" className="sr-only">Filter keywords</label>
                  <input id="kw-f" value={fullQ} onChange={(e) => { setFullQ(e.target.value); setFullPage(0); }} placeholder="Filter keywords" />
                  <Icon name="search" size={16} />
                </div>
                <button type="button" className="btn-secondary btn-small" onClick={() => download(`${r.keyword}-${full}.csv`, [["Keyword", "Volume", "KD %", "CPC", "Intent"], ...fullList.map((i) => [i.keyword, i.volume, i.kd, i.cpc, i.intent])])}>
                  <Icon name="download" size={13} /> Export
                </button>
                <button type="button" className="link-btn" onClick={() => setFull(null)}>Close</button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="kw-ideas kw-ideas-full">
                <thead><tr><th>Keyword</th><th>Intent</th><th className="num">Volume</th><th className="num">KD %</th><th className="num">CPC</th></tr></thead>
                <tbody>
                  {fullList.slice(fullPage * 50, fullPage * 50 + 50).map((i) => (
                    <tr key={i.keyword}>
                      <td><a href={`/keywords?q=${encodeURIComponent(i.keyword)}&country=${r.country}`} className="url">{i.keyword}</a></td>
                      <td>{i.intent ? <span className={`kw-intent sm ${i.intent}`}>{(INTENT[i.intent] ?? i.intent).charAt(0)}</span> : <span className="muted">–</span>}</td>
                      <td className="num">{i.volume !== null && i.volume !== undefined ? fmtNum(i.volume) : "n/a"}</td>
                      <td className="num"><KdDot kd={i.kd} /></td>
                      <td className="num">{i.cpc !== null ? cpc(i.cpc) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fullList.length > 50 && (
              <div className="cr-pagination">
                <button type="button" className="btn-secondary btn-small" disabled={fullPage === 0} onClick={() => setFullPage(fullPage - 1)}>Prev</button>
                <button type="button" className="btn-dark btn-small" disabled={(fullPage + 1) * 50 >= fullList.length} onClick={() => setFullPage(fullPage + 1)}>Next</button>
                <span>Page {fullPage + 1} of {Math.ceil(fullList.length / 50)}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---- SERP analysis ---- */}
      <section className="card kw-section kw-serp">
        <div className="kw-serp-head">
          <h2>SERP Analysis</h2>
          <div className="seg" role="group" aria-label="Show">
            <button aria-pressed={mode === "domain"} onClick={() => setMode("domain")}>Domain</button>
            <button aria-pressed={mode === "url"} onClick={() => setMode("url")}>URL</button>
          </div>
          <div className="kw-serp-tools">
            <a href={`https://www.google.com/search?q=${encodeURIComponent(r.keyword)}`} target="_blank" rel="noreferrer" className="link-btn">View SERP ↗</a>
            <button type="button" className="btn-secondary btn-small" onClick={() => download(`${r.keyword}-serp.csv`, [["Position", "URL", "Domain", "Page AS", "Ref. Domains", "Backlinks", "Search Traffic", "URL Keywords"], ...r.serp.rows.map((x) => [x.position, x.url, x.domain, x.rank, x.refDomains, x.backlinks, x.traffic, x.keywords])])}>
              <Icon name="download" size={13} /> Export
            </button>
          </div>
        </div>
        <div className="kw-serp-stats">
          <div><span className="kw-label">Results</span><span className="kw-big">{compact(r.serp.results)}</span></div>
          <div className="kw-serp-features">
            <span className="kw-label">SERP Features</span>
            <div className="entity-tags">{r.serp.features.length ? r.serp.features.map((f) => <span key={f} className="entity-tag">{FEATURE[f] ?? f.replace(/_/g, " ")}</span>) : <span className="muted">Only regular results</span>}</div>
          </div>
        </div>
        <div className="seg kw-pages" role="group" aria-label="Results page">
          {Array.from({ length: Math.max(1, Math.ceil(r.serp.rows.length / PAGE)) }, (_, i) => (
            <button key={i} aria-pressed={page === i} onClick={() => setPage(i)}>{i * PAGE + 1}-{i * PAGE + PAGE}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="kw-serp-table">
            <thead>
              <tr>
                <th className="num">#</th><th>{mode === "url" ? "URL" : "Domain"}</th>
                <th className="num" title="Page Authority Score (0-100), from backlinks">Page AS</th><th className="num">Ref. Domains</th><th className="num">Backlinks</th>
                <th className="num" title="Estimated monthly organic visits to this page">Search Traffic</th><th className="num" title="Keywords this page ranks for">URL Keywords</th>
              </tr>
            </thead>
            <tbody>
              {r.serp.rows.slice(page * PAGE, page * PAGE + PAGE).map((x) => {
                const isMine = !!myDomain && (x.domain === myDomain || x.domain.endsWith(`.${myDomain}`));
                return (
                  <tr key={x.position + x.url} className={isMine ? "kw-mine-row" : ""}>
                    <td className="num">{x.position}</td>
                    <td className="kw-url-cell">
                      {mode === "url" ? (
                        <>
                          <a href={x.url} target="_blank" rel="noreferrer" className="url">{x.url} ↗</a>
                          <b className="kw-domain">{x.domain}</b>
                        </>
                      ) : <a href={`https://${x.domain}`} target="_blank" rel="noreferrer" className="url"><b>{x.domain}</b></a>}
                    </td>
                    <td className="num">{x.rank ?? "n/a"}</td>
                    <td className="num">{compact(x.refDomains)}</td>
                    <td className="num">{compact(x.backlinks)}</td>
                    <td className="num">{compact(x.traffic)}</td>
                    <td className="num">{compact(x.keywords)}</td>
                  </tr>
                );
              })}
              {r.serp.rows.length === 0 && <tr><td colSpan={7} className="muted">No results.</td></tr>}
            </tbody>
          </table>
        </div>
        {!r.serp.backlinksAvailable && r.serp.rows.length > 0 && (
          <p className="note kw-bl-note">Page AS, Ref. Domains and Backlinks need the DataForSEO Backlinks API on your account.</p>
        )}
      </section>

      {/* ---- PLA & Ads ---- */}
      <section className="kw-two-col">
        <div className="card kw-section">
          <h2>PLA Copies</h2>
          {r.pla.length ? (
            <ul className="kw-pla">
              {r.pla.map((p, i) => (
                <li key={i}>
                  <p className="kw-pla-title">{p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="url">{p.title}</a> : p.title}</p>
                  <p className="note">{[p.price, p.seller].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          ) : <p className="kw-empty">We have no data to show.</p>}
        </div>
        <div className="card kw-section">
          <h2>Ad Copies</h2>
          {r.ads.length ? (
            <ul className="kw-ads">
              {r.ads.map((a, i) => (
                <li key={i}>
                  <span className="kw-ad-tag">Ad</span> <span className="kw-ad-url">{a.domain}</span>
                  <p className="kw-ad-title"><a href={a.url} target="_blank" rel="noreferrer">{a.title}</a></p>
                  <p className="note">{a.description}</p>
                </li>
              ))}
            </ul>
          ) : <p className="kw-empty">We have no data to show.</p>}
        </div>
      </section>
        </div>
      </div>
    </div>
  );
}
