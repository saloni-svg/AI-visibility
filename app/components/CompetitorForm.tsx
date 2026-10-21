"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateCompetitors } from "../(dashboard)/actions";
import Icon from "./Icon";

export const ENTITY_COLORS = ["var(--you)", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];

// "You" plus four competitor boxes. Accepts domains (shoutnhike.com) or names (ShoutnHike).
export default function CompetitorForm({
  domain,
  initial,
  suggestions,
}: {
  domain: string;
  initial: string[];
  suggestions: { name: string; answers: number }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => [...initial, "", "", "", ""].slice(0, 4));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const set = (i: number, v: string) => setValues((old) => old.map((x, j) => (j === i ? v : x)));

  function save(list: string[]) {
    setError("");
    start(async () => {
      const res = await updateCompetitors(domain, list.filter((v) => v.trim()));
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function add(name: string) {
    const free = values.findIndex((v) => !v.trim());
    if (free === -1) return setError("All four boxes are full. Clear one to add another competitor.");
    set(free, name);
  }

  return (
    <section className="card comp-form-card" aria-label="Competitors to compare">
      <form onSubmit={(e) => { e.preventDefault(); save(values); }} className="comp-form">
        <div className="comp-chip comp-you">
          <span className="dot" style={{ background: ENTITY_COLORS[0] }} />
          <span className="badge badge-you">You</span>
          <span className="comp-chip-text">{domain}</span>
        </div>
        {values.map((v, i) => (
          <div className="comp-chip" key={i}>
            <span className="dot" style={{ background: ENTITY_COLORS[i + 1] }} />
            <label htmlFor={`competitor-${i}`} className="sr-only">Competitor {i + 1}</label>
            <input id={`competitor-${i}`} value={v} onChange={(e) => set(i, e.target.value)} placeholder="Add competitor" autoComplete="off" />
            {v && (
              <button type="button" className="icon-btn" aria-label={`Remove ${v}`} onClick={() => set(i, "")}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        ))}
        <div className="comp-actions">
          <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Comparing…" : "Compare"}</button>
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => { setValues(["", "", "", ""]); save([]); }}>
            Clear
          </button>
        </div>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {suggestions.length > 0 && (
        <div className="suggestions">
          <span className="note">AI also recommends:</span>
          {suggestions.map((s) => (
            <button type="button" key={s.name} className="suggestion" onClick={() => add(s.name)}>
              + {s.name} <span className="muted">{s.answers}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
