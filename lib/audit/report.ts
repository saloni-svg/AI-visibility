import { db } from "../supabase";
import { siteIssueCodes } from "./crawl";
import { ISSUES, SITE_CHECKS, type Severity } from "./issues";

export type Scores = {
  siteHealth: number; aiHealth: number; crawlability: number | null; https: number | null; international: number | null;
  performance: number | null; linking: number | null; markup: number | null; cwv: number | null;
};
export type Counts = { errors: number; warnings: number; notices: number };
type RunRow = {
  id: string; brand_id: string; status: string; created_at: string; finished_at: string | null;
  pages_crawled: number; page_limit: number; scores: Scores | null; counts: Counts | null; site_checks: Record<string, any>;
};

// Projects list: every brand, with its latest audit and the change since the one before.
export async function listAuditProjects() {
  const [{ data: brands, error }, { data: runs, error: rErr }] = await Promise.all([
    db().from("brands").select("id, name, domain").not("domain", "is", null).order("name"),
    db().from("audit_runs").select("id, brand_id, status, created_at, finished_at, pages_crawled, page_limit, scores, counts")
      .order("created_at", { ascending: false }).limit(1000),
  ]);
  if (error) throw error;
  if (rErr) throw rErr;
  return (brands ?? []).map((b) => {
    const mine = (runs ?? []).filter((r) => r.brand_id === b.id) as RunRow[];
    const done = mine.filter((r) => r.status === "completed");
    return {
      id: b.id, name: b.name, domain: b.domain as string,
      running: mine[0]?.status === "running",
      latest: done[0] ? { at: done[0].finished_at ?? done[0].created_at, pages: done[0].pages_crawled, limit: done[0].page_limit, scores: done[0].scores!, counts: done[0].counts! } : null,
      previous: done[1] ? { scores: done[1].scores!, counts: done[1].counts! } : null,
    };
  }).sort((a, b) => (b.latest ? 1 : 0) - (a.latest ? 1 : 0) || (b.latest?.at ?? "").localeCompare(a.latest?.at ?? "") || a.name.localeCompare(b.name));
}

export type AuditIssue = {
  code: string; title: string; label: string; unit: string; severity: Severity; category: string; ai: boolean;
  why: string; fix: string; pages: string[]; siteWide: boolean; newCount: number | null; trend: number[];
  triggered: boolean; // false = checked and passed (shown in "All checks")
  passed: string | null; // wording for a passed site-wide check
};

export async function loadAudit(brandId: string) {
  const { data: runs, error } = await db().from("audit_runs")
    .select("id, brand_id, status, created_at, finished_at, pages_crawled, page_limit, scores, counts, site_checks, issue_counts")
    .eq("brand_id", brandId).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  const list = (runs ?? []) as (RunRow & { issue_counts: Record<string, number> | null })[];
  const running = list[0]?.status === "running" ? list[0] : null;
  const done = list.filter((r) => r.status === "completed");
  const run = done[0] ?? null;
  if (!run) return { running, run: null };
  const prevRun = done[1] ?? null;

  const select = "url, depth, status_code, redirect_to, response_ms, size_bytes, word_count, title, h1, schema_types, issues, cwv, noindex";
  const [{ data: pageRows, error: pErr }, { data: prevRows }] = await Promise.all([
    db().from("audit_pages").select(select).eq("run_id", run.id).limit(2000),
    prevRun ? db().from("audit_pages").select("url, issues").eq("run_id", prevRun.id).limit(2000) : Promise.resolve({ data: null }),
  ]);
  if (pErr) throw pErr;
  const pages = (pageRows ?? []).sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  const prevIssues = new Map<string, Set<string>>((prevRows ?? []).map((p: any) => [p.url, new Set<string>(p.issues ?? [])]));
  const history = done.slice(0, 8).reverse(); // oldest → newest

  // Group page issues; add site-wide ones.
  const byCode = new Map<string, string[]>();
  for (const p of pages) for (const c of p.issues ?? []) byCode.set(c, [...(byCode.get(c) ?? []), p.url]);
  const siteCodes = siteIssueCodes(run.site_checks);
  const prevSite = prevRun ? new Set(siteIssueCodes(prevRun.site_checks)) : null;
  const make = (code: string, urls: string[], siteWide: boolean, triggered = true): AuditIssue => {
    const info = siteWide ? SITE_CHECKS[code] : ISSUES[code];
    return {
      triggered,
      code, title: info.title, label: info.label, unit: info.unit ?? "pages", severity: info.severity, category: info.category,
      ai: !!info.ai, why: info.why, fix: info.fix, pages: urls, siteWide, passed: info.passed ?? null,
      newCount: siteWide
        ? prevSite ? (prevSite.has(code) ? 0 : 1) : null
        : prevRun ? urls.filter((u) => !prevIssues.get(u)?.has(code)).length : null,
      trend: history.map((h) => h.issue_counts?.[code] ?? 0),
    };
  };
  const order = { error: 0, warning: 1, notice: 2 };
  // Every check: the ones that found problems, then the ones that passed.
  const issues: AuditIssue[] = [
    ...siteCodes.filter((c) => SITE_CHECKS[c]).map((code) => make(code, [], true)),
    ...[...byCode].filter(([c]) => ISSUES[c]).map(([code, urls]) => make(code, urls, false)),
    ...Object.keys(SITE_CHECKS).filter((c) => !siteCodes.includes(c)).map((code) => make(code, [], true, false)),
    ...Object.keys(ISSUES).filter((c) => !byCode.has(c)).map((code) => make(code, [], false, false)),
  ].sort((a, b) => order[a.severity] - order[b.severity] || Number(b.triggered) - Number(a.triggered) || b.pages.length - a.pages.length);

  const hasError = (p: any) => (p.issues ?? []).some((c: string) => ISSUES[c]?.severity === "error");
  const hasAny = (p: any) => (p.issues ?? []).some((c: string) => ISSUES[c] && ISSUES[c].severity !== "notice");
  const status = {
    healthy: pages.filter((p) => p.status_code === 200 && !p.noindex && !hasAny(p)).length,
    broken: pages.filter((p) => p.status_code === 0 || (p.status_code ?? 0) >= 400).length,
    issues: pages.filter((p) => p.status_code === 200 && !p.noindex && hasAny(p)).length,
    redirects: pages.filter((p) => (p.status_code ?? 0) >= 300 && (p.status_code ?? 0) < 400).length,
    blocked: pages.filter((p) => p.noindex || (p.issues ?? []).includes("blocked_by_robots")).length,
    withErrors: pages.filter(hasError).length,
  };

  return {
    running,
    run: {
      id: run.id, at: run.finished_at ?? run.created_at, pages: run.pages_crawled, limit: run.page_limit,
      scores: run.scores!, counts: run.counts!, checks: run.site_checks,
    },
    previous: prevRun ? { scores: prevRun.scores!, counts: prevRun.counts!, pages: prevRun.pages_crawled } : null,
    history: history.map((h) => ({ at: h.finished_at ?? h.created_at, errors: h.counts?.errors ?? 0, warnings: h.counts?.warnings ?? 0, notices: h.counts?.notices ?? 0 })),
    issues,
    pages,
    status,
    cwv: pages.filter((p) => p.cwv).map((p) => ({ url: p.url as string, ...(p.cwv as { lcp: number | null; cls: number | null; inp: number | null; tbt: number | null; source: string; pass: boolean }) })),
  };
}

export type AuditData = Extract<Awaited<ReturnType<typeof loadAudit>>, { issues: unknown }>;
