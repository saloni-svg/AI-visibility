"use client";
import { fmtNum } from "./format";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { removeTrackedKeyword } from "../(dashboard)/actions";
import Icon from "./Icon";
import PlatformIcon from "./PlatformIcon";

type Row = {
  id: string; keyword: string; volume: number | null; checked: boolean; error: string | null;
  position: number | null; previous: number | null | undefined; url: string | null; features: string[]; localPack: boolean;
  aiOverview: string; competitors: Record<string, number | null>; top: { position: number; domain: string; url: string; title: string }[];
  suggestedUrl: string | null; history: (number | null)[]; traffic: number | null; prevTraffic: number | null;
  cpc: number | null; kd: number | null; intents: string[]; anyPosition: number | null; anyType: string | null;
  maps?: number | null; prevMaps?: number | null; aioPosition: number | null;
  platforms: Record<string, { position: number | null; cited: boolean; top: string[]; error?: string }>;
  prevPlatforms: Record<string, { position: number | null }> | null;
};
type Plat = { key: string; label: string };

// Search intent badges: I = informational, N = navigational, C = commercial, T = transactional.
const INTENT: Record<string, { letter: string; label: string; cls: string }> = {
  informational: { letter: "I", label: "Informational: the searcher wants to learn something", cls: "i" },
  navigational: { letter: "N", label: "Navigational: the searcher wants a specific site or brand", cls: "n" },
  commercial: { letter: "C", label: "Commercial: the searcher is comparing options before buying", cls: "c" },
  transactional: { letter: "T", label: "Transactional: the searcher is ready to buy or hire", cls: "t" },
};
// Keyword difficulty (0-100): how hard it is to reach Google's top 10.
const kdBand = (kd: number) =>
  kd < 15 ? { label: "Very easy", color: "#2db67c" } : kd < 30 ? { label: "Easy", color: "#7ccf6b" } : kd < 50 ? { label: "Possible", color: "#f2c94c" }
    : kd < 70 ? { label: "Difficult", color: "#f2994a" } : kd < 85 ? { label: "Hard", color: "#eb5757" } : { label: "Very hard", color: "#b3261e" };
const SHORT: Record<string, string> = { maps: "Maps", ai_overview: "AI Overview" };

// "#3 ▲2" style cell for one platform.
function RankCell({ now, before, notFound, title }: { now: number | null | undefined; before?: number | null; notFound: string; title?: string }) {
  if (now === undefined) return <span className="muted" title="Not checked">–</span>;
  if (now === null) return <span className="muted" title={title}>{notFound}</span>;
  const diff = before === undefined || before === null ? null : before - now;
  return (
    <span className="pt-rank" title={title}>
      <b>#{now}</b>
      {diff ? <span className={`pt-change ${diff > 0 ? "up" : "down"}`}>{diff > 0 ? "▲" : "▼"}{Math.abs(diff)}</span> : null}
    </span>
  );
}

const FEATURES: Record<string, string> = {
  ai_overview: "AI Overview", featured_snippet: "Featured snippet", local_pack: "Local pack", people_also_ask: "People also ask",
  video: "Videos", images: "Images", top_stories: "Top stories", knowledge_graph: "Knowledge panel", map: "Map", shopping: "Shopping",
};
const short = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "");
const FILTERS = [
  { key: "all", label: "All" },
  { key: "top10", label: "Top 10" },
  { key: "notranking", label: "Not ranking" },
  { key: "aio", label: "In AI Overview" },
] as const;

