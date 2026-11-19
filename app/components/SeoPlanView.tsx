"use client";

import { useState } from "react";
import { updateSeoAction } from "../(dashboard)/actions";
import type { PlanAction, SeoPlan } from "@/lib/seo-agent";

const CATEGORY: Record<PlanAction["category"], string> = {
  quick_win: "Quick win", ctr: "Click-through rate", content_refresh: "Content refresh", new_content: "New content",
  cannibalisation: "Competing pages", technical: "Technical", conversion: "Conversions", ai_visibility: "AI visibility", local: "Local SEO",
};
const WHEN = { "30": "Days 1–30", "60": "Days 31–60", "90": "Days 61–90" } as const;
const short = (t: string) => t.replace(/^https?:\/\/(www\.)?/, "");

// The written plan: summary, priorities and the actions by month, each with its evidence, steps
// and ready-to-use title/meta/outline. Actions can be ticked off (not on a shared page).
export default function SeoPlanView({ domain, planId, plan, shared = false }: { domain: string; planId: string; plan: SeoPlan; shared?: boolean }) {
  const [actions, setActions] = useState(plan.actions);
  const [when, setWhen] = useState<"all" | "30" | "60" | "90">("all");
  const [error, setError] = useState("");

  async function mark(a: PlanAction, status: "todo" | "done" | "dismissed") {
    setActions((l) => l.map((x) => (x.id === a.id ? { ...x, status } : x)));
    const r = await updateSeoAction(domain, planId, a.id, status);
    if ("error" in r) setError(r.error);
  }

  const live = actions.filter((a) => a.status !== "dismissed");
  const done = live.filter((a) => a.status === "done").length;
  const groups = (["30", "60", "90"] as const).filter((t) => when === "all" || when === t);

  return (
    <>
      <section className="card panel seo-summary">
        <div className="panel-head"><div className="panel-title"><h2>Summary</h2></div></div>
        <div className="panel-body">
          <p>{plan.summary}</p>
          {plan.priorities.length > 0 && (
            <ol className="seo-priorities">{plan.priorities.map((p, i) => <li key={i}>{p}</li>)}</ol>
          )}
          {plan.progress && <p className="note"><b>Since the last plan:</b> {plan.progress}</p>}
        </div>
      </section>

      <section className="card panel">
        <div className="panel-head seo-plan-head">
          <div className="panel-title">
            <h2>Action plan</h2>
            <p className="note">{live.length} actions{done ? ` · ${done} done` : ""}. Most valuable first in each period.</p>
          </div>
          <div className="seg no-print" role="group" aria-label="Period">
            {(["all", "30", "60", "90"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={when === t} onClick={() => setWhen(t)}>{t === "all" ? "All" : WHEN[t]}</button>
            ))}
          </div>
        </div>
        {error && <p className="field-error seo-pad" role="alert">{error}</p>}
        {groups.map((t) => {
          const list = actions.filter((a) => a.timeframe === t && a.status !== "dismissed");
          if (!list.length) return null;
          return (
            <div key={t} className="seo-period">
              <h3>{WHEN[t]}</h3>
              <ol className="seo-actions">
                {list.map((a) => (
                  <li key={a.id} className={`seo-action${a.status === "done" ? " is-done" : ""}`}>
                    <div className="seo-action-head">
                      <div>
                        <h4>{a.title}</h4>
                        <p className="seo-tags">
                          <span className={`pill ${a.priority === "high" ? "pill-missing" : a.priority === "medium" ? "pill-weak" : "pill-shared"}`}>{a.priority} priority</span>
                          <span className="pill pill-shared">{CATEGORY[a.category] ?? a.category}</span>
                          <span className="note">Effort: {a.effort}</span>
                        </p>
                      </div>
                      {!shared && (
                        <div className="seo-action-btns no-print">
                          <button type="button" className={a.status === "done" ? "btn-dark btn-small" : "btn-secondary btn-small"} onClick={() => mark(a, a.status === "done" ? "todo" : "done")}>
                            {a.status === "done" ? "Done ✓" : "Mark done"}
                          </button>
                          <button type="button" className="btn-secondary btn-small" onClick={() => mark(a, "dismissed")} title="Hide this action">Dismiss</button>
                        </div>
                      )}
                    </div>
                    {a.target && a.target !== "site-wide" && (
                      <p className="seo-target">{/^https?:/.test(a.target) ? <a href={a.target} target="_blank" rel="noreferrer" className="url">{short(a.target)}</a> : <b>“{a.target}”</b>}</p>
                    )}
                    <p><b>Why:</b> {a.why}</p>
                    {a.steps.length > 0 && <ol className="seo-steps">{a.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
                    <p className="seo-impact"><b>Expected impact:</b> {a.impact} <span className="note">· Measure: {a.kpi}</span></p>
                    {(a.draft.title || a.draft.meta_description || a.draft.outline.length > 0) && (
                      <div className="seo-draft">
                        {a.draft.title && <p><span className="seo-draft-label">Title</span> {a.draft.title}</p>}
                        {a.draft.meta_description && <p><span className="seo-draft-label">Meta description</span> {a.draft.meta_description}</p>}
                        {a.draft.outline.length > 0 && (
                          <div><span className="seo-draft-label">Outline</span><ul>{a.draft.outline.map((h, i) => <li key={i}>{h}</li>)}</ul></div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </section>
    </>
  );
}
