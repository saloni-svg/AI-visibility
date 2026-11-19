"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { RankPeriod, RankReport as Report } from "@/lib/rank-report";
import { fmtDay, fmtNum } from "./format";
import ReportActions from "./ReportActions";

// Keyword rank report from Keyword.com: one project at a time, rank change over a chosen
// period, start and best rank, ranking page. Filter, sort and export to CSV.

const PERIODS: { key: RankPeriod; label: string; long: string }[] = [
  { key: "day", label: "1 day", long: "since yesterday" },
  { key: "week", label: "7 days", long: "over the last 7 days" },
  { key: "month", label: "30 days", long: "over the last 30 days" },
  { key: "life", label: "Since start", long: "since tracking started" },
];
type Sort = "rank" | "change" | "volume" | "keyword";

function Change({ n }: { n: number | null }) {
  if (n === null) return <span className="muted" title="No data for this period">–</span>;
  if (n === 0) return <span className="muted">0</span>;
  return <span className={`pt-change ${n > 0 ? "up" : "down"}`}>{n > 0 ? "▲" : "▼"}{Math.abs(n)}</span>;
}
const Rank = ({ n }: { n: number | null }) => (n === null ? <span className="muted" title="Not in Google's top 100">&gt;100</span> : <b>{n}</b>);

