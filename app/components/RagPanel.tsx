"use client";
import { fmtDayTime } from "./format";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pageFixForGroup, searchMySite, siteIndexStep, startPageFixes, startSiteIndex } from "../(dashboard)/actions";
import Icon from "./Icon";

type Status = { total: number; pending: number; failed: number; chunks: number; lastIndexed: string | null };
type Match = { id: string; url: string; heading: string | null; content: string; similarity: number };

const when = (iso: string | null) =>
  iso ? fmtDayTime(iso) : "never";

// Step 1 index the site, step 2 find exact fixes, plus a search box to see retrieval at work.
export default function RagPanel({ domain, status: initial }: { domain: string; status: Status }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [indexing, setIndexing] = useState(false);
  const [fixing, setFixing] = useState<{ done: number; total: number; current: string } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [searching, setSearching] = useState(false);
  const indexed = status.chunks > 0;

  async function index() {
    setError("");
    setIndexing(true);
    const start = await startSiteIndex(domain);
    if ("error" in start) { setError(start.error); setIndexing(false); return; }
    for (;;) {
      const s = await siteIndexStep(domain);
      if ("error" in s) { setError(s.error); break; }
      setStatus(s);
      if (s.pending === 0) break;
    }
    setIndexing(false);
    router.refresh();
  }

  async function findFixes() {
    setError("");
    const start = await startPageFixes(domain);
    if ("error" in start) return setError(start.error);
    const groups = start.groups;
    if (!groups.length) return setError("No questions to fix: AI already names you for every tracked question.");
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const where = g.url.replace(/^https?:\/\/(www\.)?/, "");
      setFixing({ done: i, total: groups.length, current: `${where} (${g.questions.length} ${g.questions.length === 1 ? "question" : "questions"})` });
      const r = await pageFixForGroup(domain, g);
      if ("error" in r) setError(r.error);
      router.refresh();
    }
    setFixing(null);
    router.refresh();
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    const r = await searchMySite(domain, query);
    setSearching(false);
    if ("error" in r) return setError(r.error);
    setMatches(r.matches);
  }

  const indexPct = status.total ? Math.round(((status.total - status.pending) / status.total) * 100) : 0;

  return (
    <section className="rag-grid">
      <div className="card rag-step">
        <span className="step-num">1</span>
        <div className="rag-step-body">
          <h2>Index your site</h2>
          <p className="note">Reads every page in your sitemap, keeps the real paragraphs (not buttons or menus), and stores their meaning so we can find the exact text to change.</p>
          <p className="rag-stats">
            <b>{status.total - status.pending - status.failed}</b> pages · <b>{status.chunks}</b> sections · last indexed {when(status.lastIndexed)}
            {status.failed > 0 && <span className="muted"> · {status.failed} couldn&apos;t be read</span>}
          </p>
          {indexing && (
            <>
              <div className="progress"><span style={{ width: `${Math.max(4, indexPct)}%` }} /></div>
              <p className="note">{status.total - status.pending} of {status.total} pages</p>
            </>
          )}
          <button type="button" className={indexed ? "btn-secondary" : "btn-primary btn-link"} disabled={indexing || !!fixing} onClick={index}>
            {indexing ? "Indexing…" : indexed ? "Re-index site" : "Index site"}
          </button>
        </div>
      </div>

      <div className="card rag-step">
        <span className="step-num">2</span>
        <div className="rag-step-body">
          <h2>Find exact fixes</h2>
          <p className="note">Matches each question where AI doesn&apos;t name you to the best section of your site, then writes one edit per section that covers all its questions.</p>
          {fixing && (
            <>
              <div className="progress"><span style={{ width: `${Math.max(4, (fixing.done / fixing.total) * 100)}%` }} /></div>
              <p className="note">Section {fixing.done + 1} of {fixing.total}: {fixing.current}</p>
            </>
          )}
          <button type="button" className="btn-primary btn-link" disabled={!indexed || indexing || !!fixing} onClick={findFixes}>
            <Icon name="sparkles" size={16} /> {fixing ? "Writing fixes…" : "Find exact fixes"}
          </button>
          {!indexed && <p className="note">Index your site first.</p>}
        </div>
      </div>

      <div className="card rag-search">
        <h2>Search your site by meaning</h2>
        <p className="note">Type a customer question to see which parts of your site AI would find for it.</p>
        <form onSubmit={search} className="rag-search-form">
          <label htmlFor="rag-q" className="sr-only">Question</label>
          <input id="rag-q" value={query} onChange={(e) => setQuery(e.target.value)} disabled={!indexed}
            placeholder="e.g. Which SEO company in Ahmedabad should a small business hire?" />
          <button type="submit" className="btn-secondary" disabled={!indexed || searching || !query.trim()}>{searching ? "Searching…" : "Search"}</button>
        </form>
        {matches && (
          <ol className="rag-matches">
            {matches.length === 0 && <li className="note">No sections found.</li>}
            {matches.map((m) => (
              <li key={m.id}>
                <div className="rag-match-head">
                  <a href={m.url} target="_blank" rel="noreferrer" className="url">{m.url.replace(/^https?:\/\/(www\.)?/, "")}</a>
                  <span className="pill pill-shared">{Math.round(m.similarity * 100)}% match</span>
                </div>
                {m.heading && <p className="rag-match-heading">{m.heading}</p>}
                <p className="rag-match-text">{m.content.slice(0, 320)}{m.content.length > 320 ? "…" : ""}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
      {error && <p className="field-error rag-error" role="alert">{error}</p>}
    </section>
  );
}
