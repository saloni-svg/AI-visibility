"use client";

import Link from "next/link";
import { useState } from "react";
import { COUNTRIES, COUNTRY_CODES } from "@/lib/countries";
import type { Overview } from "@/lib/overview";
import CountriesEditor from "./CountriesEditor";
import Gauge from "./Gauge";
import Icon from "./Icon";
import InsightsButton from "./InsightsButton";
import PlatformSelect from "./PlatformSelect";
import RunPicker from "./RunPicker";
import Sparkline from "./Sparkline";
import TrendChart from "./TrendChart";

type Data = Extract<Overview, { state: "ok" }>;
type Params = { country: string; platform: string; tab: string; dist: string };

const pct = (v: number) => `${(v * 100).toFixed(1).replace(/\.0$/, "")}%`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n));
const INTENTS = ["informational", "commercial", "transactional", "navigational"] as const;
const INTENT_COLORS = { informational: "var(--c4)", commercial: "var(--c1)", transactional: "var(--c2)", navigational: "var(--c3)" };
const SOURCE_COLORS: Record<string, string> = { openai: "var(--openai)", ai_overview: "var(--c4)", gemini: "var(--gemini)", perplexity: "var(--perplexity)" };
const TABS = [
  { key: "performing", label: "Your performing topics" },
  { key: "topic-opportunities", label: "Topic opportunities" },
  { key: "cited-sources", label: "Cited sources" },
  { key: "source-opportunities", label: "Source opportunities" },
  { key: "cited-pages", label: "Cited pages" },
];

function Delta({ value, prev }: { value: number; prev: number | null }) {
  if (prev === null || prev === value) return null;
  const change = prev === 0 ? null : Math.round(((value - prev) / prev) * 100);
  const up = value > prev;
  return <span className={`delta ${up ? "delta-up" : "delta-down"}`}>{change === null ? `+${value}` : `${up ? "+" : ""}${change}%`}</span>;
}

