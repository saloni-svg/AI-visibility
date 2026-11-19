import "../(dashboard)/agent/agent.css";
import "../(dashboard)/seo/seo.css";
import Link from "next/link";
import { findBrand } from "@/lib/brands";
import { loadSeoPage, type SeoData, type Sources } from "@/lib/seo-agent";
import { db } from "@/lib/supabase";
import { hasWindsor } from "@/lib/windsor";
import Icon from "../components/Icon";
import ReportActions from "../components/ReportActions";
import SeoPlanView from "../components/SeoPlanView";
import SeoRunner from "../components/SeoRunner";
import WindsorSources from "../components/WindsorSources";

const n = (v: number) => Math.round(v).toLocaleString("en-IN");
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?[^/]+/, "") || "/";
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Delta({ now, before, lowerIsBetter = false, label }: { now: number | null; before: number | null; lowerIsBetter?: boolean; label: string }) {
  if (now === null || before === null || !before) return null;
  const c = pct(now, before)!;
  if (!c) return <span className="note">0% {label}</span>;
  const good = lowerIsBetter ? c < 0 : c > 0;
  return <span className={`delta ${good ? "delta-up" : "delta-down"}`}>{c > 0 ? "+" : ""}{c}% {label}</span>;
}

// SEO agent page for one domain: Windsor.ai sources, the runner, and the latest (or chosen) plan
// with the data behind it. Used by the dashboard and by share links (`shared` = read-only).
export default async function SeoReport({ domain, params, shared = false }: { domain: string; params: { plan?: string }; shared?: boolean }) {
  const brand = await findBrand(domain);
  if (!brand) {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="sparkles" size={22} /></span>
          <h2>Analyze {domain} first</h2>
          {!shared && <Link href={`/analyze?domain=${domain}`} className="btn-primary btn-link">Analyze {domain}</Link>}
        </div>
      </main>
    );
  }
  let page: Awaited<ReturnType<typeof loadSeoPage>>;
  let sources: Sources | null = null;
  try {
    page = await loadSeoPage(brand.id, params.plan);
    const { data } = await db().from("brands").select("seo_sources").eq("id", brand.id).single();
    sources = (data?.seo_sources as Sources | null) ?? null;
  } catch {
    return (
      <main className="dash">
        <div className="card empty-state empty-error">
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h2>The SEO agent isn&apos;t set up yet</h2>
          {!shared && <p className="note">Run <code>supabase/migrations/0014_seo_agent.sql</code> in the Supabase SQL editor, then reload.</p>}
        </div>
      </main>
    );
  }
  const plan = page.plan;
  const d = plan?.data as SeoData | undefined;
  const lastFailed = page.plans[0]?.status === "failed" ? (page.plans[0].error as string | null) : null;
  const done = page.plans.filter((p) => p.status === "completed");

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> AI Agents <span aria-hidden="true">›</span> SEO agent</p>
          <h1>SEO plan: <span className="muted-strong">{domain}</span></h1>
          <p className="subtitle">Real Search Console and GA4 data (through Windsor.ai), your rankings, site audit and AI visibility, turned into a prioritised 90-day plan.</p>
          {plan && <p className="note shared-filters">Plan of {fmtDate(plan.created_at)}{plan.focus ? ` · focus: ${plan.focus}` : ""}{d?.periods ? ` · data ${fmtDate(d.periods.cur[0])} – ${fmtDate(d.periods.cur[1])}` : ""}{plan.plan.writtenBy ? ` · written by ${plan.plan.writtenBy}` : ""}</p>}
        </div>
        {plan && (
          <div className="header-actions">
            <ReportActions kind="seo" domain={domain} shared={shared} query={{ plan: plan.id }} title={`SEO plan - ${domain} - ${plan.created_at.slice(0, 10)}`} />
          </div>
        )}
      </header>

      {!shared && <WindsorSources domain={domain} connected={hasWindsor()} gsc={sources?.gsc ?? null} ga4={sources?.ga4 ?? null} />}
      {!shared && (
        <SeoRunner
          key={page.running?.id ?? "idle"}
          domain={domain}
          running={page.running ? { id: page.running.id, log: page.running.log as { at: string; kind: string; text: string }[] } : null}
          lastError={lastFailed}
        />
      )}
      {!shared && done.length > 1 && (
        <nav className="seo-history no-print" aria-label="Earlier plans">
          <span className="note">Plans:</span>
          {done.map((p) => (
            <Link key={p.id} href={`/seo?domain=${domain}&plan=${p.id}`} aria-current={p.id === plan?.id ? "page" : undefined}>{fmtDate(p.created_at)}</Link>
          ))}
        </nav>
      )}

      {!plan ? (
        !page.running && (
          <div className="card empty-state">
            <span className="empty-icon"><Icon name="sparkles" size={22} /></span>
            <h2>No SEO plan yet</h2>
            <p className="note">{shared ? "This plan isn't available." : "Press Create SEO plan above. Connect Windsor.ai first for real Search Console and GA4 data."}</p>
          </div>
        )
      ) : (
        <>
          {d && <Kpis d={d} />}
          {d?.problems?.length ? <p className="note seo-problems">Missing data: {d.problems.join(" · ")}</p> : null}
          <SeoPlanView domain={domain} planId={plan.id} plan={plan.plan} shared={shared} />
          {d?.opportunities && <Evidence d={d} />}
        </>
      )}
    </main>
  );
}

