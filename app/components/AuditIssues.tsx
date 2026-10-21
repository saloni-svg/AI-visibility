"use client";

import { useState } from "react";
import Icon from "./Icon";

type Issue = { code: string; title: string; severity: "error" | "warning" | "notice"; ai: boolean; why: string; fix: string; pages: string[]; siteWide: boolean };
const LABEL = { error: "Errors", warning: "Warnings", notice: "Notices" } as const;

export default function AuditIssues({ issues }: { issues: Issue[] }) {
  const [tab, setTab] = useState<"error" | "warning" | "notice" | "ai">("error");
  const [open, setOpen] = useState<string | null>(null);
  const list = issues.filter((i) => (tab === "ai" ? i.ai : i.severity === tab));
  const count = (t: string) => issues.filter((i) => (t === "ai" ? i.ai : i.severity === t)).length;

  return (
    <section className="card cr-table-card">
      <div className="cr-table-head">
        <h2>Issues</h2>
        <div className="seg" role="group" aria-label="Show">
          {(["error", "warning", "notice"] as const).map((s) => (
            <button key={s} aria-pressed={tab === s} onClick={() => setTab(s)}>{LABEL[s]} <span>{count(s)}</span></button>
          ))}
          <button aria-pressed={tab === "ai"} onClick={() => setTab("ai")}><Icon name="sparkles" size={12} /> AI search <span>{count("ai")}</span></button>
        </div>
      </div>
      {list.length === 0 ? <p className="note cr-empty">No issues here. 🎉</p> : (
        <ul className="au-issues">
          {list.map((i) => (
            <li key={i.code}>
              <button className="au-issue-row" aria-expanded={open === i.code} onClick={() => setOpen(open === i.code ? null : i.code)}>
                <span className={`au-sev ${i.severity}`} aria-hidden="true" />
                <span className="au-issue-title">{i.title}{i.ai && <span className="pill pill-shared au-ai">AI</span>}</span>
                <span className="au-issue-count">{i.siteWide ? "Site-wide" : `${i.pages.length} ${i.pages.length === 1 ? "page" : "pages"}`}</span>
                <Icon name="chevron" size={14} />
              </button>
              {open === i.code && (
                <div className="au-issue-detail">
                  <p><b>Why it matters:</b> {i.why}</p>
                  <p><b>How to fix:</b> {i.fix}</p>
                  {i.pages.length > 0 && (
                    <ul className="au-urls">
                      {i.pages.slice(0, 100).map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer" className="url">{u.replace(/^https?:\/\/(www\.)?/, "")}</a></li>)}
                      {i.pages.length > 100 && <li className="muted">…and {i.pages.length - 100} more</li>}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
