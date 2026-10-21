"use client";
import { fmtDayTime } from "./format";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeReport } from "@/lib/change-explainer";
import { snapshotWebsiteNow } from "../(dashboard)/actions";
import Icon from "./Icon";

const CAUSE: Record<string, { label: string; cls: string }> = {
  website_change: { label: "Website change", cls: "pill-shared" },
  ai_results_changed: { label: "AI results changed (no website change)", cls: "pill-weak" },
  competitor_gains: { label: "Competitors gained", cls: "pill-missing" },
  measurement_noise: { label: "Likely normal variation", cls: "pill-unique" },
  mixed: { label: "Several causes", cls: "pill-shared" },
  not_enough_data: { label: "Not enough data", cls: "pill-unique" },
};
const PROVIDER: Record<string, string> = { openai: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", ai_overview: "AI Overview" };
const pct = (r: number) => `${Math.round(r * 100)}%`;
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");

function Verdict({ v, p }: { v: string; p: number | null }) {
  if (v === "too_few") return <span className="pill pill-unique" title="Too few answers for a reliable test">Too few answers</span>;
  return v === "significant"
    ? <span className="pill pill-strong" title={`p = ${p}: unlikely to be chance`}>Real change</span>
    : <span className="pill pill-weak" title={`p = ${p}: could be normal variation between checks`}>Could be noise</span>;
}

function Delta({ before, after }: { before: number; after: number }) {
  const d = Math.round((after - before) * 100);
  return (
    <span className="ch-delta">
      {pct(before)} → <b>{pct(after)}</b>
      {d !== 0 && <span className={`delta ${d > 0 ? "delta-up" : "delta-down"}`}>{d > 0 ? "+" : ""}{d} pts</span>}
    </span>
  );
}

export default function ChangeExplainer({ domain, report: r }: { domain: string; report: ChangeReport }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [snapMsg, setSnapMsg] = useState("");
  const ev = new Map(r.evidence.map((e) => [e.id, e]));
  const ex = r.explanation;
  const gained = r.promptChanges.filter((c) => c.change === "gained");
  const lost = r.promptChanges.filter((c) => c.change === "lost");

  async function snapshot() {
    setSnapping(true);
    const res = await snapshotWebsiteNow(domain);
    setSnapping(false);
    setSnapMsg("error" in res ? res.error : `Saved ${res.pages} pages. Future comparisons can now detect website changes.`);
    router.refresh();
  }

  return (
    <div className="ch-report">
      {/* ---- AI explanation ---- */}
      <section className="card ch-explain">
        <div className="ch-explain-head">
          <h2><Icon name="sparkles" size={16} /> Explanation</h2>
          {ex && <span className={`pill ${CAUSE[ex.likely_cause]?.cls ?? "pill-shared"}`}>Likely cause: {CAUSE[ex.likely_cause]?.label ?? ex.likely_cause}</span>}
        </div>
        {!ex ? <p className="note">The explanation couldn&apos;t be written this time; the facts below are complete. Try “Explain again”.</p> : (
          <>
            <p className="ch-summary">{ex.summary}</p>
            <div className="ch-two">
              <div><p className="ch-q">Did the website change, or the AI results?</p><p>{ex.website_vs_ai}</p></div>
              <div><p className="ch-q">Is the change consistent?</p><p>{ex.consistency}</p></div>
            </div>
            <p className="ch-q">Findings and evidence</p>
            <ul className="ch-findings">
              {ex.findings.map((f, i) => (
                <li key={i}>
                  <span className={`ch-conf ${f.confidence}`}>{f.confidence}</span>
                  <span>
                    {f.claim}{" "}
                    {f.evidence.map((id) => (
                      <a key={id} href={`#ev-${id}`} className="ch-ev" title={ev.get(id)?.text}>{id}</a>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {ex.next_steps.length > 0 && (
              <>
                <p className="ch-q">What to do next</p>
                <ol className="ch-steps">{ex.next_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </>
            )}
          </>
        )}
        <p className="note ch-basis">
          Compared {r.runs.previous.label} → {r.runs.current.label} on {r.compared.pairs} matching question × AI × country pairs. Explained {fmtDayTime(r.createdAt)}.
        </p>
      </section>

      {/* ---- What changed ---- */}
      <section className="card panel">
        <div className="panel-head"><div className="panel-title"><h2>What changed in AI visibility</h2><p className="note">Share of answers that name you. “Real change” = statistically significant (p &lt; 0.05).</p></div></div>
        <div className="table-wrap">
          <table className="ch-table">
            <thead><tr><th>Scope</th><th>Before → after</th><th className="num">Answers</th><th>Verdict</th></tr></thead>
            <tbody>
              <tr><td><b>All questions</b></td><td><Delta before={r.overall.all.before} after={r.overall.all.after} /></td><td className="num">{r.overall.all.nBefore} / {r.overall.all.nAfter}</td><td><Verdict v={r.overall.all.verdict} p={r.overall.all.pValue} /></td></tr>
              <tr><td><b>Unbranded questions</b></td><td><Delta before={r.overall.unbranded.before} after={r.overall.unbranded.after} /></td><td className="num">{r.overall.unbranded.nBefore} / {r.overall.unbranded.nAfter}</td><td><Verdict v={r.overall.unbranded.verdict} p={r.overall.unbranded.pValue} /></td></tr>
              {r.byProvider.map((p) => (
                <tr key={p.provider}><td>{p.label}</td><td><Delta before={p.before} after={p.after} /></td><td className="num">{p.nBefore} / {p.nAfter}</td><td><Verdict v={p.verdict} p={p.pValue} /></td></tr>
              ))}
              {r.byCountry.map((c) => (
                <tr key={c.country}><td>{c.country}</td><td><Delta before={c.before} after={c.after} /></td><td className="num">{c.nBefore} / {c.nAfter}</td><td><Verdict v={c.verdict} p={c.pValue} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Questions ---- */}
      <section className="card panel">
        <div className="panel-head"><div className="panel-title"><h2>Questions that changed</h2><p className="note">{gained.length} now name you · {lost.length} stopped naming you. Click to compare the answers.</p></div></div>
        {r.promptChanges.length === 0 ? <p className="note ch-pad">No question changed between naming and not naming you.</p> : (
          <ul className="ch-qlist">
            {r.promptChanges.map((c) => (
              <li key={c.key}>
                <button type="button" className="ch-qrow" aria-expanded={open === c.key} onClick={() => setOpen(open === c.key ? null : c.key)}>
                  <span className={`pill ${c.change === "gained" ? "pill-strong" : "pill-missing"}`}>{c.change === "gained" ? "Now named" : "Dropped"}</span>
                  <span className="ch-qtext">{c.prompt}</span>
                  <span className="muted">{PROVIDER[c.provider] ?? c.provider} · {c.country}{(c.attemptsBefore > 1 || c.attemptsAfter > 1) ? ` · ${c.consistent ? "consistent" : "mixed attempts"}` : ""}</span>
                  <Icon name="chevron" size={14} />
                </button>
                {open === c.key && (
                  <div className="ch-compare">
                    <div><p className="ch-q">Before · named: {c.brandsBefore.join(", ") || "none"}</p><p className="ch-answer">{c.before}</p></div>
                    <div><p className="ch-q">After · named: {c.brandsAfter.join(", ") || "none"}</p><p className="ch-answer">{c.after}</p></div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Brands & sources ---- */}
      <div className="two-col">
        <section className="card panel">
          <div className="panel-head"><div className="panel-title"><h2>Brands that appeared or disappeared</h2><p className="note">Other businesses named in unbranded answers.</p></div></div>
          <div className="ch-lists">
            <div><p className="ch-q">Appeared</p><ul>{r.brands.appeared.map((b) => <li key={b.name}><span className="ch-name" title={b.name}>{b.name}</span> <span className="muted ch-count">0 → {b.after}</span></li>)}{!r.brands.appeared.length && <li className="muted">None</li>}</ul></div>
            <div><p className="ch-q">Disappeared</p><ul>{r.brands.disappeared.map((b) => <li key={b.name}><span className="ch-name" title={b.name}>{b.name}</span> <span className="muted ch-count">{b.before} → 0</span></li>)}{!r.brands.disappeared.length && <li className="muted">None</li>}</ul></div>
            {(r.brands.rising.length > 0 || r.brands.falling.length > 0) && (
              <div className="ch-wide"><p className="ch-q">Bigger moves</p><ul>
                {r.brands.rising.map((b) => <li key={b.name}><span className="ch-name" title={b.name}>{b.name}</span> <span className="delta delta-down ch-count">{b.before} → {b.after}</span></li>)}
                {r.brands.falling.map((b) => <li key={b.name}><span className="ch-name" title={b.name}>{b.name}</span> <span className="delta delta-up ch-count">{b.before} → {b.after}</span></li>)}
              </ul></div>
            )}
          </div>
        </section>
        <section className="card panel">
          <div className="panel-head"><div className="panel-title"><h2>Cited sources that appeared or disappeared</h2><p className="note">Websites the AIs linked to. Your own: {r.sources.ownCitationsBefore} → {r.sources.ownCitationsAfter} answers.</p></div></div>
          <div className="ch-lists">
            <div><p className="ch-q">Appeared</p><ul>{r.sources.appeared.map((s) => <li key={s.domain}><span className="ch-name" title={s.domain}>{s.domain}</span> <span className="muted ch-count">0 → {s.after}</span></li>)}{!r.sources.appeared.length && <li className="muted">None</li>}</ul></div>
            <div><p className="ch-q">Disappeared</p><ul>{r.sources.disappeared.map((s) => <li key={s.domain}><span className="ch-name" title={s.domain}>{s.domain}</span> <span className="muted ch-count">{s.before} → 0</span></li>)}{!r.sources.disappeared.length && <li className="muted">None</li>}</ul></div>
            {(r.sources.ownPagesGained.length > 0 || r.sources.ownPagesLost.length > 0) && (
              <div className="ch-wide"><p className="ch-q">Your pages</p><ul className="ch-pages-list">
                {r.sources.ownPagesGained.map((u) => <li key={u}><span className="pill pill-strong">cited now</span> <a href={u} target="_blank" rel="noreferrer" className="url ch-name" title={u}>{short(u)}</a></li>)}
                {r.sources.ownPagesLost.map((u) => <li key={u}><span className="pill pill-missing">not cited</span> <a href={u} target="_blank" rel="noreferrer" className="url ch-name" title={u}>{short(u)}</a></li>)}
              </ul></div>
            )}
          </div>
        </section>
      </div>

      {/* ---- Website ---- */}
      <section className="card panel">
        <div className="panel-head"><div className="panel-title"><h2>Did the website change?</h2><p className="note">Saved snapshots of your key pages, compared between the two checks.</p></div></div>
        <div className="ch-pad">
          {!r.website.hasBaseline ? (
            <div className="ch-nobase">
              <p>There&apos;s no saved snapshot of the website from before the earlier check, so website changes can&apos;t be confirmed or ruled out for this period. Pages are now saved automatically after every check.</p>
              <button type="button" className="btn-secondary btn-small" onClick={snapshot} disabled={snapping}>{snapping ? "Saving pages…" : "Save a snapshot now"}</button>
              {snapMsg && <p className="note">{snapMsg}</p>}
            </div>
          ) : r.website.changes.length === 0 ? (
            <p>No changes found on the {r.website.pagesCompared} saved pages between the two checks. <b>The AI results changed without a website update.</b></p>
          ) : (
            <ul className="ch-pages">
              {r.website.changes.map((c) => (
                <li key={c.url}>
                  <p><a href={c.url} target="_blank" rel="noreferrer" className="url">{short(c.url)}</a> <span className="pill pill-shared">{c.kind === "status" ? `status ${c.statusBefore} → ${c.statusAfter}` : c.kind}</span></p>
                  {c.titleBefore !== c.titleAfter && c.kind === "changed" && <p className="note">Title: “{c.titleBefore}” → “{c.titleAfter}”</p>}
                  {c.wordsBefore !== c.wordsAfter && <p className="note">Words: {c.wordsBefore ?? "–"} → {c.wordsAfter ?? "–"}</p>}
                  {c.added.map((s, i) => <p key={`a${i}`} className="ch-added">+ {s}</p>)}
                  {c.removed.map((s, i) => <p key={`r${i}`} className="ch-removed">− {s}</p>)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---- Re-tests ---- */}
      <section className="card panel">
        <div className="panel-head"><div className="panel-title"><h2>Is it consistent? Re-tests</h2><p className="note">Changed questions asked 3 more times. A change is confirmed if the new answers agree with it.</p></div></div>
        {!r.retest ? <p className="note ch-pad">Not re-tested yet. Use “Re-test changed questions” above.</p> : (
          <div className="table-wrap">
            <table className="ch-table">
              <thead><tr><th>Question</th><th>AI</th><th>Expected</th><th className="num">Named you</th><th>Result</th></tr></thead>
              <tbody>
                {r.retest.map((t) => (
                  <tr key={t.key}>
                    <td>{t.prompt}</td><td>{PROVIDER[t.provider] ?? t.provider}</td>
                    <td>{t.expected === "gained" ? "Now named" : "Dropped"}</td>
                    <td className="num">{t.mentioned} / {t.asked}</td>
                    <td>{t.confirms ? <span className="pill pill-strong">Confirmed</span> : <span className="pill pill-weak">Not confirmed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Evidence ---- */}
      <section className="card panel">
        <div className="panel-head"><div className="panel-title"><h2>Evidence</h2><p className="note">Every fact the explanation was allowed to use.</p></div></div>
        <ul className="ch-evidence">
          {r.evidence.map((e) => (
            <li key={e.id} id={`ev-${e.id}`}><b>{e.id}</b> <span className="ch-kind">{e.kind}</span> {e.text}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
