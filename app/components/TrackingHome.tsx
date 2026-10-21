"use client";

import Link from "next/link";
import { useState } from "react";
import { cleanDomain } from "@/lib/domain";
import { ENGINE_LABEL, type Engine } from "@/lib/tracking-shared";
import { fmtDayTime } from "./format";
import PlatformIcon from "./PlatformIcon";
import TrackingSetup from "./TrackingSetup";

type Country = { code: string; name: string; flag: string };
type CampaignCard = {
  id: string; domain: string; brand_name: string; engines: Engine[]; country: string; location: { name: string } | null;
  last_run_at: string | null; prompts: number; visibility: number | null; mentionRate: number | null;
};

// First page of Prompt tracking: pick a domain, then the setup wizard opens.
export default function TrackingHome({ campaigns, known, countries, ready, research, setupError, initialDomain }: {
  campaigns: CampaignCard[]; known: { domain: string; name: string }[]; countries: Country[]; ready: Record<Engine, boolean>;
  research: { topic: string; country: string; platform: string; match: string }[]; setupError: string | null; initialDomain: string;
}) {
  const [value, setValue] = useState(initialDomain);
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState<string | null>(cleanDomain(initialDomain) && initialDomain ? cleanDomain(initialDomain) : null);
  const [error, setError] = useState("");
  const q = value.trim().toLowerCase();
  const matches = known.filter((k) => !q || k.domain.includes(q) || k.name.toLowerCase().includes(q)).slice(0, 8);
  const flag = (c: string) => countries.find((x) => x.code === c)?.flag ?? "🌐";

  function setUp(d: string) {
    const clean = cleanDomain(d);
    if (!clean) return setError("Enter a domain, e.g. example.com.");
    setError(""); setOpen(false); setDomain(clean);
  }

  return (
    <>
      <section className="tr-hero card">
        <div className="tr-hero-glow" aria-hidden="true" />
        <h1>Prompt Tracking</h1>
        <p className="tr-hero-sub">Follow how ChatGPT, Gemini, Perplexity and Google AI Overviews talk about your brand, prompt by prompt.
          See where you&apos;re named, who&apos;s named before you, and which pages AI cites.</p>
        <form className="tr-hero-form" onSubmit={(e) => { e.preventDefault(); setUp(value); }}>
          <div className="tr-hero-input">
            <label htmlFor="tr-domain" className="sr-only">Domain</label>
            <input id="tr-domain" value={value} autoComplete="off" placeholder="Enter domain, e.g. digitalryze.com"
              onChange={(e) => { setValue(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
            {open && matches.length > 0 && (
              <div className="tr-suggest" role="listbox">
                <p>Set up your campaign for:</p>
                {matches.map((k) => (
                  <button key={k.domain} type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => { setValue(k.domain); setUp(k.domain); }}>
                    <span><b>{k.name}</b><small>{k.domain}</small></span><em>Set up</em>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="submit" className="btn-dark tr-hero-go">Set up tracking</button>
        </form>
        {error && <p className="field-error">{error}</p>}
        {setupError && <p className="tr-setup-error">{setupError}</p>}
      </section>

      {campaigns.length > 0 && (
        <section className="card tr-campaigns">
          <div className="tr-campaigns-head"><h2>Your campaigns <span className="muted">{campaigns.length}</span></h2></div>
          <table>
            <thead><tr><th>Domain</th><th>Engines</th><th>Location</th><th className="num">Prompts</th><th className="num">Visibility</th><th className="num">Named in</th><th>Last check</th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/tracking/${c.id}`} className="url"><b>{c.domain}</b></Link><span className="tr-sub">{c.brand_name}</span></td>
                  <td><span className="tr-engine-icons">{c.engines.map((e) => <span key={e} title={ENGINE_LABEL[e]}><PlatformIcon k={e} /></span>)}</span></td>
                  <td>{flag(c.country)} {c.location ? c.location.name.split(",")[0] : c.country}</td>
                  <td className="num">{c.prompts}</td>
                  <td className="num"><b>{c.visibility === null ? "–" : `${c.visibility}%`}</b></td>
                  <td className="num">{c.mentionRate === null ? "–" : `${c.mentionRate}%`}</td>
                  <td className="muted">{c.last_run_at ? fmtDayTime(c.last_run_at) : "Not checked yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card tr-showcase">
        <h2>Every AI answer that mentions your market, in one dashboard</h2>
        <div className="tr-show-grid">
          <div className="tr-show-note tr-show-note-a">
            <b>Know where you stand</b>
            <p>For every prompt: named or not, in which position, and whether your site is linked as a source.</p>
          </div>
          <div className="tr-mock" aria-hidden="true">
            <div className="tr-mock-tabs"><span className="on">Visibility</span><span>Named in</span><span>Avg. position</span><span>Sources</span></div>
            <div className="tr-mock-row tr-mock-head"><span>Prompt</span><span>ChatGPT</span><span>Gemini</span><span>AI Overview</span></div>
            {[
              ["best seo agency for startups", "#1", "#3", "cited"],
              ["top digital marketing companies", "#2", "–", "#4"],
              ["is digitalryze good for seo", "#1", "#1", "#1"],
            ].map((r) => (
              <div key={r[0]} className="tr-mock-row">
                <span className="tr-mock-q">{r[0]}</span>
                {r.slice(1).map((v, i) => <span key={i} className={`tr-pos ${v === "–" ? "none" : v === "cited" ? "cited" : v === "#1" ? "first" : "named"}`}>{v}</span>)}
              </div>
            ))}
            <svg viewBox="0 0 320 90" className="tr-mock-chart">
              <path d="M0 70 L40 64 L80 66 L120 52 L160 55 L200 40 L240 34 L280 26 L320 18" fill="none" stroke="var(--mint, var(--accent))" strokeWidth="2.5" />
              <path d="M0 50 L40 54 L80 48 L120 56 L160 60 L200 58 L240 63 L280 60 L320 66" fill="none" stroke="var(--c3)" strokeWidth="2" strokeDasharray="4 4" />
            </svg>
          </div>
          <div className="tr-show-note tr-show-note-b">
            <b>Beat the brands named before you</b>
            <p>Share of voice against competitors, the sources AI trusts, and which prompts moved since the last check.</p>
          </div>
        </div>
      </section>

      {domain && (
        <TrackingSetup mode="new" domain={domain} countries={countries} ready={ready} research={research} onClose={() => setDomain(null)} />
      )}
    </>
  );
}