export default function PositionsTable({ domain, rows, competitors, hasChecks, platforms }: { domain: string; rows: Row[]; competitors: string[]; hasChecks: boolean; platforms: Plat[] }) {
  const cols = platforms.filter((p) => p.key !== "google");
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [sort, setSort] = useState<"volume" | "position" | "traffic" | "kd" | "cpc">("volume");
  const [open, setOpen] = useState<string | null>(null);
  const [, start] = useTransition();

  const list = useMemo(() => {
    const f = rows.filter((r) =>
      filter === "all" ? true : filter === "top10" ? r.position !== null && r.position <= 10 : filter === "notranking" ? r.checked && r.position === null : r.aiOverview !== "none");
    return f.sort((a, b) =>
      sort === "volume" ? (b.volume ?? 0) - (a.volume ?? 0) : sort === "traffic" ? (b.traffic ?? -1) - (a.traffic ?? -1)
        : sort === "kd" ? (a.kd ?? 101) - (b.kd ?? 101) : sort === "cpc" ? (b.cpc ?? -1) - (a.cpc ?? -1) : (a.position ?? 999) - (b.position ?? 999));
  }, [rows, filter, sort]);
  const count = (k: (typeof FILTERS)[number]["key"]) =>
    k === "all" ? rows.length : k === "top10" ? rows.filter((r) => r.position !== null && r.position <= 10).length
      : k === "notranking" ? rows.filter((r) => r.checked && r.position === null).length : rows.filter((r) => r.aiOverview !== "none").length;

  const [removing, setRemoving] = useState<string | null>(null);
  const remove = (id: string, keyword: string) => {
    if (!window.confirm(`Stop tracking "${keyword}"? Its past results stay saved.`)) return;
    setRemoving(id);
    start(async () => { await removeTrackedKeyword(domain, id); setRemoving(null); router.refresh(); });
  };
  const grid = { gridTemplateColumns: `minmax(220px, 2fr) 110px ${cols.map(() => "minmax(112px, 0.8fr)").join(" ")} 90px 110px 84px 72px 76px minmax(200px, 1.4fr)` };

  return (
    <section className="card cr-table-card">
      <div className="cr-table-head">
        <h2>Keywords <span className="muted">({rows.length})</span></h2>
        <div className="cr-toolbar pt-toolbar">
          <div className="seg" role="group" aria-label="Filter">
            {FILTERS.map((f) => <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label} <span>{count(f.key)}</span></button>)}
          </div>
          <label><span className="sr-only">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as "volume" | "position" | "traffic" | "kd" | "cpc")}>
              <option value="volume">Sort: search volume</option>
              <option value="traffic">Sort: estimated traffic</option>
              <option value="kd">Sort: easiest first (KD)</option>
              <option value="cpc">Sort: highest CPC</option>
              <option value="position">Sort: position</option>
            </select>
          </label>
        </div>
      </div>
      <div className="table-scroll">
        <div className="cr-grid-table pt-table">
          <div className="cr-row cr-head" style={grid}>
            <span>Keyword</span><span className="cr-num"><PlatformIcon k="google" />Google</span>
            {cols.map((c) => <span key={c.key} className="cr-num cr-ent" title={c.label}><PlatformIcon k={c.key} /><span className="cr-ent-name">{SHORT[c.key] ?? c.label}</span></span>)}
            <span className="cr-num">Volume</span><span className="cr-num" title="Estimated monthly visits from Google: search volume × the share of clicks at your position">Est. traffic</span>
            <span className="pt-center" title="Search intent: Informational, Navigational, Commercial, Transactional">Intent</span>
            <span className="cr-num" title="Keyword difficulty (0–100): how hard it is to reach Google's top 10">KD %</span>
            <span className="cr-num" title="Average cost per click in Google Ads (USD)">CPC</span><span className="pt-url-head" title="The page of your site that ranks on Google for this keyword">Ranking URL</span>
          </div>
          {list.map((r) => {
            // Only keywords actually checked this time get an up/down/lost change.
            const change = !r.checked || r.error || r.previous === undefined || r.position === r.previous ? null
              : r.previous === null ? "new" : r.position === null ? "lost" : r.previous - r.position;
            return (
              <Fragment key={r.id}>
                <div className="cr-row" style={grid}>
                  <span className="pt-kw-cell">
                  <button className="cr-expand" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} disabled={!r.checked}>
                    <Icon name="chevron" size={14} />{r.keyword}
                  </button>
                  <button type="button" className="pt-remove" aria-label={`Stop tracking ${r.keyword}`} title="Stop tracking this keyword"
                    disabled={removing === r.id} onClick={() => remove(r.id, r.keyword)}>
                    <Icon name="x" size={14} />
                  </button>
                  </span>
                  <span className="cr-num pt-pos">
                    {!r.checked ? (r.error ? <span className="muted" title={r.error}>pending</span> : <span className="muted">{hasChecks ? "–" : "not checked"}</span>) : r.error ? <span className="muted" title={r.error}>error</span>
                      : r.position === null ? (
                        r.anyPosition && r.anyType && r.anyType !== "organic"
                          ? <span title={`Not in the regular results, but your site appears on the page as: ${FEATURES[r.anyType] ?? r.anyType.replace(/_/g, " ")}`}><b>#{r.anyPosition}</b> <span className="pt-any">{FEATURES[r.anyType] ?? r.anyType.replace(/_/g, " ")}</span></span>
                          : <span className="muted">&gt;100</span>
                      ) : <b>{r.position}</b>}
                    {change === "new" && <span className="pt-change up">new</span>}
                    {change === "lost" && <span className="pt-change down">lost</span>}
                    {typeof change === "number" && <span className={`pt-change ${change > 0 ? "up" : "down"}`}>{change > 0 ? "▲" : "▼"}{Math.abs(change)}</span>}
                    {r.localPack && <span className="pt-change up" title="You appear in Google's map pack for this keyword">map</span>}
                  </span>
                  {cols.map((c) => (
                    <span key={c.key} className="cr-num">
                      {c.key === "ai_overview" ? (
                        !r.checked ? <span className="muted">–</span>
                          : r.aiOverview === "cited" ? <span className="pill pill-strong">Cited #{r.aioPosition ?? "?"}</span>
                          : r.aiOverview === "not_cited" ? <span className="pill pill-missing">Not cited</span>
                          : <span className="muted" title="Google showed no AI Overview">No overview</span>
                      ) : c.key === "maps" ? (
                        <RankCell now={r.maps} before={r.prevMaps} notFound=">20" title={r.platforms.maps?.error} />
                      ) : (
                        <span className="pt-ai-cell">
                          <RankCell now={r.platforms[c.key] ? r.platforms[c.key].position : undefined} before={r.prevPlatforms?.[c.key]?.position}
                            notFound={r.platforms[c.key]?.error ? "error" : "Not named"}
                            title={r.platforms[c.key]?.error ?? (r.platforms[c.key]?.top.length ? `Named: ${r.platforms[c.key].top.join(", ")}` : undefined)} />
                          {r.platforms[c.key]?.cited && <span className="pt-cited" title="Links to your site">🔗</span>}
                        </span>
                      )}
                    </span>
                  ))}
                  <span className="cr-num">{r.volume === null ? <span className="muted">–</span> : fmtNum(r.volume)}</span>
                  <span className="cr-num">
                    {r.traffic === null ? <span className="muted">–</span> : r.traffic === 0 ? <span className="muted">0</span> : <b>{fmtNum(r.traffic)}</b>}
                    {r.traffic !== null && r.prevTraffic !== null && r.traffic !== r.prevTraffic && (
                      <span className={`pt-change ${r.traffic > r.prevTraffic ? "up" : "down"}`}>{r.traffic > r.prevTraffic ? "+" : "−"}{fmtNum(Math.abs(r.traffic - r.prevTraffic))}</span>
                    )}
                  </span>
                  <span className="pt-intents pt-center">
                    {r.intents.length ? r.intents.map((i) => INTENT[i] && <span key={i} className={`pt-intent ${INTENT[i].cls}`} title={INTENT[i].label}>{INTENT[i].letter}</span>) : <span className="muted">–</span>}
                  </span>
                  <span className="cr-num">
                    {r.kd === null ? <span className="muted">–</span> : (
                      <span className="pt-kd" title={kdBand(r.kd).label}><b>{r.kd}</b><span className="dot" style={{ background: kdBand(r.kd).color }} /></span>
                    )}
                  </span>
                  <span className="cr-num">{r.cpc === null ? <span className="muted">–</span> : `$${r.cpc.toFixed(2)}`}</span>
                  <span className="pt-url">
                    {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="url">{short(r.url)}</a>
                      : r.suggestedUrl ? <span className="muted" title="Not ranking yet. This is your page that best matches the keyword: improve it to rank.">Best page: <a href={r.suggestedUrl} target="_blank" rel="noreferrer" className="url">{short(r.suggestedUrl)}</a></span>
                      : <span className="muted">{r.checked ? "Not ranking" : "–"}</span>}
                  </span>
                </div>
                {open === r.id && (
                  <div className="pt-detail">
                    <div>
                      <p className="pt-detail-title">Google top 10</p>
                      <ol>{r.top.map((t) => (
                        <li key={t.position} className={t.domain.endsWith(domain) ? "is-you" : competitors.some((c) => t.domain.endsWith(c)) ? "is-comp" : ""}>
                          <span className="pt-detail-pos">{t.position}</span>
                          <a href={t.url} target="_blank" rel="noreferrer">{t.title || t.domain}</a> <span className="muted">{t.domain}</span>
                        </li>
                      ))}</ol>
                    </div>
                    <div className="pt-detail-side">
                      <p className="pt-detail-title">On this results page</p>
                      <div className="entity-tags">{r.features.length ? r.features.map((f) => <span key={f} className="entity-tag">{FEATURES[f] ?? f.replace(/_/g, " ")}</span>) : <span className="muted">Only regular results</span>}</div>
                      {competitors.length > 0 && (
                        <>
                          <p className="pt-detail-title">Competitors on Google</p>
                          <ul className="pt-mini">{competitors.map((c) => <li key={c}><span>{c}</span><b>{r.competitors[c] ? `#${r.competitors[c]}` : "–"}</b></li>)}</ul>
                        </>
                      )}
                      {Object.entries(r.platforms).filter(([k]) => k !== "maps" && r.platforms[k].top.length).length > 0 && (
                        <>
                          <p className="pt-detail-title">Who AI recommends</p>
                          <ul className="pt-mini">
                            {Object.entries(r.platforms).filter(([k, v]) => k !== "maps" && v.top.length).map(([k, v]) => (
                              <li key={k}><span><PlatformIcon k={k} />{cols.find((c) => c.key === k)?.label ?? k}</span><span className="pt-mini-names">{v.top.join(", ")}</span></li>
                            ))}
                          </ul>
                        </>
                      )}
                      {r.platforms.maps?.top?.[0] && <p className="note">On Maps as: {r.platforms.maps.top[0]}</p>}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
          {list.length === 0 && <p className="note cr-empty">No keywords in this group.</p>}
        </div>
      </div>
    </section>
  );
}
