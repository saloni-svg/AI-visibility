"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startSeoPlan, stepSeoPlan } from "../(dashboard)/actions";
import Icon, { type IconName } from "./Icon";

type LogEntry = { at: string; kind: string; text: string };
const ICONS: Record<string, IconName> = { think: "sparkles", tool: "database", done: "check", error: "alert" };

// Runs the SEO agent stage by stage and shows each step live. Resumes a run that's still going.
export default function SeoRunner({ domain, running, lastError }: {
  domain: string; running: { id: string; log: LogEntry[] } | null; lastError: string | null;
}) {
  const router = useRouter();
  const [focus, setFocus] = useState("");
  const [log, setLog] = useState<LogEntry[]>(running?.log ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resumed = useRef(false);

  async function loop(planId: string) {
    setBusy(true);
    for (;;) {
      const res = await stepSeoPlan(planId);
      if ("error" in res) { setError(res.error); break; }
      setLog(res.log);
      if (res.status !== "running") break;
    }
    setBusy(false);
    router.replace(`/seo?domain=${domain}`, { scroll: false });
    router.refresh();
  }

  useEffect(() => {
    if (running && !resumed.current) { resumed.current = true; loop(running.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await startSeoPlan(domain, focus);
    if ("error" in res) return setError(res.error);
    setLog([{ at: new Date().toISOString(), kind: "think", text: "Reading Google Search Console (Windsor.ai)" }]);
    loop(res.planId);
  }

  return (
    <section className="card agent-card no-print">
      <form onSubmit={start} className="agent-form">
        <div className="agent-form-text">
          <h2>Run the SEO agent</h2>
          <p className="note">Takes 1–3 minutes. Reads Search Console, GA4, rankings, the site audit and AI visibility, then writes a 30/60/90-day plan.</p>
        </div>
        <label htmlFor="seo-focus" className="sr-only">Focus (optional)</label>
        <input id="seo-focus" value={focus} onChange={(e) => setFocus(e.target.value)} disabled={busy}
          placeholder="Optional focus, e.g. “service pages in Ahmedabad” or “blog traffic”" />
        <button type="submit" className="btn-primary btn-link" disabled={busy}>
          <Icon name="sparkles" size={16} /> {busy ? "Working…" : "Create SEO plan"}
        </button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {log.length > 0 && (busy || log[log.length - 1].kind === "error") && (
        <ol className="agent-log" aria-live="polite">
          {log.map((l, i) => (
            <li key={i} className={`agent-log-${l.kind}`}>
              <span className="agent-log-icon"><Icon name={ICONS[l.kind] ?? "sparkles"} size={14} /></span>
              <span>{l.text}</span>
            </li>
          ))}
          {busy && <li className="agent-log-pending"><span className="agent-spinner" aria-hidden="true" /> <span>Working…</span></li>}
        </ol>
      )}
      {!busy && !log.length && lastError && <p className="field-error">Last run failed: {lastError}</p>}
    </section>
  );
}
