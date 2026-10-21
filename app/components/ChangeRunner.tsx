"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { explainChanges } from "../(dashboard)/actions";
import Icon from "./Icon";

// Pick the two checks to compare and run the explanation.
export default function ChangeRunner({ domain, runs, runId, prevId, hasReport }: {
  domain: string; runs: { id: string; label: string }[]; runId: string; prevId: string; hasReport: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "explain" | "retest">("");
  const [error, setError] = useState("");
  const go = (run: string, prev: string) => router.push(`/changes?domain=${domain}&run=${run}&prev=${prev}`);
  const idx = runs.findIndex((r) => r.id === runId);

  async function run(retest: boolean) {
    setBusy(retest ? "retest" : "explain");
    setError("");
    const r = await explainChanges(domain, runId, prevId, retest);
    setBusy("");
    if ("error" in r) return setError(r.error);
    router.refresh();
  }

  return (
    <section className="card ch-runner">
      <div className="ch-pick">
        <label>
          <span className="ch-pick-label">Before</span>
          <select value={prevId} onChange={(e) => go(runId, e.target.value)}>
            {runs.slice(idx + 1).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <span className="ch-arrow" aria-hidden="true"><span>→</span></span>
        <label>
          <span className="ch-pick-label">After</span>
          <select value={runId} onChange={(e) => {
            const i = runs.findIndex((r) => r.id === e.target.value);
            go(e.target.value, runs[i + 1]?.id ?? prevId);
          }}>
            {runs.slice(0, -1).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <div className="ch-actions">
        <button type="button" className="btn-primary btn-link" disabled={!!busy} onClick={() => run(false)}>
          <Icon name="sparkles" size={15} /> {busy === "explain" ? "Comparing…" : hasReport ? "Explain again" : "Explain changes"}
        </button>
        {hasReport && (
          <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => run(true)}
            title="Asks each changed question 3 more times now, to check the change is real">
            {busy === "retest" ? "Re-testing (about a minute)…" : "Re-test changed questions"}
          </button>
        )}
      </div>
      {busy && <p className="note ch-busy">{busy === "retest" ? "Asking the changed questions again, 3 times each…" : "Comparing answers, brands, sources and website snapshots, then writing the explanation…"}</p>}
      {error && <p className="field-error">{error}</p>}
    </section>
  );
}
