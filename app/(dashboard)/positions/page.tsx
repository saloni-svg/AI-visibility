import "../agent/agent.css";
import "./positions-v2.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { findBrand } from "@/lib/brands";
import { cleanDomain } from "@/lib/domain";
import { loadPositions, refreshVolumes } from "@/lib/positions";
import { hasKeywordCom } from "@/lib/keywordcom";
import { ensureLocation } from "@/lib/location-detect";
import Icon from "../../components/Icon";
import PositionsManager from "../../components/PositionsManager";
import PositionsTable from "../../components/PositionsTable";
import RunPicker from "../../components/RunPicker";
import TrendChart from "../../components/TrendChart";
import { ENTITY_COLORS } from "../../components/CompetitorForm";
import PlatformIcon from "../../components/PlatformIcon";

export const dynamic = "force-dynamic";

function Change({ now, prev, lowerIsBetter = false, suffix = "" }: { now: number | null; prev: number | null | undefined; lowerIsBetter?: boolean; suffix?: string }) {
  if (now === null || prev === null || prev === undefined || now === prev) return null;
  const better = lowerIsBetter ? now < prev : now > prev;
  const diff = Math.round(Math.abs(now - prev) * 10) / 10;
  return <span className={`delta ${better ? "delta-up" : "delta-down"}`}>{now > prev ? "+" : "−"}{diff}{suffix}</span>;
}

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ domain?: string; country?: string; run?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const params = await searchParams;
  const domain = cleanDomain(params.domain ?? "");
  if (!domain) redirect("/");
  const brand = await findBrand(domain);
  if (!brand) {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="trend" size={22} /></span>
          <h2>Analyze {domain} first</h2>
          <Link href={`/analyze?domain=${domain}`} className="btn-primary btn-link">Analyze {domain}</Link>
        </div>
      </main>
    );
  }
  // First visit: find the business's city from its website (a few seconds, once).
  await ensureLocation(brand.id, domain).catch(() => null);
  const fresh = await findBrand(domain);
  const countries = fresh?.countries?.length ? fresh.countries : brand.countries?.length ? brand.countries : ["US"];
  // Default to the country where the business was found.
  const located = countries.find((c) => (fresh?.tracking_locations as Record<string, unknown> | undefined)?.[c]);
  const country = countries.includes(params.country ?? "") ? params.country! : located ?? countries[0];
  // Fill in search volume, CPC, difficulty and intent for keywords that don't have them yet.
  const metricProblems = await refreshVolumes(brand.id, country).catch((e) => [String(e.message)]);
  let data: Awaited<ReturnType<typeof loadPositions>>;
  try {
    data = await loadPositions({ id: brand.id, domain, countries }, country, params.run);
  } catch {
    return (
      <main className="dash">
        <div className="card empty-state empty-error">
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h2>Position tracking isn&apos;t set up yet</h2>
          <p className="note">Run <code>supabase/migrations/0005_position_tracking.sql</code> in the Supabase SQL editor, then reload.</p>
        </div>
      </main>
    );
  }
  const s = data.summary;
  const series = [
    { key: "you", label: domain, color: ENTITY_COLORS[0] },
    ...data.competitors.map((d, i) => ({ key: d, label: d, color: ENTITY_COLORS[(i % 4) + 1] })),
  ];

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> Boost &amp; Monitor <span aria-hidden="true">›</span> Position tracking</p>
          <h1>Position tracking: <span className="muted-strong">{domain}</span></h1>
          <p className="subtitle">{hasKeywordCom() ? "Your Google rank for each keyword, AI Overview citations and competitors, from Keyword.com's daily checks." : "Your rank for each keyword on Google, Google Maps, AI Overview, ChatGPT, Gemini and Perplexity."}</p>
          <p className="note">📍 Checked from: <b>{data.location ? data.location.name.replace(/,/g, ", ") : `${data.countries.find((c) => c.code === country)?.name ?? country} (whole country)`}</b></p>
        </div>
      </header>

      <div className="filter-bar">
        <nav className="segmented" aria-label="Country">
          {data.countries.map((c) => (
            <Link key={c.code} href={`/positions?domain=${domain}&country=${c.code}`} scroll={false} aria-current={c.code === country}>{c.flag} {c.code}</Link>
          ))}
        </nav>
        {data.run && <RunPicker runs={data.runs} value={data.run.id} query={`domain=${domain}&country=${country}`} />}
      </div>

      <PositionsManager domain={domain} country={country} countryName={data.countries.find((c) => c.code === country)?.name ?? country} keywordCount={data.keywordCount} location={data.location} tracker={hasKeywordCom() ? "keywordcom" : "dataforseo"} />

      {!s ? (
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="trend" size={22} /></span>
          <h2>{data.keywordCount ? "Check positions to see your rankings" : "Add keywords to start tracking"}</h2>
          <p className="note">Each check looks at Google&apos;s top 100 results and its AI Overview for every keyword.</p>
        </div>
      ) : (
        <>
          <section className="kpis">
            <div className="card stat">
              <span className="stat-label">Visibility</span>
              <span className="stat-value">{s.you.visibility}% <Change now={s.you.visibility} prev={s.prev?.visibility} suffix="%" /></span>
              <span className="stat-sub">Share of possible clicks you get from these keywords</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Estimated traffic</span>
              <span className="stat-value">{s.you.traffic.toLocaleString("en-IN")} <Change now={s.you.traffic} prev={s.prev?.traffic} /></span>
              <span className="stat-sub">Monthly visits from these keywords</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Average position</span>
              <span className="stat-value">{s.you.avgPosition ?? "–"} <Change now={s.you.avgPosition} prev={s.prev?.avgPosition} lowerIsBetter /></span>
              <span className="stat-sub">Not in top 100 counts as 100{s.localPack ? ` · in the map pack for ${s.localPack}` : ""}</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Cited in AI Overview</span>
              <span className="stat-value">{s.aiOverview.cited}<span className="stat-of"> / {s.aiOverview.present}</span></span>
              <span className="stat-sub">Keywords with an AI Overview that links to you</span>
            </div>
          </section>

          {s.byPlatform.length > 0 && (
            <section className="card panel">
              <div className="panel-head"><div className="panel-title"><h2>Rank by platform</h2><p className="note">Where you appear for these keywords on each platform (position 1 = first result or first brand named).</p></div></div>
              <div className="pt-plat-grid">
                {s.byPlatform.map((p) => (
                  <div key={p.key} className="pt-plat">
                    <span className="pt-plat-name"><PlatformIcon k={p.key} />{p.label}</span>
                    <span className="pt-plat-big">{p.found}<span className="stat-of"> / {p.checked}</span></span>
                    <span className="note">{p.key === "google" ? "keywords in top 100" : p.key === "maps" ? "keywords in top 20 on Maps" : p.key === "ai_overview" ? "AI Overviews citing you" : "answers naming you"}</span>
                    <span className="pt-plat-sub">Top 3: <b>{p.top3}</b> · Avg position: <b>{p.avg ?? "–"}</b></span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="two-col">
            <section className="card panel">
              <div className="panel-head"><div className="panel-title"><h2>Visibility over time</h2><p className="note">You and your competitors, per check.</p></div></div>
              <div className="panel-body">
                {data.trend.length < 2 ? (
                  <div className="inline-empty"><Icon name="trend" /><span>The trend appears after your second check.</span></div>
                ) : (
                  <>
                    <ul className="legend">{series.map((x) => <li key={x.key}><span className="key-line" style={{ background: x.color }} />{x.label}</li>)}</ul>
                    <TrendChart series={series} points={data.trend} />
                  </>
                )}
              </div>
            </section>
            <section className="card panel">
              <div className="panel-head"><div className="panel-title"><h2>Rankings</h2><p className="note">How many keywords rank in each range.</p></div></div>
              <div className="panel-body">
                <ul className="pt-dist">
                  {([["Top 3", s.you.top3], ["Top 10", s.you.top10], ["Top 20", s.you.top20], ["Top 100", s.you.top100]] as const).map(([label, n]) => (
                    <li key={label}>
                      <span>{label}</span>
                      <span className="dist-track"><span style={{ width: `${(n / Math.max(1, s.checked)) * 100}%`, background: "var(--you)" }} /></span>
                      <b>{n}</b>
                    </li>
                  ))}
                </ul>
                {s.competitors.length > 0 && (
                  <table className="pt-comp">
                    <thead><tr><th>Domain</th><th className="num">Visibility</th><th className="num">Avg position</th><th className="num">Top 10</th></tr></thead>
                    <tbody>
                      <tr><td><span className="dot" style={{ background: ENTITY_COLORS[0] }} /> {domain} <span className="badge badge-you">You</span></td><td className="num">{s.you.visibility}%</td><td className="num">{s.you.avgPosition}</td><td className="num">{s.you.top10}</td></tr>
                      {s.competitors.map((c, i) => (
                        <tr key={c.domain}><td><span className="dot" style={{ background: ENTITY_COLORS[(i % 4) + 1] }} /> {c.domain}</td><td className="num">{c.visibility}%</td><td className="num">{c.avgPosition}</td><td className="num">{c.top10}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {metricProblems.length > 0 && (
        <p className="field-error">Some keyword data couldn&apos;t be loaded from DataForSEO: {metricProblems.join(" · ")}</p>
      )}
      {data.rows.length > 0 && <PositionsTable domain={domain} rows={data.rows} competitors={data.competitors} hasChecks={!!s} platforms={(s?.byPlatform ?? []).map((p) => ({ key: p.key, label: p.label }))} />}
      {s && s.errors > 0 && <p className="note">{s.errors} keywords couldn&apos;t be checked this time (hover a keyword for the reason). The next check tries them again.</p>}
    </main>
  );
}
