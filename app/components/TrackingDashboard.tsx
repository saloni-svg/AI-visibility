"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { TrackingData } from "@/lib/prompt-tracking";
import { ENGINE_LABEL, type Engine } from "@/lib/tracking-shared";
import { removeTrackingPrompt, startTrackingRun, trackingCheckDetail, trackingRunStep } from "../(dashboard)/actions";
import { fmtDay, fmtDayTime } from "./format";
import PlatformIcon from "./PlatformIcon";
import TrackingSetup from "./TrackingSetup";

type Data = NonNullable<TrackingData>;
type Country = { code: string; name: string; flag: string };
type Tab = "landscape" | "prompts" | "competitors" | "sources";
type Detail = Extract<Awaited<ReturnType<typeof trackingCheckDetail>>, { detail: unknown }>["detail"];

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n}%`);
const short = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`; };
const BUCKETS = [
  { key: "first", label: "Named 1st", color: "var(--tr-first)" },
  { key: "top3", label: "Named 2nd–3rd", color: "var(--tr-top3)" },
  { key: "top10", label: "Named 4th+", color: "var(--tr-top10)" },
  { key: "cited", label: "Only cited", color: "var(--tr-cited)" },
  { key: "absent", label: "Not named", color: "var(--tr-absent)" },
] as const;

function Delta({ now, prev, lowerIsBetter = false, suffix = "" }: { now: number | null; prev: number | null | undefined; lowerIsBetter?: boolean; suffix?: string }) {
  if (now === null || prev === null || prev === undefined) return null;
  const diff = Math.round((now - prev) * 10) / 10;
  if (!diff) return <span className="tr-delta same">0</span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return <span className={`tr-delta ${good ? "up" : "down"}`}>{diff > 0 ? "+" : "−"}{Math.abs(diff)}{suffix}</span>;
}

