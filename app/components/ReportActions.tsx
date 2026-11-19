"use client";

import { useState } from "react";
import { createReportLink } from "../(dashboard)/actions";
import type { ShareKind } from "@/lib/share";
import Icon from "./Icon";

// "Export PDF" and "Share link" for a report page.
// PDF: a designed report document (cover page, sections, charts, tables; lib/pdf), built on the
// server with the filters now on screen and downloaded as a .pdf file. On a shared page it comes
// from the share link. `title` is only a fallback file name.
// Share link: a read-only link to this report, with the filters now on screen, that opens
// without logging in for 30 days. Hidden on a shared page (`shared`).
export default function ReportActions({ kind, domain, title, shared = false, query: extra }: {
  kind: ShareKind; domain: string; title: string; target?: string; shared?: boolean; query?: Record<string, string>;
}) {
  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function exportPdf() {
    setPdfBusy(true);
    setError("");
    try {
      const query = { ...Object.fromEntries(new URL(window.location.href).searchParams), ...extra, kind, domain };
      const url = shared ? `${window.location.pathname.replace(/\/$/, "")}/pdf` : `/report/pdf?${new URLSearchParams(query)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${title.replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;
      const href = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      setError((e as Error).message.slice(0, 300));
    } finally {
      setPdfBusy(false);
    }
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
        <button type="button" className="btn-secondary btn-small" onClick={exportPdf} disabled={pdfBusy}>
          <Icon name="download" size={13} /> {pdfBusy ? "Creating PDF…" : "Export PDF"}
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
