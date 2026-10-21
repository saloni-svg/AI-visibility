"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updatePageFix } from "../(dashboard)/actions";

type Fix = {
  id: string; url: string; heading: string | null; question: string; questions: string[] | null; kind: string;
  current_text: string; suggested_text: string; reason: string | null; similarity: number | null; status: string;
};

// An FAQ is written as "Q: ...\nA: ...": show it as a question and its answer.
const asFaq = (text: string) => {
  const m = text.match(/^\s*Q:\s*([\s\S]+?)\n+\s*A:\s*([\s\S]+)$/);
  return m ? { q: m[1].trim(), a: m[2].trim() } : null;
};

// Fixes grouped by page: today's text next to the suggested text.
export default function FixList({ domain, fixes }: { domain: string; fixes: Fix[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"todo" | "done" | "dismissed">("todo");
  const [copied, setCopied] = useState<string | null>(null);
  const [, start] = useTransition();
  const list = fixes.filter((f) => f.status === filter);
  const pages = [...new Set(list.map((f) => f.url))];
  const count = (s: string) => fixes.filter((f) => f.status === s).length;
  const todoPages = new Set(fixes.filter((f) => f.status === "todo").map((f) => f.url)).size;

  const setStatus = (id: string, status: "todo" | "done" | "dismissed") =>
    start(async () => {
      await updatePageFix(domain, id, status);
      router.refresh();
    });
  const copy = async (f: Fix) => {
    const faq = asFaq(f.suggested_text);
    await navigator.clipboard.writeText(faq ? `${faq.q}\n\n${faq.a}` : f.suggested_text);
    setCopied(f.id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <section className="card cr-table-card">
      <div className="cr-table-head">
        <h2>Fixes <span className="muted">({count("todo")} to do, on {todoPages} {todoPages === 1 ? "page" : "pages"})</span></h2>
        <div className="seg" role="group" aria-label="Show">
          <button aria-pressed={filter === "todo"} onClick={() => setFilter("todo")}>To do <span>{count("todo")}</span></button>
          <button aria-pressed={filter === "done"} onClick={() => setFilter("done")}>Done <span>{count("done")}</span></button>
          <button aria-pressed={filter === "dismissed"} onClick={() => setFilter("dismissed")}>Dismissed <span>{count("dismissed")}</span></button>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="note cr-empty">{filter === "todo" ? "No fixes yet. Index your site, then press Find exact fixes." : "Nothing here yet."}</p>
      ) : (
        pages.map((url) => (
          <div key={url} className="fix-page">
            <h3 className="fix-page-url">
              <a href={url} target="_blank" rel="noreferrer" className="url">{url.replace(/^https?:\/\/(www\.)?/, "")}</a>
              <span className="muted">{list.filter((f) => f.url === url).length} {list.filter((f) => f.url === url).length === 1 ? "fix" : "fixes"}</span>
            </h3>
            {list.filter((f) => f.url === url).map((f) => (
              <article key={f.id} className="fix">
                <div className="fix-questions">
                  <span className="pill pill-missing">
                    Helps win {(f.questions?.length || 1) > 1 ? `${f.questions!.length} questions` : ""}
                  </span>
                  <ul>
                    {(f.questions?.length ? f.questions : [f.question]).map((q) => <li key={q}>{q}</li>)}
                  </ul>
                </div>
                {f.reason && <p className="fix-reason">{f.reason}</p>}
                <div className="fix-diff">
                  <div className="fix-before">
                    <span className="fix-label">{f.kind === "rewrite" ? "Today, on your page" : "Find this on your page"}{f.heading ? ` · under “${f.heading}”` : ""}</span>
                    <p>{f.current_text}</p>
                  </div>
                  <div className="fix-after">
                    {asFaq(f.suggested_text) ? (
                      <>
                        <span className="fix-label">Add this FAQ right after it</span>
                        <p className="fix-faq-q">{asFaq(f.suggested_text)!.q}</p>
                        <p>{asFaq(f.suggested_text)!.a}</p>
                      </>
                    ) : (
                      <>
                        <span className="fix-label">{f.kind === "rewrite" ? "Replace with" : "Add right after it"}</span>
                        <p>{f.suggested_text}</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="draft-actions">
                  <button type="button" className="btn-secondary btn-small" onClick={() => copy(f)}>{copied === f.id ? "Copied" : "Copy new text"}</button>
                  {f.status !== "done" && <button type="button" className="btn-dark btn-small" onClick={() => setStatus(f.id, "done")}>Mark done</button>}
                  {f.status !== "dismissed" && <button type="button" className="link-btn" onClick={() => setStatus(f.id, "dismissed")}>Dismiss</button>}
                  {f.status !== "todo" && <button type="button" className="link-btn" onClick={() => setStatus(f.id, "todo")}>Move to To do</button>}
                  {f.similarity !== null && <span className="note fix-match">{Math.round(f.similarity * 100)}% match to the question</span>}
                </div>
              </article>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
