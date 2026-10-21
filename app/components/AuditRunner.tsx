"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { siteAuditStep, startSiteAudit } from "../(dashboard)/actions";
import Icon from "./Icon";

// Starts (or resumes) an audit and shows crawl progress.
export default function AuditRunner({ domain, autoStart, runningId, hasResult }: { domain: string; autoStart: boolean; runningId: string | null; hasResult: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; limit: number; finishing: boolean } | null>(null);
  const [error, setError] = useState("");
  const once = useRef(false);

  async function loop(runId: string) {
    setBusy(true);
    for (;;) {
      const s = await siteAuditStep(runId);
      if ("error" in s) { setError(s.error); break; }
      setProgress({ done: s.done, total: s.total, limit: s.limit, finishing: s.done >= s.total && s.status === "running" });
      if (s.status !== "running") break;
    }
    setBusy(false);
    router.replace(`/audit/site?domain=${domain}`);
    router.refresh();
  }

  async function start() {
    setError("");
    setProgress(null);
    setBusy(true);
    const r = await startSiteAudit(domain);
    if ("error" in r) { setBusy(false); return setError(r.error); }
    loop(r.runId);
  }

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (runningId) loop(runningId);
    else if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // With results and nothing running, the header's Rerun button is enough.
  if (!busy && hasResult && !error) return null;

  return (
    <section className="card au-runner">
      <div>
        <h2>{busy ? "Auditing your site…" : hasResult ? "Run a new audit" : "Audit this site"}</h2>
        <p className="note">
          {busy
            ? progress?.finishing ? "Checking links across pages and measuring Core Web Vitals…" : "Reading pages and following internal links. Keep this tab open."
            : "Crawls up to 100 pages and checks technical SEO and AI-readiness. Takes 1–3 minutes."}
        </p>
        {busy && (
          <>
            <div className="progress"><span style={{ width: `${progress ? Math.max(4, (progress.done / Math.max(1, progress.total)) * 100) : 3}%` }} /></div>
            <p className="note">{progress ? `${progress.done} of ${progress.total} pages checked (limit ${progress.limit})` : "Checking robots.txt, sitemap and HTTPS…"}</p>
          </>
        )}
        {error && <p className="field-error">{error}</p>}
      </div>
      <button type="button" className="btn-primary btn-link" disabled={busy} onClick={start}>
        <Icon name="search" size={16} /> {busy ? "Auditing…" : hasResult ? "Re-run audit" : "Start audit"}
      </button>
    </section>
  );
}
