"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createAuditProject } from "../(dashboard)/actions";
import Icon from "./Icon";

type Scores = Record<string, number | null>;
type Project = {
  id: string; name: string; domain: string; running: boolean;
  latest: { at: string; pages: number; limit: number; scores: Scores; counts: Record<string, number> } | null;
  previous: { scores: Scores; counts: Record<string, number> } | null;
};

const COLS: { key: string; label: string; ai?: boolean; empty?: string }[] = [
  { key: "siteHealth", label: "Site Health" },
  { key: "aiHealth", label: "AI Search Health", ai: true },
  { key: "errors", label: "Errors" },
  { key: "warnings", label: "Warnings" },
  { key: "crawlability", label: "Crawlability" },
  { key: "https", label: "HTTPS" },
  { key: "international", label: "Int. SEO", empty: "Not implemented" },
  { key: "performance", label: "Site Performance" },
  { key: "linking", label: "Internal Linking" },
  { key: "markup", label: "Markups" },
  { key: "cwv", label: "Core Web Vitals", empty: "Not measured" },
];
const PAGE = 10;

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function AuditProjects({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const list = useMemo(() => projects.filter((p) => !q || `${p.name} ${p.domain}`.toLowerCase().includes(q.toLowerCase())), [projects, q]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const shown = list.slice((page - 1) * PAGE, page * PAGE);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const r = await createAuditProject(domain);
    if ("error" in r) return setError(r.error);
    router.push(`/audit/site?domain=${r.domain}&start=1`);
  }

  const value = (p: Project, key: string) => {
    if (!p.latest) return null;
    const isCount = key === "errors" || key === "warnings";
    const now = isCount ? p.latest.counts[key] : p.latest.scores[key];
    const before = p.previous ? (isCount ? p.previous.counts[key] : p.previous.scores[key]) : null;
    return { now, change: now !== null && before !== null && before !== undefined ? now - before : null, isCount };
  };

  return (
    <section className="card cr-table-card">
      <div className="au-toolbar">
        <div className="cr-search">
          <label htmlFor="au-q" className="sr-only">Search projects</label>
          <input id="au-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Project name or domain" />
          <Icon name="search" size={16} />
        </div>
        {adding ? (
          <form onSubmit={create} className="au-create">
            <label htmlFor="au-domain" className="sr-only">Domain</label>
            <input id="au-domain" autoFocus value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
            <button type="submit" className="btn-dark btn-small">Start audit</button>
            <button type="button" className="link-btn" onClick={() => setAdding(false)}>Cancel</button>
          </form>
        ) : (
          <button type="button" className="btn-dark" onClick={() => setAdding(true)}>+ Create project</button>
        )}
      </div>
      {error && <p className="field-error au-error">{error}</p>}
      <div className="table-scroll">
        <table className="au-table">
          <thead>
            <tr>
              <th className="au-sticky">Project</th>
              <th>Last update</th>
              <th className="num">Pages crawled</th>
              {COLS.map((c) => <th key={c.key} className="num">{c.ai && <Icon name="sparkles" size={13} />} {c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td className="au-sticky">
                  {p.latest ? <Link href={`/audit/site?domain=${p.domain}`} className="au-name">{p.name}</Link> : <span className="au-name plain">{p.name}</span>}
                  <span className="au-domain">{p.domain}</span>
                </td>
                {p.latest ? (
                  <>
                    <td>{p.running ? <span className="pill pill-shared">Running…</span> : ago(p.latest.at)}</td>
                    <td className="num">
                      {p.latest.pages >= p.latest.limit && <span title="Reached the page limit: some pages weren't checked" aria-label="Page limit reached">⚠️ </span>}
                      <b>{p.latest.pages}</b><span className="muted">/{p.latest.limit}</span>
                    </td>
                    {COLS.map((c) => {
                      const v = value(p, c.key)!;
                      if (v.now === null) return <td key={c.key} className="num muted">{c.empty ?? "–"}</td>;
                      const better = v.change === null ? null : v.isCount ? v.change < 0 : v.change > 0;
                      return (
                        <td key={c.key} className="num">
                          <Link href={`/audit/site?domain=${p.domain}`} className="au-val">{v.now}{v.isCount ? "" : "%"}</Link>
                          <span className={`au-change${v.change ? (better ? " up" : " down") : ""}`}>
                            {v.change === null ? "" : `${v.change > 0 ? "+" : ""}${v.change}${v.isCount ? "" : "%"}`}
                          </span>
                        </td>
                      );
                    })}
                  </>
                ) : (
                  <td colSpan={COLS.length + 2}>
                    {p.running
                      ? <Link href={`/audit/site?domain=${p.domain}`} className="pill pill-shared">Running… view</Link>
                      : <Link href={`/audit/site?domain=${p.domain}&start=1`} className="btn-secondary btn-small">Set up</Link>}
                  </td>
                )}
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={COLS.length + 3} className="muted">No projects match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="cr-pagination">
        <button type="button" className="btn-secondary btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
        <button type="button" className="btn-dark btn-small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        <span>Page {page} of {pages}</span>
      </div>
    </section>
  );
}