function Kpis({ d }: { d: SeoData }) {
  const g = d.gsc;
  if (!g) return null;
  const ctr = (m: { clicks: number; impressions: number }) => (m.impressions ? (m.clicks / m.impressions) * 100 : 0);
  const max = Math.max(1, ...(g?.monthly ?? []).map((m) => m.clicks));
  return (
    <>
      <section className="kpis">
        {g && (
          <>
            <div className="card stat">
              <span className="stat-label">Clicks from Google · 28 days</span>
              <span className="stat-value">{n(g.totals.cur.clicks)}</span>
              <span className="stat-sub"><Delta now={g.totals.cur.clicks} before={g.totals.prev.clicks} label="vs previous 28 days" /> <Delta now={g.totals.cur.clicks} before={g.totals.yoy.clicks} label="vs last year" /></span>
            </div>
            <div className="card stat">
              <span className="stat-label">Impressions</span>
              <span className="stat-value">{n(g.totals.cur.impressions)}</span>
              <span className="stat-sub"><Delta now={g.totals.cur.impressions} before={g.totals.prev.impressions} label="vs previous 28 days" /></span>
            </div>
            <div className="card stat">
              <span className="stat-label">Click-through rate (CTR)</span>
              <span className="stat-value">{ctr(g.totals.cur).toFixed(1)}%</span>
              <span className="stat-sub">
                <Delta now={ctr(g.totals.cur)} before={ctr(g.totals.prev)} label="vs previous 28 days" />{" "}
                Brand searches: {g.totals.cur.clicks ? Math.round((g.branded.clicks / g.totals.cur.clicks) * 100) : 0}% of clicks
              </span>
            </div>
            <div className="card stat">
              <span className="stat-label">Average position</span>
              <span className="stat-value">{g.totals.cur.position ?? "–"}</span>
              <span className="stat-sub"><Delta now={g.totals.cur.position} before={g.totals.prev.position} lowerIsBetter label="vs previous 28 days" /> Lower is better</span>
            </div>
          </>
        )}
      </section>
      {g && g.monthly.length > 1 && (
        <section className="card panel">
          <div className="panel-head"><div className="panel-title"><h2>Clicks from Google by month</h2><p className="note">Search Console, last 16 months (the current month is partial).</p></div></div>
          <div className="panel-body">
            <div className="seo-bars" role="img" aria-label="Monthly clicks">
              {g.monthly.map((m) => (
                <div key={m.month} className="seo-bar" title={`${m.month}: ${n(m.clicks)} clicks, ${n(m.impressions)} impressions`}>
                  <span className="seo-bar-val">{n(m.clicks)}</span>
                  <span className="seo-bar-fill" style={{ height: `${Math.max(2, (m.clicks / max) * 100)}%` }} />
                  <span className="seo-bar-label">{new Date(`${m.month}-01`).toLocaleDateString("en-GB", { month: "short" })}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function Table({ title, note, head, rows }: { title: string; note: string; head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return null;
  return (
    <section className="card panel">
      <div className="panel-head"><div className="panel-title"><h2>{title}</h2><p className="note">{note}</p></div></div>
      <div className="panel-body table-wrap">
        <table className="seo-table">
          <thead><tr>{head.map((h, i) => <th key={h} className={i ? "num" : undefined}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num" : undefined}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

const PageLink = ({ url }: { url: string }) => (/^https?:/.test(url) ? <a href={url} target="_blank" rel="noreferrer" className="url">{short(url)}</a> : <span className="url">{url}</span>);

// The opportunities the plan is built on, found with fixed rules from the real data.
function Evidence({ d }: { d: SeoData }) {
  const o = d.opportunities!;
  return (
    <>
      <h2 className="seo-section">The data behind the plan</h2>
      <Table title="Quick wins" note="Search terms ranking 4–15 with real demand. Extra clicks = estimate if the page reached position 3."
        head={["Search term", "Position", "Impressions", "Clicks", "CTR", "Extra clicks"]}
        rows={o.quickWins.map((q) => [<span key="q"><b>{q.query}</b><br /><PageLink url={q.page} /></span>, q.position, n(q.impressions), n(q.clicks), `${q.ctr}%`, `+${n(q.extraClicks)}`])} />
      <Table title="Low click-through rate" note="Page-one pages getting under half the clicks their position normally gets: rewrite the title and meta description."
        head={["Page", "Position", "Impressions", "CTR", "Typical CTR"]}
        rows={o.lowCtr.map((p) => [<span key="p"><PageLink url={p.page} />{p.topQueries.length ? <><br /><span className="note">{p.topQueries.slice(0, 3).join(" · ")}</span></> : null}</span>, p.position, n(p.impressions), `${p.ctr}%`, `${p.expectedCtr}%`])} />
      <Table title="Declining pages" note="Pages that lost 30% or more of their clicks, compared with the previous 28 days or the same period last year."
        head={["Page", "Clicks now", "Before", "Change"]}
        rows={o.decaying.map((p) => [<PageLink key="p" url={p.page} />, n(p.clicks), <span key="b">{n(p.before)} <span className="note">({p.versus})</span></span>, <span key="c" className="delta delta-down">{p.change}%</span>])} />
      <Table title="Pages competing with each other" note="Several of your pages show for the same search term, splitting its clicks."
        head={["Search term", "Impressions", "Pages (position)"]}
        rows={o.cannibal.map((c) => [<b key="q">{c.query}</b>, n(c.impressions), <span key="p" className="seo-pages">{c.pages.map((p) => <span key={p.page}><PageLink url={p.page} /> ({p.position})</span>)}</span>])} />
      <Table title="Searched for, but beyond page 2" note="Real demand where you rank past position 20: improve the page or write a dedicated one."
        head={["Search term", "Position", "Impressions"]}
        rows={o.deepQueries.map((q) => [<span key="q"><b>{q.query}</b><br /><PageLink url={q.page} /></span>, q.position, n(q.impressions)])} />
      <Table title="Pages that convert well but get little traffic" note="GA4 organic landing pages converting above the site average: worth more visibility."
        head={["Page", "Sessions", "Key events", "Conversion rate"]}
        rows={o.converting.map((p) => [<span key="p" className="url">{p.page}</span>, n(p.sessions), n(p.conversions), `${p.rate}%`])} />
      {d.audit && d.audit.issues.length > 0 && (
        <Table title="Site audit problems" note={`From the latest site audit${d.audit.score != null ? ` (health score ${d.audit.score})` : ""}.`}
          head={["Problem", "Severity", "Pages"]}
          rows={d.audit.issues.slice(0, 12).map((i) => [i.title, i.severity, n(i.pages)])} />
      )}
      {d.ai && d.ai.gaps.length > 0 && (
        <Table title="AI visibility gaps" note={`Topics where AI assistants name competitors${d.ai.competitors.length ? ` (${d.ai.competitors.slice(0, 4).join(", ")})` : ""} more than you.`}
          head={["Topic", "Status", "AI search volume"]}
          rows={d.ai.gaps.slice(0, 12).map((g) => [g.topic, g.status === "missing" ? "Not mentioned" : "Behind", g.volume != null ? n(g.volume) : "–"])} />
      )}
    </>
  );
}
