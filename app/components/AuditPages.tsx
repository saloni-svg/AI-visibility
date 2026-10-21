"use client";

import { useMemo, useState } from "react";
import Icon from "./Icon";

type P = { url: string; depth: number; status_code: number | null; response_ms: number | null; word_count: number | null; title: string | null; issues: string[] | null; schema_types: string[] };
const PAGE = 20;

export default function AuditPages({ pages }: { pages: P[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const list = useMemo(() => pages.filter((p) => !q || p.url.toLowerCase().includes(q.toLowerCase())), [pages, q]);
  const total = Math.max(1, Math.ceil(list.length / PAGE));
  const status = (s: number | null) => (s === null ? "not crawled" : s === 0 ? "failed" : String(s));

  return (
    <section className="card cr-table-card">
      <div className="cr-table-head">
        <h2>Crawled pages <span className="muted">({pages.length})</span></h2>
        <div className="cr-search">
          <label htmlFor="au-pq" className="sr-only">Filter pages</label>
          <input id="au-pq" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Filter by URL" />
          <Icon name="search" size={16} />
        </div>
      </div>
      <div className="table-scroll">
        <table className="au-pages">
          <thead><tr><th>Page</th><th className="num">Status</th><th className="num">Depth</th><th className="num">Response</th><th className="num">Words</th><th>Structured data</th><th className="num">Issues</th></tr></thead>
          <tbody>
            {list.slice((page - 1) * PAGE, page * PAGE).map((p) => (
              <tr key={p.url}>
                <td className="au-page-cell">
                  <a href={p.url} target="_blank" rel="noreferrer" className="url">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</a>
                  {p.title && <span className="muted au-page-title">{p.title}</span>}
                </td>
                <td className={`num ${p.status_code && p.status_code < 300 ? "" : "au-bad"}`}>{status(p.status_code)}</td>
                <td className="num">{p.depth >= 99 ? "sitemap" : p.depth}</td>
                <td className="num">{p.response_ms !== null ? `${(p.response_ms / 1000).toFixed(1)}s` : "–"}</td>
                <td className="num">{p.word_count ?? "–"}</td>
                <td className="au-schema">{p.schema_types.slice(0, 3).join(", ") || <span className="muted">none</span>}</td>
                <td className="num">{(p.issues ?? []).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cr-pagination">
        <button type="button" className="btn-secondary btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
        <button type="button" className="btn-dark btn-small" disabled={page >= total} onClick={() => setPage(page + 1)}>Next</button>
        <span>Page {page} of {total}</span>
      </div>
    </section>
  );
}
