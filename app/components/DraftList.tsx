"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateDraft } from "../(dashboard)/actions";
import Icon from "./Icon";

type Draft = {
  id: string; kind: string; title: string; target_url: string | null; target_questions: string[];
  reason: string | null; content: string; status: string; created_at: string;
};
const KIND: Record<string, string> = {
  new_page: "New page", page_update: "Page update", faq: "FAQ", schema: "Structured data",
  ai_access: "AI access", listing_pitch: "Listing pitch",
};

export default function DraftList({ domain, drafts }: { domain: string; drafts: Draft[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"draft" | "done" | "dismissed">("draft");
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [, start] = useTransition();
  const list = drafts.filter((d) => d.status === filter);
  const count = (s: string) => drafts.filter((d) => d.status === s).length;

  const setStatus = (id: string, status: "draft" | "done" | "dismissed") =>
    start(async () => {
      await updateDraft(domain, id, status);
      router.refresh();
    });
  const copy = async (d: Draft) => {
    await navigator.clipboard.writeText(d.content);
    setCopied(d.id);
    setTimeout(() => setCopied(null), 1500);
  };
  const download = (d: Draft) => {
    const ext = d.kind === "schema" ? "json" : d.kind === "ai_access" ? "txt" : "md";
    const url = URL.createObjectURL(new Blob([d.content], { type: "text/plain" }));
    Object.assign(document.createElement("a"), { href: url, download: `${d.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${ext}` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card cr-table-card">
      <div className="cr-table-head">
        <h2>Drafts <span className="muted">({drafts.length})</span></h2>
        <div className="seg" role="group" aria-label="Show">
          <button aria-pressed={filter === "draft"} onClick={() => setFilter("draft")}>To do <span>{count("draft")}</span></button>
          <button aria-pressed={filter === "done"} onClick={() => setFilter("done")}>Published <span>{count("done")}</span></button>
          <button aria-pressed={filter === "dismissed"} onClick={() => setFilter("dismissed")}>Dismissed <span>{count("dismissed")}</span></button>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="note cr-empty">{filter === "draft" ? "No drafts yet. Run the agent to get content ideas written for you." : "Nothing here yet."}</p>
      ) : (
        <ul className="drafts">
          {list.map((d) => (
            <li key={d.id} className="draft">
              <div className="draft-head">
                <span className="pill pill-shared">{KIND[d.kind] ?? d.kind}</span>
                <h3>{d.title}</h3>
              </div>
              {d.reason && <p className="draft-reason">{d.reason}</p>}
              <div className="draft-meta">
                {d.target_url && <span><b>Page:</b> {d.target_url}</span>}
                {d.target_questions.length > 0 && <span><b>Helps win:</b> {d.target_questions.join(" · ")}</span>}
              </div>
              {open === d.id && <pre className="draft-content">{d.content}</pre>}
              <div className="draft-actions">
                <button type="button" className="btn-secondary btn-small" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  {open === d.id ? "Hide draft" : "View draft"}
                </button>
                <button type="button" className="btn-secondary btn-small" onClick={() => copy(d)}>{copied === d.id ? "Copied" : "Copy"}</button>
                <button type="button" className="btn-secondary btn-small" onClick={() => download(d)}><Icon name="download" size={14} /> Download</button>
                {d.status !== "done" && <button type="button" className="btn-dark btn-small" onClick={() => setStatus(d.id, "done")}>Mark published</button>}
                {d.status !== "dismissed" && <button type="button" className="link-btn" onClick={() => setStatus(d.id, "dismissed")}>Dismiss</button>}
                {d.status !== "draft" && <button type="button" className="link-btn" onClick={() => setStatus(d.id, "draft")}>Move to To do</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