function Line({ values, invert = false, h = 64 }: { values: (number | null)[]; invert?: boolean; h?: number }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  const w = 300;
  if (pts.length < 2) {
    return <svg className="tr-line" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path d={`M0 ${h * 0.6} Q75 ${h * 0.3} 150 ${h * 0.6} T300 ${h * 0.6}`} fill="none" stroke="var(--grid)" strokeWidth="10" strokeLinecap="round" /></svg>;
  }
  const max = Math.max(...pts.map((p) => p.v)), min = Math.min(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * w;
  const y = (v: number) => { const t = (v - min) / span; return 6 + (invert ? t : 1 - t) * (h - 12); };
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg className="tr-line" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${x(pts.at(-1)!.i)},${h} L${x(pts[0].i)},${h} Z`} fill="var(--tr-area)" />
      <path d={d} fill="none" stroke="var(--tr-line)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Pos({ cell }: { cell: Data["rows"][number]["cells"][string] }) {
  if (!cell) return <span className="tr-pos none" title="Not checked yet">·</span>;
  if (cell.error) return <span className="tr-pos err" title={cell.error}>!</span>;
  if (!cell.answered) return <span className="tr-pos none" title="Google showed no AI Overview for this prompt">no AIO</span>;
  const change = cell.prevPosition === null ? null : cell.mentioned && cell.position
    ? (cell.prevPosition === 0 ? "new" : cell.prevPosition - cell.position)
    : cell.prevPosition > 0 ? "lost" : null;
  return (
    <span className="tr-pos-wrap">
      {cell.mentioned && cell.position
        ? <span className={`tr-pos ${cell.position === 1 ? "first" : "named"}`}>#{cell.position}</span>
        : cell.cited ? <span className="tr-pos cited" title="Not named, but your site is cited">cited</span> : <span className="tr-pos none">–</span>}
      {cell.mentioned && cell.cited && <span className="tr-link" title="Your site is cited as a source">🔗</span>}
      {change === "new" && <span className="tr-delta up">new</span>}
      {change === "lost" && <span className="tr-delta down">lost</span>}
      {typeof change === "number" && change !== 0 && <span className={`tr-delta ${change > 0 ? "up" : "down"}`}>{change > 0 ? "▲" : "▼"}{Math.abs(change)}</span>}
    </span>
  );
}

export default function TrackingDashboard({ data, campaigns, prompts, countries, ready, research, autoStart }: {
  data: Data; campaigns: { id: string; domain: string; country: string; location: { name: string } | null }[];
  prompts: { id: string; prompt: string; tags: string[] }[]; countries: Country[]; ready: Record<Engine, boolean>;
  research: { topic: string; country: string; platform: string; match: string }[]; autoStart: boolean;
}) {
  const router = useRouter();
  const d = data;
  const c = d.campaign;
  const [tab, setTab] = useState<Tab>("landscape");
  const [settings, setSettings] = useState(false);
  const [newTarget, setNewTarget] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(d.running ? { done: d.running.done, total: d.running.total } : null);
  const [runError, setRunError] = useState("");
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  const country = countries.find((x) => x.code === c.country);
  const place = c.location ? c.location.name.split(",")[0] : country?.name ?? c.country;
  const others = d.brands.filter((b) => !b.you);

  async function runCheck() {
    setRunError("");
    const s = await startTrackingRun(c.id);
    if ("error" in s) return setRunError(s.error);
    setProgress({ done: s.done, total: s.total });
    for (let i = 0; i < 500; i++) {
      const r = await trackingRunStep(s.runId);
      if ("error" in r) { setRunError(r.error); break; }
      setProgress({ done: r.done, total: r.total });
      if (r.status !== "running") break;
    }
    setProgress(null);
    router.replace(`/tracking/${c.id}${d.engine !== "all" ? `?engine=${d.engine}` : ""}`);
    router.refresh();
  }
  useEffect(() => {
    if (started.current) return;
    if (d.running || (autoStart && !d.current)) { started.current = true; runCheck(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const href = (o: { engine?: string; run?: string }) => {
    const p = new URLSearchParams();
    const engine = o.engine ?? d.engine;
    if (engine !== "all") p.set("engine", engine);
    const run = o.run ?? (d.current && d.runs[0]?.id !== d.current.id ? d.current.id : "");
    if (run) p.set("run", run);
    const s = p.toString();
    return `/tracking/${c.id}${s ? `?${s}` : ""}`;
  };

  const summary = useMemo(() => {
    if (!d.current) return [];
    const engines = d.engine === "all" ? c.engines.map((e) => ENGINE_LABEL[e]).join(", ") : ENGINE_LABEL[d.engine as Engine];
    const lines = [
      `Visibility of ${c.brand_name} on ${engines} (${place}) is ${d.now.visibility}%${d.before ? `, ${d.now.visibility >= d.before.visibility ? "up" : "down"} from ${d.before.visibility}% at the previous check` : ""}.`,
      `It is named in ${d.now.mentioned} of ${d.now.answers} AI answers (${d.now.mentionRate}%), first in ${d.now.top1}${d.now.avgPosition ? `, at position ${d.now.avgPosition} on average` : ""}. Its website is cited as a source in ${d.now.cited}.`,
    ];
    const top = others[0];
    if (top) lines.push(`The most visible other brand is ${top.name} (${top.visibility}% visibility, named in ${top.share}% of answers).`);
    const eng = d.byEngine.filter((e) => e.answers);
    if (d.engine === "all" && eng.length > 1) {
      const best = [...eng].sort((a, b) => b.visibility - a.visibility);
      lines.push(`Strongest on ${ENGINE_LABEL[best[0].engine]} (${best[0].visibility}%), weakest on ${ENGINE_LABEL[best.at(-1)!.engine]} (${best.at(-1)!.visibility}%).`);
    }
    if (d.previous) lines.push(`${d.improved.length} prompt${d.improved.length === 1 ? "" : "s"} improved and ${d.declined.length} declined since ${fmtDay(d.previous.date)}.`);
    else lines.push("Changes appear after the next check.");
    return lines;
  }, [d, c, place, others]);

  const gathering = progress && !d.current;

  return (
    <div className="tr-dash">
      <header className="tr-head">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> AI analysis <span aria-hidden="true">›</span> <Link href="/tracking">Prompt tracking</Link></p>
          <div className="tr-title">
            <h1>Prompt Tracking:</h1>
            <label className="tr-switch">
              <span className="sr-only">Campaign</span>
              <select value={c.id} onChange={(e) => router.push(`/tracking/${e.target.value}`)}>
                {campaigns.map((x) => <option key={x.id} value={x.id}>{x.domain} · {x.location ? x.location.name.split(",")[0] : x.country}</option>)}
              </select>
            </label>
          </div>
          <div className="tr-meta">
            <span className="tr-meta-target">{country?.flag} {place} · {c.engines.map((e) => <span key={e} className="tr-meta-eng"><PlatformIcon k={e} />{ENGINE_LABEL[e]}</span>)}</span>
            <span>Updated: <b>{d.current ? fmtDayTime(d.current.date) : "never"}</b></span>
            <span>Prompts: <button type="button" className="link-btn" onClick={() => setSettings(true)}>{d.prompts}</button></span>
            <span>Competitors: <button type="button" className="link-btn" onClick={() => setSettings(true)}>{c.competitors.length ? c.competitors.length : "Add"}</button></span>
          </div>
        </div>
        <div className="tr-head-actions">
          <button type="button" className="btn-dark btn-small" onClick={runCheck} disabled={!!progress}>{progress ? "Checking…" : "Check now"}</button>
          <button type="button" className="btn-secondary btn-small" onClick={() => setSettings(true)} aria-label="Campaign settings">⚙ Settings</button>
        </div>
      </header>

      {runError && <p className="tr-error">{runError}</p>}

      {gathering ? (
        <section className="tr-gathering">
          <h2>Gathering AI answers: {progress.done}/{progress.total}</h2>
          <div className="tr-stripes"><span style={{ width: `${progress.total ? Math.max(4, (progress.done / progress.total) * 100) : 4}%` }} /></div>
          <p className="note">Each prompt is asked to {c.engines.map((e) => ENGINE_LABEL[e]).join(", ")}, then the answer is read for {c.brand_name}, competitors and cited sites. About 10–20 seconds per batch of 8.</p>
          <Link href="/tracking" className="btn-secondary btn-small">← Back to campaigns</Link>
        </section>
      ) : !d.current ? (
        <section className="tr-gathering">
          <h2>No checks yet</h2>
          <p className="note">Run the first check to see where {c.brand_name} appears in AI answers.</p>
          <button type="button" className="btn-dark" onClick={runCheck}>Check now</button>
        </section>
      ) : (
        <>
          {progress && (
            <div className="tr-progress card" role="status">
              <span>Checking prompts: {progress.done}/{progress.total}</span>
              <div className="progress"><span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
            </div>
          )}

          <nav className="tr-tabs" aria-label="Report sections">
            {([["landscape", "Landscape"], ["prompts", "Prompts"], ["competitors", "Competitors"], ["sources", "Sources & pages"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} type="button" aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>{l}</button>
            ))}
          </nav>

          <div className="tr-filters">
            <nav className="tr-chips" aria-label="AI engine">
              <Link href={href({ engine: "all" })} aria-current={d.engine === "all" ? "true" : undefined}>All engines</Link>
              {c.engines.map((e) => <Link key={e} href={href({ engine: e })} aria-current={d.engine === e ? "true" : undefined}><PlatformIcon k={e} />{ENGINE_LABEL[e]}</Link>)}
            </nav>
            <label className="tr-date">
              <span aria-hidden="true">📅</span>
              <span className="sr-only">Check date</span>
              <select value={d.current.id} onChange={(e) => router.push(href({ run: e.target.value === d.runs[0]?.id ? "" : e.target.value }))}>
                {d.runs.map((r) => <option key={r.id} value={r.id}>{fmtDayTime(r.date)}</option>)}
              </select>
            </label>
          </div>
          {d.errors > 0 && <p className="tr-error">{d.errors} answer{d.errors === 1 ? "" : "s"} couldn&apos;t be checked this time (shown as “!”). They&apos;re retried on the next check.</p>}

          {tab === "landscape" && <Landscape d={d} summary={summary} copied={copied} onCopy={async () => { try { await navigator.clipboard.writeText(summary.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } }}
            goto={setTab} openSettings={() => setSettings(true)} addTarget={() => setNewTarget(true)} countries={countries} />}
          {tab === "prompts" && <PromptsTab d={d} />}
          {tab === "competitors" && <CompetitorsTab d={d} openSettings={() => setSettings(true)} />}
          {tab === "sources" && <SourcesTab d={d} />}
        </>
      )}

      {settings && (
        <TrackingSetup mode="edit" domain={c.domain} campaign={c} existing={prompts} countries={countries} ready={ready} research={research} onClose={() => setSettings(false)} />
      )}
      {newTarget && (
        <TrackingSetup mode="new" domain={c.domain} campaign={{ ...c, id: "", location: null }} countries={countries} ready={ready} research={research} onClose={() => setNewTarget(false)} />
      )}
    </div>
  );
}

// ---------- Landscape ----------

function Landscape({ d, summary, copied, onCopy, goto, openSettings, addTarget, countries }: {
  d: Data; summary: string[]; copied: boolean; onCopy: () => void; goto: (t: Tab) => void; openSettings: () => void; addTarget: () => void; countries: Country[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const trend = d.trend;
  const maxStack = Math.max(1, ...trend.map((t) => BUCKETS.filter((b) => !hidden.has(b.key)).reduce((s, b) => s + t.dist[b.key], 0)));
  const competitors = [...d.brands].sort((a, b) => b.visibility - a.visibility).slice(0, 7);
  const maxAnswers = Math.max(1, ...competitors.map((b) => b.answers));
  const maxPos = Math.max(3, ...competitors.map((b) => b.avgPosition || 0));
  const maxVis = Math.max(1, ...competitors.map((b) => b.visibility));
  const topPrompts = [...d.rows].filter((r) => r.visibility !== null).sort((a, b) => (b.visibility ?? 0) - (a.visibility ?? 0)).slice(0, 6);
  const sources = d.sources.slice(0, 8);
  const maxSrc = Math.max(1, ...sources.map((s) => s.answers));

  return (
    <div className="tr-landscape">
      <div className="tr-row tr-row-top">
        <section className="card tr-kpis">
          {[
            { label: "Visibility", help: "How prominently AI names you: 100% = named first in every answer. Named 2nd counts 85%, 3rd 70%, 4th–5th 55%, lower 20–35%, only linked as a source 10%.", value: pct(d.now.visibility), delta: <Delta now={d.now.visibility} prev={d.before?.visibility} suffix="%" />, line: <Line values={trend.map((t) => t.visibility)} /> },
            { label: "Named in", help: "Share of AI answers that mention your brand at all.", value: pct(d.now.mentionRate), delta: <Delta now={d.now.mentionRate} prev={d.before?.mentionRate} suffix="%" />, line: <Line values={trend.map((t) => t.mentionRate)} /> },
            { label: "Average position", help: "Where your brand appears among the brands an answer names (1 = first). Only answers that name you.", value: d.now.avgPosition === null ? "–" : d.now.avgPosition.toFixed(1), delta: <Delta now={d.now.avgPosition} prev={d.before?.avgPosition} lowerIsBetter />, line: <Line values={trend.map((t) => t.avgPosition)} invert /> },
          ].map((k) => (
            <div key={k.label} className="tr-kpi">
              <div>
                <p className="tr-kpi-label">{k.label} <span className="tr-i" title={k.help}>i</span></p>
                <p className="tr-kpi-value">{k.value}</p>
              </div>
              <div className="tr-kpi-side">{k.delta}{k.line}</div>
            </div>
          ))}
        </section>
        <section className="card tr-summary">
          <div className="tr-card-head"><h2>Summary</h2><button type="button" className="btn-secondary btn-small" onClick={onCopy}>{copied ? "Copied" : "Copy all"}</button></div>
          <div className="tr-summary-body">{summary.map((s) => <p key={s}>{s}</p>)}</div>
          {d.byEngine.length > 1 && (
            <div className="tr-engine-bars">
              {d.byEngine.map((e) => (
                <div key={e.engine} className="tr-engine-bar">
                  <span><PlatformIcon k={e.engine} />{ENGINE_LABEL[e.engine]}</span>
                  <span className="tr-bar"><span style={{ width: `${e.visibility}%` }} /></span>
                  <b>{e.ready ? pct(e.visibility) : "no key"}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="tr-row tr-row-2-1">
        <section className="card">
          <div className="tr-card-head"><h2>Position distribution <span className="tr-i" title="Every AI answer at each check, by where your brand appears.">i</span></h2></div>
          <div className="tr-legend">
            {BUCKETS.map((b) => (
              <button key={b.key} type="button" aria-pressed={!hidden.has(b.key)} onClick={() => setHidden((h) => { const n = new Set(h); n.has(b.key) ? n.delete(b.key) : n.add(b.key); return n; })}>
                <span style={{ background: b.color }} />{b.label}
              </button>
            ))}
          </div>
          <div className="tr-bars" role="img" aria-label="Answers by position at each check">
            {trend.map((t) => (
              <div key={t.runId} className="tr-bar-col" title={BUCKETS.map((b) => `${b.label}: ${t.dist[b.key]}`).join("\n")}>
                <div className="tr-stack" style={{ height: `${(BUCKETS.filter((b) => !hidden.has(b.key)).reduce((s, b) => s + t.dist[b.key], 0) / maxStack) * 100}%` }}>
                  {BUCKETS.filter((b) => !hidden.has(b.key)).map((b) => t.dist[b.key] ? <span key={b.key} style={{ flexGrow: t.dist[b.key], background: b.color }} /> : null)}
                </div>
                <small>{short(t.date)}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="card tr-ranks">
          <div className="tr-card-head"><h2>Answers <span className="tr-i" title="AI answers (prompt × engine) in each group. New and lost compare with the previous check.">i</span></h2></div>
          {([["Named 1st", d.ranks.top1], ["Top 3", d.ranks.top3], ["Top 10", d.ranks.top10], ["Named at all", d.ranks.mentioned], ["Site cited", d.ranks.cited]] as [string, typeof d.ranks.top1][]).map(([label, r]) => (
            <div key={label} className="tr-rank">
              <span className="tr-rank-label">{label}</span>
              <span className="tr-rank-value"><span className="tr-ring" style={{ ["--p" as string]: `${d.now.answers ? (r.now / d.now.answers) * 100 : 0}` }} />{r.now}</span>
              <span className="tr-rank-nl"><small>New</small>{r.new === null ? "N/A" : <b className={r.new ? "up" : ""}>{r.new}</b>}</span>
              <span className="tr-rank-nl"><small>Lost</small>{r.lost === null ? "N/A" : <b className={r.lost ? "down" : ""}>{r.lost}</b>}</span>
            </div>
          ))}
        </section>
      </div>

      <div className="tr-row tr-row-3">
        <section className="card">
          <div className="tr-card-head"><h2>Top prompts</h2></div>
          <table className="tr-mini">
            <thead><tr><th>Prompt</th><th className="num">Best</th><th className="num">Visibility</th></tr></thead>
            <tbody>{topPrompts.map((r) => <tr key={r.id}><td>{r.prompt}</td><td className="num">{r.best ? `#${r.best}` : "–"}</td><td className="num">{pct(r.visibility)}</td></tr>)}</tbody>
          </table>
          <button type="button" className="btn-dark btn-small tr-card-cta" onClick={() => goto("prompts")}>View {d.rows.length} prompts</button>
        </section>
        {[["Positive impact", d.improved, "up"], ["Negative impact", d.declined, "down"]].map(([label, list, cls]) => (
          <section key={label as string} className="card">
            <div className="tr-card-head"><h2>{label as string} <span className="tr-i" title="Prompts whose visibility changed since the previous check.">i</span></h2></div>
            {(list as Data["improved"]).length ? (
              <table className="tr-mini">
                <thead><tr><th>Prompt</th><th className="num">Visibility</th></tr></thead>
                <tbody>{(list as Data["improved"]).slice(0, 6).map((x) => <tr key={x.id}><td>{x.prompt}</td><td className="num">{x.to}% <span className={`tr-delta ${cls}`}>{x.diff > 0 ? "+" : "−"}{Math.abs(Math.round(x.diff * 10) / 10)}</span></td></tr>)}</tbody>
              </table>
            ) : <p className="tr-empty">{d.previous ? "No changes since the previous check." : "We have no data to show yet. Changes appear after the second check."}</p>}
          </section>
        ))}
      </div>

      <section className="card">
        <div className="tr-card-head"><h2>Tags <span className="tr-i" title="Visibility per group of prompts.">i</span></h2></div>
        {d.tags.length ? (
          <table className="tr-table">
            <thead><tr><th>Tag</th><th className="num">Prompts</th><th>Visibility</th><th className="num">Named in</th><th className="num">Avg. position</th></tr></thead>
            <tbody>{d.tags.map((t) => (
              <tr key={t.tag}><td><span className="tr-tag">{t.tag}</span></td><td className="num">{t.prompts}</td>
                <td><span className="tr-bar tr-bar-inline"><span style={{ width: `${t.visibility}%` }} /></span> {t.visibility}%</td>
                <td className="num">{t.mentionRate}%</td><td className="num">{t.avgPosition ?? "–"}</td></tr>
            ))}</tbody>
          </table>
        ) : (
          <div className="tr-empty-state">
            <b>Add your first tag</b>
            <p className="note">Tags group prompts (for example “local”, “pricing”, “brand”) so you can see visibility per group.</p>
            <button type="button" className="btn-dark btn-small" onClick={openSettings}>Tag prompts</button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="tr-card-head"><h2>You vs other brands in AI answers <span className="tr-i" title="Further right = named in more answers. Higher = named earlier. Bigger = more visible.">i</span></h2></div>
        <div className="tr-bubble-wrap">
          <svg className="tr-bubbles" viewBox="0 0 520 260" role="img" aria-label="Brands by answers and average position">
            {[0, 1, 2, 3].map((i) => <line key={i} x1="40" x2="510" y1={20 + i * 70} y2={20 + i * 70} stroke="var(--grid)" />)}
            <text x="8" y="24" className="tr-axis">#1</text>
            <text x="8" y="234" className="tr-axis">#{Math.ceil(maxPos)}</text>
            <text x="275" y="256" className="tr-axis" textAnchor="middle">Answers that name the brand →</text>
            {competitors.filter((b) => b.answers).map((b) => {
              const x = 50 + (b.answers / maxAnswers) * 440;
              const y = 20 + ((b.avgPosition - 1) / Math.max(1, maxPos - 1)) * 210;
              const r = 8 + (b.visibility / maxVis) * 26;
              return (
                <g key={b.name}>
                  <circle cx={x} cy={y} r={r} fill={b.you ? "var(--tr-you)" : b.tracked ? "var(--c2)" : "var(--tr-other)"} opacity={b.you ? 0.9 : 0.6} />
                  <text x={x} y={y - r - 4} textAnchor="middle" className={`tr-bubble-label${b.you ? " you" : ""}`}>{b.name}</text>
                </g>
              );
            })}
          </svg>
          <div className="tr-bubble-side">
            <b>{brandsOnly(d).length ? `${brandsOnly(d).length} other brands appear in these answers` : "No other brands named yet"}</b>
            <p className="note">Follow the ones that matter to see them highlighted here and pinned in Competitors.</p>
            <div className="tr-bubble-actions">
              <button type="button" className="btn-dark btn-small" onClick={openSettings}>Add competitors</button>
              <button type="button" className="btn-secondary btn-small" onClick={() => goto("competitors")}>See all brands</button>
            </div>
          </div>
        </div>
      </section>

      <div className="tr-row tr-row-2-1">
        <section className="card">
          <div className="tr-card-head"><h2>Sources AI cites <span className="tr-i" title="Websites linked as sources, by share of answers. Yours is highlighted.">i</span></h2></div>
          <ul className="tr-src-bars">
            {sources.map((s) => (
              <li key={s.domain} className={s.you ? "you" : ""}>
                <span className="tr-src-name">{s.domain}{s.you && <em>you</em>}</span>
                <span className="tr-bar"><span style={{ width: `${(s.answers / maxSrc) * 100}%` }} /></span>
                <b>{s.share}%</b>
              </li>
            ))}
            {!sources.length && <li className="tr-empty">The answers listed no sources.</li>}
          </ul>
        </section>
        <section className="card">
          <div className="tr-card-head"><h2>Your pages cited</h2></div>
          {d.pages.length ? (
            <table className="tr-mini">
              <thead><tr><th>URL</th><th className="num">Answers</th></tr></thead>
              <tbody>{d.pages.slice(0, 6).map((p) => <tr key={p.url}><td><a href={p.url} target="_blank" rel="noreferrer" className="url">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</a></td><td className="num">{p.answers}</td></tr>)}</tbody>
            </table>
          ) : <p className="tr-empty">None of your pages is cited yet. Pages AI can quote (clear answers, lists, comparisons) get cited more.</p>}
          {d.pages.length > 0 && <button type="button" className="btn-dark btn-small tr-card-cta" onClick={() => goto("sources")}>View {d.pages.length} pages</button>}
        </section>
      </div>

      <section className="card">
        <div className="tr-card-head"><h2>Visibility by location</h2><button type="button" className="btn-secondary btn-small" onClick={addTarget}>+ Add new target</button></div>
        {d.targets.length > 1 ? (
          <table className="tr-table">
            <thead><tr><th>Target</th><th>Engines</th><th>Visibility</th><th>Last check</th></tr></thead>
            <tbody>{d.targets.map((t) => (
              <tr key={t.id} className={t.current ? "tr-current" : ""}>
                <td><Link href={`/tracking/${t.id}`} className="url">{countries.find((x) => x.code === t.country)?.flag} {t.location ? t.location.name.replace(/,/g, ", ") : countries.find((x) => x.code === t.country)?.name}</Link>{t.current && <span className="tr-tag">this campaign</span>}</td>
                <td>{t.engines.map((e) => <span key={e} title={ENGINE_LABEL[e as Engine]}><PlatformIcon k={e} /></span>)}</td>
                <td>{t.visibility === null ? "–" : <><span className="tr-bar tr-bar-inline"><span style={{ width: `${t.visibility}%` }} /></span> {t.visibility}%</>}</td>
                <td className="muted">{t.last_run_at ? fmtDayTime(t.last_run_at) : "Not checked"}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <div className="tr-empty-state">
            <b>Track more places</b>
            <p className="note">AI answers change by country and city. Add another target to compare visibility across locations.</p>
          </div>
        )}
      </section>
    </div>
  );
}
const brandsOnly = (d: Data) => d.brands.filter((b) => !b.you && b.answers);

// ---------- Prompts ----------

function PromptsTab({ d }: { d: Data }) {
  const router = useRouter();
  const engines = (d.engine === "all" ? d.campaign.engines : [d.engine]) as Engine[];
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [view, setView] = useState<"all" | "named" | "absent">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [engineOpen, setEngineOpen] = useState<Engine>(engines[0]);
  const [detail, setDetail] = useState<Record<string, Detail | "loading" | string>>({});
  const tags = [...new Set(d.rows.flatMap((r) => r.tags))].sort();
  const rows = d.rows.filter((r) =>
    (!q || r.prompt.toLowerCase().includes(q.toLowerCase())) && (!tag || r.tags.includes(tag)) &&
    (view === "all" || (view === "named" ? r.best !== null : r.best === null)));

  async function load(checkId: string) {
    if (detail[checkId]) return;
    setDetail((x) => ({ ...x, [checkId]: "loading" }));
    const r = await trackingCheckDetail(checkId);
    setDetail((x) => ({ ...x, [checkId]: "error" in r ? r.error : r.detail }));
  }
  function toggle(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    const row = d.rows.find((r) => r.id === id)!;
    const first = engines.find((e) => row.cells[e]?.checkId) ?? engines[0];
    setEngineOpen(first);
    const cell = row.cells[first];
    if (cell?.checkId) load(cell.checkId);
  }
  function exportCsv() {
    const lines = [["Prompt", "Tags", ...engines.map((e) => ENGINE_LABEL[e]), "Visibility %"], ...rows.map((r) => [
      r.prompt, r.tags.join("; "),
      ...engines.map((e) => { const c = r.cells[e]; return !c ? "" : c.error ? "error" : !c.answered ? "no answer" : c.mentioned ? `#${c.position}` : c.cited ? "cited" : "not named"; }),
      r.visibility ?? "",
    ])];
    const csv = lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `prompt-tracking-${d.campaign.domain}.csv` });
    a.click();
  }

  return (
    <section className="card tr-prompts">
      <div className="tr-card-head">
        <h2>Prompts <span className="muted">{rows.length}</span></h2>
        <div className="tr-tools">
          <div className="seg" role="group" aria-label="Show">
            {([["all", "All"], ["named", "Named"], ["absent", "Not named"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
          </div>
          {tags.length > 0 && <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag"><option value="">All tags</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>}
          <input className="tr-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter prompts" aria-label="Filter prompts" />
          <button type="button" className="btn-secondary btn-small" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      <div className="tr-scroll">
        <table className="tr-table tr-ptable">
          <thead><tr><th className="tr-c-chev" /><th>Prompt</th>{engines.map((e) => <th key={e} className="tr-c-eng"><PlatformIcon k={e} />{ENGINE_LABEL[e]}</th>)}<th className="num">Visibility</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open === r.id;
              const cell = r.cells[engineOpen];
              const det = cell?.checkId ? detail[cell.checkId] : undefined;
              return (
                <Fragment key={r.id}>
                  <tr className={`tr-prow${isOpen ? " open" : ""}`} onClick={() => toggle(r.id)}>
                    <td className="tr-c-chev"><span className={`tr-chev${isOpen ? " open" : ""}`} aria-hidden="true">›</span></td>
                    <td><span className="tr-ptext">{r.prompt}</span>{r.tags.map((t) => <span key={t} className="tr-tag">{t}</span>)}</td>
                    {engines.map((e) => (
                      <td key={e} className="tr-c-eng">
                        <Pos cell={r.cells[e]} />
                        {e === "ai_overview" && r.cells[e]?.organic && <small className="tr-organic" title="Your regular Google ranking for this prompt">Google #{r.cells[e]!.organic}</small>}
                      </td>
                    ))}
                    <td className="num"><b>{pct(r.visibility)}</b> <Delta now={r.visibility} prev={r.prevVisibility} /></td>
                    <td className="tr-c-x">
                      <button type="button" className="tr-x" aria-label={`Stop tracking ${r.prompt}`} onClick={async (ev) => {
                        ev.stopPropagation();
                        if (!confirm(`Stop tracking “${r.prompt}”?`)) return;
                        await removeTrackingPrompt(d.campaign.id, r.id);
                        router.refresh();
                      }}>×</button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="tr-pdetail"><td /><td colSpan={engines.length + 3}>
                      <div className="tr-detail-tabs" role="tablist">
                        {engines.map((e) => (
                          <button key={e} type="button" role="tab" aria-selected={engineOpen === e} onClick={() => { setEngineOpen(e); const c = r.cells[e]; if (c?.checkId) load(c.checkId); }}>
                            <PlatformIcon k={e} />{ENGINE_LABEL[e]}
                          </button>
                        ))}
                      </div>
                      {!cell ? <p className="note">Not checked on this engine yet.</p>
                        : det === "loading" || det === undefined ? <p className="note">Loading the answer…</p>
                        : typeof det === "string" ? <p className="field-error">{det}</p>
                        : (
                          <div className="tr-answer">
                            <div>
                              <p className="tr-label">AI answer <span className="muted">· {fmtDayTime(det.checked_at)}</span></p>
                              {det.error ? <p className="field-error">{det.error}</p>
                                : !det.answered ? <p className="note">Google showed no AI Overview for this search.{det.organic_position ? ` Your regular Google ranking: #${det.organic_position}.` : ""}</p>
                                : <p className="tr-answer-text"><Highlight text={det.answer ?? ""} names={[d.campaign.brand_name, ...d.campaign.aliases]} /></p>}
                            </div>
                            <div>
                              <p className="tr-label">Brands named, in order</p>
                              <ol className="tr-brandlist">
                                {det.brands.map((b) => <li key={b.name} className={b.name.toLowerCase() === d.campaign.brand_name.toLowerCase() || (det.mentioned && det.position === b.position) ? "you" : ""}>{b.name}</li>)}
                                {!det.brands.length && <li className="muted">None</li>}
                              </ol>
                              <p className="tr-label">Sources</p>
                              <ol className="tr-srclist">
                                {det.sources.map((s) => <li key={s.url} className={det.cited_urls.includes(s.url) ? "you" : ""}><a href={s.url} target="_blank" rel="noreferrer" className="url">{s.domain}</a>{s.title && <span className="note">{s.title}</span>}</li>)}
                                {!det.sources.length && <li className="muted">None listed</li>}
                              </ol>
                            </div>
                          </div>
                        )}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="tr-empty">No prompts match.</p>}
      </div>
    </section>
  );
}

// Marks the brand's name in the answer text.
function Highlight({ text, names }: { text: string; names: string[] }) {
  const words = names.filter((n) => n.trim().length > 1).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}

// ---------- Competitors ----------

function CompetitorsTab({ d, openSettings }: { d: Data; openSettings: () => void }) {
  const [q, setQ] = useState("");
  const list = d.brands.filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.you) - Number(a.you) || Number(b.tracked) - Number(a.tracked) || b.visibility - a.visibility);
  const max = Math.max(1, ...list.map((b) => b.visibility));
  return (
    <section className="card">
      <div className="tr-card-head">
        <h2>Brands in AI answers <span className="muted">{d.brands.length}</span></h2>
        <div className="tr-tools">
          <input className="tr-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter brands" aria-label="Filter brands" />
          <button type="button" className="btn-dark btn-small" onClick={openSettings}>Follow competitors</button>
        </div>
      </div>
      <div className="tr-scroll">
        <table className="tr-table">
          <thead><tr><th>Brand</th><th>Visibility</th><th className="num">Named in</th><th className="num">Answers</th><th className="num">Avg. position</th></tr></thead>
          <tbody>{list.map((b) => (
            <tr key={b.name} className={b.you ? "tr-current" : ""}>
              <td><b>{b.name}</b>{b.you && <span className="tr-tag you">you</span>}{b.tracked && <span className="tr-tag">following</span>}</td>
              <td><span className="tr-bar tr-bar-inline"><span style={{ width: `${(b.visibility / max) * 100}%`, background: b.you ? "var(--tr-you)" : undefined }} /></span> {b.visibility}%</td>
              <td className="num">{b.share}%</td><td className="num">{b.answers}</td><td className="num">{b.avgPosition || "–"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Sources ----------

function SourcesTab({ d }: { d: Data }) {
  const [q, setQ] = useState("");
  const list = d.sources.filter((s) => !q || s.domain.includes(q.toLowerCase()));
  const max = Math.max(1, ...list.map((s) => s.answers));
  return (
    <div className="tr-row tr-row-2">
      <section className="card">
        <div className="tr-card-head"><h2>Cited websites <span className="muted">{d.sources.length}</span></h2><input className="tr-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter domains" aria-label="Filter domains" /></div>
        <div className="tr-scroll">
          <table className="tr-table">
            <thead><tr><th>Domain</th><th>Share of answers</th><th className="num">Citations</th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.domain} className={s.you ? "tr-current" : ""}>
                <td><img src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=32`} alt="" width={14} height={14} className="tr-fav" />{s.domain}{s.you && <span className="tr-tag you">you</span>}</td>
                <td><span className="tr-bar tr-bar-inline"><span style={{ width: `${(s.answers / max) * 100}%` }} /></span> {s.share}%</td>
                <td className="num">{s.citations}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="tr-card-head"><h2>Your pages <span className="muted">{d.pages.length}</span></h2></div>
        {d.pages.length ? (
          <div className="tr-scroll">
            <table className="tr-table">
              <thead><tr><th>URL</th><th className="num">Answers</th><th className="num">Prompts</th><th>Engines</th><th className="num">Avg. pos.</th></tr></thead>
              <tbody>{d.pages.map((p) => (
                <tr key={p.url}>
                  <td><a href={p.url} target="_blank" rel="noreferrer" className="url">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</a></td>
                  <td className="num">{p.answers}</td><td className="num">{p.prompts}</td>
                  <td>{p.engines.map((e) => <span key={e} title={ENGINE_LABEL[e]}><PlatformIcon k={e} /></span>)}</td>
                  <td className="num">{p.avgPosition ?? "–"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="tr-empty">No AI answer cites {d.campaign.domain} yet.</p>}
      </section>
    </div>
  );
}