function download(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export default function RankReport({ data, error, query, domain, shared = false }: { data: Report | null; error: string | null; query: string; domain: string; shared?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [period, setPeriod] = useState<RankPeriod>("week");
  const [location, setLocation] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("rank");

  const rows = data?.rows ?? [];
  const locations = useMemo(() => [...new Set(rows.map((r) => r.location))].sort(), [rows]);
  const inPlace = useMemo(() => rows.filter((r) => location === "all" || r.location === location), [rows, location]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = inPlace.filter((r) => !term || r.keyword.toLowerCase().includes(term));
    const by: Record<Sort, (a: (typeof list)[0], b: (typeof list)[0]) => number> = {
      rank: (a, b) => (a.rank ?? 101) - (b.rank ?? 101) || (b.volume ?? 0) - (a.volume ?? 0),
      change: (a, b) => (b.change[period] ?? -1e9) - (a.change[period] ?? -1e9),
      volume: (a, b) => (b.volume ?? -1) - (a.volume ?? -1),
      keyword: (a, b) => a.keyword.localeCompare(b.keyword),
    };
    return [...list].sort(by[sort]);
  }, [inPlace, q, sort, period]);

  if (error) {
    return (
      <section className="card panel">
        <div className="panel-head"><div className="panel-title"><h2>Keyword rank report</h2></div></div>
        <p className="field-error rr-pad" role="alert">Couldn&apos;t load the report from Keyword.com: {error}</p>
      </section>
    );
  }
  if (!data) return null;

  const p = PERIODS.find((x) => x.key === period)!;
  const ranked = inPlace.filter((r) => r.rank !== null);
  const avg = ranked.length ? Math.round((ranked.reduce((s, r) => s + r.rank!, 0) / ranked.length) * 10) / 10 : null;
  const up = inPlace.filter((r) => (r.change[period] ?? 0) > 0).length;
  const down = inPlace.filter((r) => (r.change[period] ?? 0) < 0).length;

  function exportCsv() {
    download(`rank-report-${(data!.project ?? "project").replace(/\W+/g, "-")}-${data!.checked ?? "latest"}.csv`, [
      ["Keyword", "Location", "Rank", "1 day", "7 days", "30 days", "Since start", "Start rank", "Best rank", "Search volume", "Avg. CPC (USD)", "AI Overview", "Ranking URL", "Last checked"],
      ...shown.map((r) => [r.keyword, r.location.replace(/^\S+\s/, ""), r.rank ?? ">100", r.change.day ?? "", r.change.week ?? "", r.change.month ?? "", r.change.life ?? "",
        r.start ?? ">100", r.best ?? ">100", r.volume ?? "", r.cpc ?? "", r.aiOverview === "cited" ? "Cited" : r.aiOverview === "not_cited" ? "Not cited" : "", r.url ?? "", r.checked ?? ""]),
    ]);
  }

  const grid = { gridTemplateColumns: "minmax(220px, 2fr) minmax(130px, 1fr) 70px 84px 70px 70px 90px 84px 84px minmax(200px, 1.6fr)" };

  return (
    <section className="card cr-table-card rr" id="rank-report">
      <div className="cr-table-head rr-head">
        <div className="panel-title">
          <h2>Keyword rank report</h2>
          <p className="note">
            Ranks from Keyword.com{data.checked ? <>, last checked <b>{fmtDay(data.checked)}</b></> : ""}; search volume and average CPC from {data.metricsSource ?? "Google Keyword Planner (unavailable right now)"}. ▲ = places gained, ▼ = places lost, {p.long}.
          </p>
        </div>
        {data.projects.length > 1 && !shared && (
          <label className="rr-project">
            Keyword.com project
            <select value={data.project ?? ""} onChange={(e) => router.push(`${path}?${query}&project=${encodeURIComponent(e.target.value)}`, { scroll: false })}>
              {data.projects.map((x) => <option key={x.id} value={x.id}>{x.id} ({x.keywords})</option>)}
            </select>
          </label>
        )}
      </div>

      {!data.project ? (
        <p className="note rr-pad">No Keyword.com project tracks this domain yet. Add keywords above and press <b>Check positions</b> to create one.</p>
      ) : (
        <>
          <div className="rr-kpis">
            <div><span className="stat-label">Keywords</span><span className="rr-big">{inPlace.length}</span></div>
            <div><span className="stat-label">Average rank</span><span className="rr-big">{avg ?? "–"}</span><span className="note">of {ranked.length} in top 100</span></div>
            <div><span className="stat-label">Top 3 / Top 10</span><span className="rr-big">{ranked.filter((r) => r.rank! <= 3).length} / {ranked.filter((r) => r.rank! <= 10).length}</span></div>
            <div><span className="stat-label">Improved {p.label === "Since start" ? "since start" : `· ${p.label}`}</span><span className="rr-big rr-up">{up}</span></div>
            <div><span className="stat-label">Declined {p.label === "Since start" ? "since start" : `· ${p.label}`}</span><span className="rr-big rr-down">{down}</span></div>
          </div>

          <div className="cr-toolbar pt-toolbar rr-toolbar">
            <div className="seg" role="group" aria-label="Change period">
              {PERIODS.map((x) => <button key={x.key} type="button" aria-pressed={period === x.key} onClick={() => setPeriod(x.key)}>{x.label}</button>)}
            </div>
            {locations.length > 1 && (
              <label><span className="sr-only">Location</span>
                <select value={location} onChange={(e) => setLocation(e.target.value)}>
                  <option value="all">All locations</option>
                  {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            )}
            <label><span className="sr-only">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="rank">Sort: rank</option>
                <option value="change">Sort: biggest gain ({p.label})</option>
                <option value="volume">Sort: search volume</option>
                <option value="keyword">Sort: A–Z</option>
              </select>
            </label>
            <label className="rr-search"><span className="sr-only">Search keywords</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keywords" />
            </label>
            <button type="button" className="btn-secondary btn-small" onClick={exportCsv} disabled={!shown.length}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Export CSV
            </button>
            <ReportActions kind="positions" domain={domain} shared={shared} target="rank-report" title={`Keyword rank report - ${data.project ?? domain} - ${data.checked ?? "latest"}`} />
          </div>

          <div className="table-scroll">
            <div className="cr-grid-table rr-table">
              <div className="cr-row cr-head" style={grid}>
                <span>Keyword</span><span>Location</span><span className="cr-num">Rank</span>
                <span className="cr-num" title={`Places gained or lost ${p.long}`}>{p.label}</span>
                <span className="cr-num" title="Rank when Keyword.com started tracking this keyword">Start</span>
                <span className="cr-num" title="Best rank since tracking started">Best</span>
                <span className="cr-num" title="Google Keyword Planner: average monthly searches">Volume</span>
                <span className="cr-num" title="Google Keyword Planner: average cost per click (USD)">Avg. CPC</span>
                <span className="cr-num" title="Google AI Overview for this keyword">AI Overview</span>
                <span>Ranking URL</span>
              </div>
              {shown.map((r) => (
                <div key={r.id} className="cr-row" style={grid}>
                  <span className="pt-kw-cell" title={r.checked ? `Checked ${fmtDay(r.checked)}` : "Not checked yet"}>{r.keyword}</span>
                  <span className="rr-loc">{r.location}</span>
                  <span className="cr-num"><Rank n={r.rank} />{r.localPack && <span className="pt-change up" title="In Google's map pack">map</span>}</span>
                  <span className="cr-num"><Change n={r.change[period]} /></span>
                  <span className="cr-num"><Rank n={r.start} /></span>
                  <span className="cr-num"><Rank n={r.best} /></span>
                  <span className="cr-num">{r.volume ? fmtNum(r.volume) : <span className="muted">–</span>}</span>
                  <span className="cr-num">{r.cpc != null ? `$${r.cpc.toFixed(2)}` : <span className="muted">–</span>}</span>
                  <span className="cr-num">
                    {r.aiOverview === "cited" ? <span className="pill pill-strong">Cited</span> : r.aiOverview === "not_cited" ? <span className="pill pill-missing">Not cited</span> : <span className="muted">–</span>}
                  </span>
                  <span className="pt-url">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" title={r.url}>{r.url.replace(/^https?:\/\/(www\.)?[^/]+/, "") || "/"}</a> : <span className="muted">–</span>}</span>
                </div>
              ))}
              {!shown.length && <p className="note rr-pad">No keywords match.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
