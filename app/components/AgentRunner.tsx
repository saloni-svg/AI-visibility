"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startContentAgent, stepContentAgent } from "../(dashboard)/actions";
import Icon, { type IconName } from "./Icon";

type LogEntry = { at: string; kind: string; text: string };
const ICONS: Record<string, IconName> = { think: "sparkles", tool: "search", draft: "check", done: "check", error: "alert" };

type ReportSection = { heading: string | null; text: string; items: string[] };

// Splits the agent's plain-text report into sections: a block that starts with "Heading:" gets
// that heading; "-", "•" and "1." lines become list items. Markdown marks are dropped.
function parseReport(text: string): ReportSection[] {
  const clean = (s: string) => s.replace(/\*\*|__|^#+\s*/g, "").trim();
  return text.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n").map(clean).filter(Boolean);
    let heading: string | null = null;
    const first = lines[0] ?? "";
    const m = first.match(/^([^:.!?]{3,48}):\s*(.*)$/);
    if (m) {
      heading = m[1];
      if (m[2]) lines[0] = m[2]; else lines.shift();
    }
    const items = lines.filter((l) => /^(\d+[.)]|[-•*])\s+/.test(l)).map((l) => l.replace(/^(\d+[.)]|[-•*])\s+/, ""));
    const prose = lines.filter((l) => !/^(\d+[.)]|[-•*])\s+/.test(l)).join(" ");
    return { heading, text: prose, items };
  }).filter((s) => s.text || s.items.length);
}

// The report as a short lead (first section, clipped) plus one collapsible row per section,
// instead of one long block of text.
function AgentReport({ title, text }: { title: string; text: string }) {
  const [lead, ...rest] = parseReport(text);
  const [full, setFull] = useState(false);
  if (!lead) return null;
  return (
    <div className="agent-report">
      <h3>{title}</h3>
      <div className="agent-report-lead">
        {lead.heading && <span className="agent-report-label">{lead.heading}</span>}
        <p className={full ? "" : "is-clamped"}>{lead.text}</p>
        {lead.text.length > 180 && <button type="button" className="link-btn" onClick={() => setFull(!full)}>{full ? "Show less" : "Read more"}</button>}
        {lead.items.length > 0 && <ul>{lead.items.map((i) => <li key={i}>{i}</li>)}</ul>}
      </div>
      {rest.map((s, n) => (
        <details key={n} className="agent-report-sec">
          <summary>
            <span>{s.heading ?? (n === rest.length - 1 ? "Next steps" : "Details")}</span>
            {s.items.length > 0 && <span className="agent-report-count">{s.items.length}</span>}
            <Icon name="chevron" size={14} />
          </summary>
          {s.text && <p>{s.text}</p>}
          {s.items.length > 0 && <ul>{s.items.map((i) => <li key={i}>{i}</li>)}</ul>}
        </details>
      ))}
    </div>
  );
}

// Starts the agent and shows each step live. Resumes a run that's still going.
export default function AgentRunner({
  domain, running, lastSummary, lastError,
}: {
  domain: string;
  running: { id: string; log: LogEntry[] } | null;
  lastSummary: string | null;
  lastError: string | null;
}) {
  const router = useRouter();
  const [focus, setFocus] = useState("");
  const [log, setLog] = useState<LogEntry[]>(running?.log ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resumed = useRef(false);

  async function loop(runId: string) {
    setBusy(true);
    for (;;) {
      const res = await stepContentAgent(runId);
      if ("error" in res) { setError(res.error); break; }
      setLog(res.log);
      if (res.status !== "running") break;
      router.refresh(); // show new drafts as they're saved
    }
    setBusy(false);
    router.refresh();
  }

  useEffect(() => {
    if (running && !resumed.current) {
      resumed.current = true;
      loop(running.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLog([]);
    const res = await startContentAgent(domain, focus);
    if ("error" in res) return setError(res.error);
    setLog([{ at: new Date().toISOString(), kind: "think", text: "Starting: reading your visibility results" }]);
    loop(res.runId);
  }

  return (
    <section className="card agent-card">
      <form onSubmit={start} className="agent-form">
        <div className="agent-form-text">
          <h2>Run the agent</h2>
          <p className="note">Takes 1–3 minutes. It reads your visibility results and your pages, then writes 3–5 drafts.</p>
        </div>
        <label htmlFor="agent-focus" className="sr-only">Focus (optional)</label>
        <input id="agent-focus" value={focus} onChange={(e) => setFocus(e.target.value)} disabled={busy}
          placeholder="Optional focus, e.g. “SEO services in Ahmedabad” or “only FAQ content”" />
        <button type="submit" className="btn-primary btn-link" disabled={busy}>
          <Icon name="sparkles" size={16} /> {busy ? "Working…" : "Run agent"}
        </button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}

      {log.length > 0 && (
        <ol className="agent-log" aria-live="polite">
          {log.map((l, i) => (
            <li key={i} className={`agent-log-${l.kind}`}>
              <span className="agent-log-icon"><Icon name={ICONS[l.kind] ?? "sparkles"} size={14} /></span>
              <span>{l.text}</span>
            </li>
          ))}
          {busy && <li className="agent-log-pending"><span className="agent-spinner" aria-hidden="true" /> <span>Thinking…</span></li>}
        </ol>
      )}

      {!busy && log.length === 0 && lastSummary && <AgentReport title="Last report" text={lastSummary} />}
      {!busy && log.length > 0 && log[log.length - 1].kind === "done" && lastSummary && <AgentReport title="Report" text={lastSummary} />}
      {!busy && log.length === 0 && !lastSummary && lastError && <p className="field-error">Last run failed: {lastError}</p>}
    </section>
  );
}
