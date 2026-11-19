"use client";

import { useState } from "react";
import { createReportLink } from "../(dashboard)/actions";
import type { ShareKind } from "@/lib/share";
import Icon from "./Icon";

// "Export PDF" and "Share link" for a report page.
// PDF: the browser's print dialog ("Save as PDF"), with the app's menus and controls left out and
// the page title used as the file name. `target` = id of one section to print on its own.
// Share link: a read-only link to this report, with the filters now on screen, that opens
// without logging in for 30 days. Hidden on a shared page (`shared`).
export default function ReportActions({ kind, domain, title, target, shared = false, query: extra }: {
  kind: ShareKind; domain: string; title: string; target?: string; shared?: boolean; query?: Record<string, string>;
}) {
  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  function exportPdf() {
    const before = document.title;
    const el = target ? document.getElementById(target) : null;
    document.title = title.replace(/[\\/:*?"<>|]+/g, "-");
    if (el) { document.body.classList.add("print-scope"); el.classList.add("print-target"); }
    const done = () => {
      document.title = before;
      document.body.classList.remove("print-scope");
      el?.classList.remove("print-target");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the link is shown to copy by hand */ }
  }

  async function share() {
    if (link) return copy(link.url);
    setBusy(true);
    setError("");
    const query = { ...Object.fromEntries(new URL(window.location.href).searchParams), ...extra };
    const r = await createReportLink(kind, domain, query);
    setBusy(false);
    if ("error" in r) return setError(r.error);
    const url = new URL(r.path, window.location.origin).toString();
    setLink({ url, expires: r.expires });
    copy(url);
  }

  return (
    <div className="report-actions no-print">
      <div className="report-actions-row">
        <button type="button" className="btn-secondary btn-small" onClick={exportPdf}>
          <Icon name="download" size={13} /> Export PDF
        </button>
        {!shared && (
          <button type="button" className="btn-secondary btn-small" onClick={share} disabled={busy}>
            <Icon name="link" size={13} /> {busy ? "Creating link…" : link ? (copied ? "Copied" : "Copy link") : "Share link"}
          </button>
        )}
      </div>
      {link && (
        <div className="report-link" role="status">
          <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
          <a className="btn-secondary btn-small" href={link.url} target="_blank" rel="noreferrer">Open</a>
          <span className="note">{copied ? "Copied. " : ""}Anyone with this link can view this report (read-only, no login) until {new Date(link.expires).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.</span>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}