export default function OverviewView({
  data, domain, params: initial, platforms,
}: { data: Data; domain: string; params: Params; platforms: { value: string; label: string }[] }) {
  // Tabs and toggles switch instantly in the browser; the URL is kept in sync so links still work.
  const [tab, setTabState] = useState(initial.tab);
  const [dist, setDistState] = useState(initial.dist);
  const params = { ...initial, tab, dist };
  const sync = (next: Partial<Params>) => {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === "performing" || v === "mentions") url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    window.history.replaceState(null, "", url);
  };
  const setTab = (t: string) => { setTabState(t); sync({ tab: t }); };
  const setDist = (d: string) => { setDistState(d); sync({ dist: d }); };
  const q = (over: Partial<Params & { run: string }>) => {
    const p = { domain, run: data.run.id, country: params.country, platform: params.platform, tab: params.tab, dist: params.dist, ...over };
    return "/?" + Object.entries(p).filter(([, v]) => v && v !== "all" && v !== "performing" && v !== "mentions").map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
  };
  const filterQuery = `domain=${domain}&country=${params.country}&platform=${params.platform}`;
  const tabCounts: Record<string, number> = {
    performing: data.performingTopics.length,
    "topic-opportunities": data.topicOpportunities.length,
    "cited-sources": data.citedSources.length,
    "source-opportunities": data.sourceOpportunities.length,
    "cited-pages": data.citedPages.length,
  };
  const showPages = params.dist === "pages";
  const metricSeries = [
    { key: "mentions", label: "Mentions", color: "var(--you)" },
    { key: "citations", label: "Citations", color: "var(--perplexity)" },
    { key: "citedPages", label: "Cited pages", color: "var(--c3)" },
  ];

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> AI Visibility <span aria-hidden="true">›</span> Visibility overview</p>
          <h1>Visibility overview: <span className="muted-strong">{domain}</span></h1>
        </div>
        <div className="header-actions">
          <Link href={`/competitors?domain=${domain}`} className="btn-secondary">Competitor research</Link>
          <Link href={`/analyze?domain=${domain}&force=1`} className="btn-primary btn-link">Run new check</Link>
        </div>
      </header>

      <div className="filter-bar">
        <nav className="segmented" aria-label="Country">
          <Link href={q({ country: "all" })} scroll={false} aria-current={params.country === "all"}>🌐 Worldwide</Link>
          {data.countryOptions.map((c) => (
            <Link key={c.code} href={q({ country: c.code })} scroll={false} aria-current={params.country === c.code}>{c.flag} {c.code}</Link>
          ))}
        </nav>
        <CountriesEditor
          domain={domain}
          selected={data.countryOptions.map((c) => c.code)}
          options={COUNTRY_CODES.map((code) => ({ code, name: COUNTRIES[code].name, flag: COUNTRIES[code].flag }))}
        />
        <PlatformSelect value={params.platform} options={platforms} query={`domain=${domain}&country=${params.country}`} />
        <RunPicker runs={data.runs} value={data.run.id} query={filterQuery} />
      </div>

      <div className="ov-layout">
        <div className="ov-main">
      {/* Score + main metrics */}
      <section id="summary" className="overview-top">
        <div className="card score-card">
          <h2>AI visibility</h2>
          <Gauge score={data.score} band={data.band} />
          <p className={`score-note${data.score !== null && data.score < 30 ? " score-low" : ""}`}>{data.scoreNote}</p>
        </div>
        <div className="card metrics-card">
          <div className="metric-row">
            {(["mentions", "citations", "citedPages"] as const).map((k, i) => (
              <div className="metric" key={k}>
                <span className="metric-label"><span className="dot" style={{ background: metricSeries[i].color }} />{metricSeries[i].label}</span>
                <span className="metric-value">
                  {data.metrics[k].value}
                  <Delta value={data.metrics[k].value} prev={data.metrics[k].prev} />
                </span>
              </div>
            ))}
          </div>
          {data.trend.length < 2 ? (
            <div className="inline-empty">
              <Icon name="trend" />
              <span>The trend line appears after your second check. Use <b>Run new check</b> on another day.</span>
            </div>
          ) : (
            <TrendChart series={metricSeries} points={data.trend} unit="count" />
          )}
          <p className="note metric-help">
            Mentions: answers that name you. Citations: links to {domain}. Cited pages: different pages of your site linked.
          </p>
        </div>
      </section>


        <section id="distribution" className="ov-engines">
          <div className="ov-section-head"><h2>Distribution by AI source</h2></div>
          {data.aiOverviewErrors.total > 0 && data.aiOverviewErrors.failed === data.aiOverviewErrors.total ? (
              <p className="field-error ov-notice ov-notice-error">
                AI Overview failed for every search: {data.aiOverviewErrors.message?.slice(0, 160)}. Run <code>npm run check:dataforseo</code> to test your DataForSEO login.
              </p>
            ) : data.aiOverviewErrors.failed > 0 ? (
              <p className="note ov-notice">
                {data.aiOverviewErrors.failed} of {data.aiOverviewErrors.total} Google searches failed on DataForSEO&apos;s side (temporary). The next check asks them again.
              </p>
            ) : data.distribution.some((d) => !d.available) ? (
              <p className="note ov-notice">n/a: no answers from this source in this check. AI Overview needs DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env.</p>
            ) : null}
          <div className="seg" role="group" aria-label="Show">
            <button type="button" aria-pressed={!showPages} onClick={() => setDist("mentions")}>Mentions</button>
            <button type="button" aria-pressed={showPages} onClick={() => setDist("pages")}>Cited pages</button>
          </div>
          <ul className="ov-tiles">
            {data.distribution.map((d) => {
              const share = showPages ? d.pageShare : d.mentionShare;
              const count = showPages ? d.pages : d.mentions;
              return (
                <li key={d.provider} className="ov-tile" style={{ ["--tile" as string]: SOURCE_COLORS[d.provider] }}>
                  <span className="dist-name"><span className="dot" style={{ background: SOURCE_COLORS[d.provider] }} />{d.label}</span>
                  <span className="ov-tile-values">
                    <span className="num ov-tile-pct">{d.available ? pct(share) : "n/a"}</span>
                    <span className="num strong ov-tile-count">{d.available ? count : "n/a"}</span>
                  </span>
                  <span className="ov-tile-bar" aria-hidden="true"><span style={{ width: `${d.available ? share * 100 : 0}%` }} /></span>
                </li>
              );
            })}
          </ul>
          <section id="countries" className="ov-countries">
            <div className="ov-section-head"><h2>Mentions by country</h2></div>
            {data.countries.every((c) => c.mentions === 0) ? (
              <div className="inline-empty">
                <Icon name="globe" />
                <span>No mentions in these countries yet. Add countries with <b>+ Countries</b>.</span>
              </div>
            ) : (
              <table className="ov-country-table">
                <thead>
                  <tr><th>Country</th><th className="num">Share</th><th className="num">Mentions</th></tr>
                </thead>
                <tbody>
                  {data.countries.map((c, i) => (
                    <tr key={c.code}>
                      <td>{c.flag} {c.name}</td>
                      <td className="num">
                        <span className="ov-share">
                          <span className="ov-share-bar" aria-hidden="true"><span style={{ width: `${c.share * 100}%`, background: ["var(--you)", "var(--perplexity)", "var(--c3)", "var(--c2)", "var(--c4)"][i % 5] }} /></span>
                          {pct(c.share)}
                        </span>
                      </td>
                      <td className="num strong">{c.mentions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </section>

      <section id="topics" className="topics-section">
        <h2 className="section-title">Topics &amp; sources</h2>
        <div className="ov-topics">
        <div className="ov-vtabs" role="tablist" aria-label="Topics and sources" aria-orientation="vertical">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={params.tab === t.key} onClick={() => setTab(t.key)}>
              <span>{t.label}</span>
              <span className="tab-count">{tabCounts[t.key]}</span>
            </button>
          ))}
        </div>

        <div className="card panel ov-topic-table">
          {params.tab === "performing" || params.tab === "topic-opportunities" ? (
            <TopicsTable
              topics={params.tab === "performing" ? data.performingTopics : data.topicOpportunities}
              opportunities={params.tab === "topic-opportunities"}
            />
          ) : params.tab === "cited-sources" ? (
            <SimpleTable
              empty="No websites were cited in these answers."
              head={["Website", "Answers citing it", "Answers that also name you"]}
              rows={data.citedSources.map((s) => [
                <>{s.domain}{s.isYou && <span className="badge badge-you">You</span>}</>,
                s.answers,
                s.withYou,
              ])}
            />
          ) : params.tab === "source-opportunities" ? (
            <SimpleTable
              empty="No gaps: every cited website also appears next to you."
              head={["Website", "Answers citing it", "Brands named instead of you"]}
              rows={data.sourceOpportunities.map((s) => [s.domain, s.answers, s.brands.join(", ")])}
            />
          ) : (
            <SimpleTable
              empty={`No page of ${domain} was cited in these answers.`}
              head={["Page", "Times cited", "Cited by"]}
              rows={data.citedPages.map((p) => [
                <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="url">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</a>,
                p.count,
                p.sources.join(", "),
              ])}
            />
          )}
        </div>
        </div>
        <p className="note">
          AI volume: estimated monthly searches for each topic&apos;s keyword ({data.performingTopics.concat(data.topicOpportunities).find((t) => t.volume)?.volume?.source === "google" ? "Google search volume" : "AI search volume"}, DataForSEO).
          Intent:{" "}
          {INTENTS.map((i) => (
            <span key={i} className="intent-key"><span className="dot" style={{ background: INTENT_COLORS[i] }} />{i}</span>
          ))}
        </p>
      </section>
        </div>
        <aside className="ov-aside">
      <section id="next" className="card next-card ov-next">
        <div className="next-head">
          <h2>What&apos;s next?</h2>
          <InsightsButton domain={domain} runId={data.run.id} label={data.insights ? "Rewrite" : "Write recommendations"} />
        </div>
        {data.insights?.length ? (
          <div className="next-grid ov-next-list">
            {data.insights.map((c) => (
              <article key={c.title} className="next-item">
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                <button type="button" className="link-btn" onClick={() => { setTab(c.tab); document.getElementById("topics")?.scrollIntoView({ behavior: "smooth" }); }}>
                  {c.action}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="note">Recommendations are written after each check, from the topics and websites below.</p>
        )}
      </section>

        </aside>
      </div>
    </main>
  );
}

function TopicsTable({ topics, opportunities }: { topics: Data["performingTopics"]; opportunities: boolean }) {
  if (!topics.length) {
    return (
      <div className="inline-empty panel-body">
        <Icon name="list" />
        <span>{opportunities ? "No topic gaps: you appear in every topic." : "You aren't mentioned in any topic yet. See Topic opportunities."}</span>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <div className="topic-grid topic-head">
        <span>Topic</span>
        <span className="num">{opportunities ? "Brands named instead" : "Visibility"}</span>
        <span className="num">Your mentions</span>
        <span className="num">AI volume</span>
        <span>Intent</span>
      </div>
      {topics.map((t) => {
        const totalIntent = Object.values(t.intents).reduce((s, n) => s + n, 0);
        return (
          <details key={t.name} className="topic-row">
            <summary className="topic-grid">
              <span className="topic-name"><Icon name="chevron" size={14} />{t.name}</span>
              <span className="num">{opportunities ? <span className="muted">{t.topBrands.join(", ") || "–"}</span> : <b>{t.visibility}</b>}</span>
              <span className="num">{t.mentions}<span className="muted">/{t.answers}</span></span>
              <span className="num volume">
                <Sparkline values={t.volume?.monthly ?? []} />
                <b>{t.volume ? compact(t.volume.volume) : "n/a"}</b>
              </span>
              <span className="intent-bar" title={INTENTS.filter((i) => t.intents[i]).map((i) => `${i}: ${t.intents[i]}`).join(", ")}>
                {INTENTS.map((i) => t.intents[i] > 0 && (
                  <span key={i} style={{ width: `${(t.intents[i] / Math.max(1, totalIntent)) * 100}%`, background: INTENT_COLORS[i] }} />
                ))}
              </span>
            </summary>
            <div className="prompt-rows">
              <div className="prompt-grid prompt-head">
                <span>Question</span><span>AI response</span><span>Your brand</span><span className="num">Brands</span><span className="num">Sources</span>
              </div>
              {t.prompts.flatMap((p) =>
                p.answers.map((a, i) => (
                  <div className="prompt-grid" key={a.id}>
                    <span className="prompt-text">{i === 0 ? p.text : ""}</span>
                    <div className="answer">
                      <span className="answer-source"><span className="dot" style={{ background: SOURCE_COLORS[a.provider] }} />{a.label} {a.flag}</span>
                      <p className="answer-snippet">{a.text.slice(0, 220)}{a.text.length > 220 ? "…" : ""}</p>
                      {a.text.length > 220 && (
                        <details className="answer-full">
                          <summary>View full response</summary>
                          <div>{a.text}</div>
                        </details>
                      )}
                    </div>
                    <span className="pills">
                      {a.mentioned ? <span className="pill pill-hit">Mentioned{a.position ? ` #${a.position}` : ""}</span> : <span className="pill pill-miss">Not mentioned</span>}
                      {a.cited && <span className="pill pill-shared">Cited</span>}
                    </span>
                    <span className="num">{a.brands}</span>
                    <span className="num">{a.sources}</span>
                  </div>
                )),
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) {
    return (
      <div className="inline-empty panel-body">
        <Icon name="globe" />
        <span>{empty}</span>
      </div>
    );
  }
  return (
    <div className="table-wrap panel-body">
      <table>
        <thead>
          <tr>{head.map((h, i) => <th key={h} className={i > 0 && i < 3 && typeof rows[0][i] === "number" ? "num" : ""}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === "number" ? "num" : ""} style={j === 0 ? { overflowWrap: "anywhere" } : undefined}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
