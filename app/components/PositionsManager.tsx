"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addTrackedKeywords, findTrackingLocations, redetectLocation, positionCheckStep, saveTrackingLocation, startPositionCheck, suggestTrackedKeywords } from "../(dashboard)/actions";
import Icon from "./Icon";

// Add keywords (typed or AI-suggested) and run a position check with progress.
type Loc = { code: number; name: string; type?: string; auto?: boolean };

export default function PositionsManager({ domain, country, countryName, keywordCount, location, tracker }: {
  domain: string; country: string; countryName: string; keywordCount: number; location: Loc | null;
  tracker: "keywordcom" | "dataforseo";
}) {
  const kc = tracker === "keywordcom";
  const router = useRouter();
  const [text, setText] = useState("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "add" | "suggest" | "check">("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [maps, setMaps] = useState(true);
  const [ai, setAi] = useState(true);
  const [editLoc, setEditLoc] = useState(false);
  const [locQ, setLocQ] = useState("");
  const [locs, setLocs] = useState<Loc[]>([]);

  async function searchLoc(q: string) {
    setLocQ(q);
    if (q.trim().length < 2) return setLocs([]);
    const r = await findTrackingLocations(domain, country, q);
    if ("error" in r) return setError(r.error);
    setLocs(r.locations);
  }
  async function pickLoc(l: Loc | null) {
    const r = await saveTrackingLocation(domain, country, l ? { code: l.code, name: l.name } : null);
    if ("error" in r) return setError(r.error);
    setEditLoc(false);
    setLocQ("");
    setLocs([]);
    router.refresh();
  }

  async function add(list: string[]) {
    setError("");
    setBusy("add");
    const r = await addTrackedKeywords(domain, country, list);
    setBusy("");
    if ("error" in r) return setError(r.error);
    setText("");
    setIdeas((old) => old.filter((k) => !list.includes(k)));
    router.refresh();
  }

  async function suggest() {
    setError("");
    setBusy("suggest");
    const r = await suggestTrackedKeywords(domain, country);
    setBusy("");
    if ("error" in r) return setError(r.error);
    setIdeas(r.keywords);
  }

  async function check() {
    setError("");
    setBusy("check");
    setInfo("");
    const start = await startPositionCheck(domain, country, kc ? { maps: false, ai: false } : { maps, ai });
    if ("error" in start) { setBusy(""); return setError(start.error); }
    if (start.imported || start.added) {
      setInfo([start.imported ? `${start.imported} keywords imported from Keyword.com` : "", start.added ? `${start.added} keywords added to Keyword.com (first position within a few hours)` : ""].filter(Boolean).join(" · "));
    }
    setProgress({ done: 0, total: start.total });
    for (;;) {
      const s = await positionCheckStep(start.runId);
      if ("error" in s) { setError(s.error); break; }
      setProgress({ done: s.done, total: s.total });
      if (s.status === "no_data") setInfo("Keyword.com hasn't checked these keywords yet, so your previous results are still shown. New keywords usually get their first position within a few hours; check again later.");
      if (s.status !== "running") break;
    }
    setBusy("");
    setProgress(null);
    router.refresh();
  }

  return (
    <section className="card pt-manager">
      <div className="pt-add">
        <label htmlFor="pt-keywords" className="pt-label">Add keywords <span className="muted">· one per line</span></label>
        <textarea id="pt-keywords" rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={!!busy}
          placeholder={"double glazing swansea\nwindow fitters near me"} />
        <div className="pt-add-actions">
          <button type="button" className="btn-secondary btn-small" disabled={!!busy || !text.trim()} onClick={() => add(text.split("\n"))}>
            {busy === "add" ? "Adding…" : "Add keywords"}
          </button>
          <button type="button" className="btn-secondary btn-small" disabled={!!busy} onClick={suggest}>
            <Icon name="sparkles" size={14} /> {busy === "suggest" ? "Thinking…" : "Suggest keywords with AI"}
          </button>
        </div>
        {ideas.length > 0 && (
          <div className="suggestions">
            <span className="note">Click to add:</span>
            {ideas.map((k) => <button key={k} type="button" className="suggestion" onClick={() => add([k])}>+ {k}</button>)}
            <button type="button" className="link-btn" onClick={() => add(ideas)}>Add all</button>
          </div>
        )}
      </div>
      <div className="pt-run">
        <p className="pt-count"><b>{keywordCount}</b> keywords tracked</p>
        <div className="pt-loc">
          <span className="pt-loc-label">Location</span>
          {!editLoc ? (
            <span className="pt-loc-value">
              📍 {location ? location.name.replace(/,/g, ", ") : `${countryName} (whole country)`}
              {location?.auto && <span className="pill pill-shared" title="Found on the website">from website</span>}
              <button type="button" className="link-btn" onClick={() => setEditLoc(true)} disabled={!!busy}>Change</button>
              {!location && (
                <button type="button" className="link-btn" disabled={!!busy}
                  onClick={async () => { const r = await redetectLocation(domain); if ("error" in r) setError(r.error); router.refresh(); }}>
                  Detect from website
                </button>
              )}
            </span>
          ) : (
            <div className="pt-loc-edit">
              <label htmlFor="pt-loc-q" className="sr-only">Search a city</label>
              <input id="pt-loc-q" autoFocus value={locQ} onChange={(e) => searchLoc(e.target.value)} placeholder={`Search a city in ${countryName}, e.g. Swansea`} />
              <ul className="pt-loc-list">
                {locs.map((l) => (
                  <li key={l.code}><button type="button" onClick={() => pickLoc(l)}>{l.name.replace(/,/g, ", ")} <span className="muted">{l.type}</span></button></li>
                ))}
                <li><button type="button" onClick={() => pickLoc(null)}>Whole country ({countryName})</button></li>
              </ul>
              <button type="button" className="link-btn" onClick={() => setEditLoc(false)}>Cancel</button>
            </div>
          )}
          <span className="note">{kc ? "Local businesses: pick the city you serve. Keywords added to Keyword.com are tracked from it." : "Local businesses: pick the city you serve. Google, Maps and AI questions all use it."}</span>
        </div>
        {kc ? (
          <p className="note">Rankings come from <b>Keyword.com</b>, which re-checks every keyword on Google daily. Keywords are kept in sync with your Keyword.com project for {domain}.</p>
        ) : (
        <fieldset className="pt-platforms" disabled={!!busy}>
          <legend>Check rankings on</legend>
          <label className="check-row"><input type="checkbox" checked disabled /> Google + AI Overview</label>
          <label className="check-row"><input type="checkbox" checked={maps} onChange={(e) => setMaps(e.target.checked)} /> Google Maps</label>
          <label className="check-row"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} /> ChatGPT, Gemini, Perplexity</label>
        </fieldset>
        )}
        <button type="button" className="btn-primary btn-link" disabled={!!busy || !keywordCount} onClick={check}>
          <Icon name="search" size={16} /> {busy === "check" ? "Checking…" : "Check positions"}
        </button>
        {progress && (
          <>
            <div className="progress"><span style={{ width: `${Math.max(4, (progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div>
            <p className="note">{progress.done} of {progress.total} keywords checked</p>
          </>
        )}
        <p className="note">
          {kc ? "About 20 seconds per 10 keywords. No per-check cost: Keyword.com's plan covers it." : ai ? "About 1 minute per 10 keywords. ~$0.02 per keyword (AI answers + DataForSEO)." : "About 10 seconds per 10 keywords. ~$0.004 per keyword (DataForSEO)."}
        </p>
      </div>
      {info && <p className="note pt-info">{info}</p>}
      {error && <p className="field-error pt-error" role="alert">{error}</p>}
    </section>
  );
}
