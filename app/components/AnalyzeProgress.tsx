"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startAnalysis, stepAnalysis } from "../(dashboard)/actions";
import Icon from "./Icon";

// Runs an analysis step by step and shows progress, then opens the overview.
export default function AnalyzeProgress({ domain, force }: { domain: string; force: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState("Reading the website and writing customer questions");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const start = await startAnalysis(domain, force);
      if ("error" in start) return setError(start.error);
      if ("ready" in start) return router.replace(`/?domain=${start.domain}`);
      setStage("Asking ChatGPT, Gemini and Perplexity");
      for (;;) {
        const step = await stepAnalysis(start.runId);
        if ("error" in step) return setError(step.error);
        setProgress({ done: step.done, total: step.total });
        if (step.status !== "running") break;
      }
      router.replace(`/?domain=${start.domain}`);
    })();
  }, [domain, force, router]);

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 3;

  return (
    <div className="card analyze-card">
      <span className="empty-icon"><Icon name={error ? "alert" : "sparkles"} size={22} /></span>
      <h1>Analyzing {domain}</h1>
      {error ? (
        <>
          <p className="field-error" role="alert">{error}</p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Try again</button>
        </>
      ) : (
        <>
          <p className="note" role="status">{stage}…</p>
          <div className="progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
          <p className="note">{progress ? `${progress.done} of ${progress.total} answers collected` : "This takes 2–4 minutes."}</p>
          <p className="note">Keep this tab open. Results are saved as they arrive.</p>
        </>
      )}
    </div>
  );
}
