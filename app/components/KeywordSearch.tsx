"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { researchKeyword } from "../(dashboard)/actions";

// Keyword box, country and device. Runs the research when there's no saved result yet.
export default function KeywordSearch({ q, country, device, countries, autoRun }: {
  q: string; country: string; device: string; countries: { code: string; name: string; flag: string }[]; autoRun: boolean;
}) {
  const router = useRouter();
  const [kw, setKw] = useState(q);
  const [c, setC] = useState(country);
  const [d, setD] = useState(device);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ran = useRef(false);

  async function run(keyword: string, ctry: string, dev: string) {
    setBusy(true);
    setError("");
    const r = await researchKeyword(keyword, ctry, dev);
    setBusy(false);
    if ("error" in r) return setError(r.error);
    router.refresh();
  }
  useEffect(() => {
    if (autoRun && !ran.current) { ran.current = true; run(q, country, device); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const k = kw.trim();
    if (!k) return setError("Enter a keyword.");
    // Keep the current website in the URL so the sidebar links keep working.
    const site = new URLSearchParams(window.location.search).get("domain");
    router.push(`/keywords?q=${encodeURIComponent(k.toLowerCase())}&country=${c}&device=${d}${site ? `&domain=${site}` : ""}`);
  }

  return (
    <>
      <form className="kw-search" onSubmit={submit}>
        <label htmlFor="kw-q" className="sr-only">Keyword</label>
        <input id="kw-q" className="kw-search-input" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Enter a keyword, e.g. double glazing swansea" />
        <div className="kw-search-row">
          <label><span className="sr-only">Country</span>
            <select value={c} onChange={(e) => setC(e.target.value)}>
              {countries.map((x) => <option key={x.code} value={x.code}>{x.flag} {x.name}</option>)}
            </select>
          </label>
          <div className="seg" role="group" aria-label="Device">
            <button type="button" aria-pressed={d === "desktop"} onClick={() => setD("desktop")}>Desktop</button>
            <button type="button" aria-pressed={d === "mobile"} onClick={() => setD("mobile")}>Mobile</button>
          </div>
          <button type="submit" className="btn-dark kw-search-go" disabled={busy}>Analyze</button>
        </div>
      </form>
      {busy && (
        <div className="card kw-loading">
          <div className="progress"><span className="kw-indeterminate" /></div>
          <p className="note">Collecting volume, difficulty, intent, keyword ideas and the top 100 Google results… usually 15–30 seconds.</p>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </>
  );
}
