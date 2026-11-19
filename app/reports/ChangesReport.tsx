import "../(dashboard)/changes/changes.css";
import Link from "next/link";
import { findBrand } from "@/lib/brands";
import { listRuns, loadExplanation } from "@/lib/change-explainer";
import ChangeExplainer from "../components/ChangeExplainer";
import ChangeRunner from "../components/ChangeRunner";
import Icon from "../components/Icon";
import ReportActions from "../components/ReportActions";

// Change explainer for one domain: why AI visibility moved between two checks. Used by the
// dashboard page and by share links (`shared` = read-only, no check picker or re-run buttons).
export default async function ChangesReport({ domain, params, shared = false }: {
  domain: string; params: { run?: string; prev?: string }; shared?: boolean;
}) {
  const brand = await findBrand(domain);
  const runs = brand ? await listRuns(brand.id) : [];
  if (!brand || runs.length < 2) {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="trend" size={22} /></span>
          <h2>{brand ? "Run at least two checks to compare" : `Analyze ${domain} first`}</h2>
          <p className="note">The change explainer compares two visibility checks and explains what changed and why.</p>
          {!shared && <Link href={`/analyze?domain=${domain}${brand ? "&refresh=1" : ""}`} className="btn-primary btn-link">{brand ? "Run a new check" : `Analyze ${domain}`}</Link>}
        </div>
      </main>
    );
  }
  const run = runs.find((r) => r.id === params.run) ?? runs[0];
  const later = runs.filter((r) => r.at < run.at);
  const prev = later.find((r) => r.id === params.prev) ?? later[0] ?? runs[1];
  const report = await loadExplanation(run.id, prev.id).catch(() => null);

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> AI Analysis <span aria-hidden="true">›</span> Change explainer</p>
          <h1>What changed: <span className="muted-strong">{domain}</span></h1>
          <p className="subtitle">Why AI visibility moved between two checks, with the evidence behind every conclusion.</p>
          {shared && <p className="note shared-filters">Comparing the check of <b>{run.label}</b> with <b>{prev.label}</b></p>}
        </div>
        {report && (
          <div className="header-actions">
            <ReportActions kind="changes" domain={domain} shared={shared} title={`What changed - ${domain} - ${prev.label} to ${run.label}`} />
          </div>
        )}
      </header>
      {!shared && <ChangeRunner domain={domain} runs={runs.map((r) => ({ id: r.id, label: r.label }))} runId={run.id} prevId={prev.id} hasReport={!!report} />}
      {report ? <ChangeExplainer domain={domain} report={report} /> : shared && (
        <div className="card empty-state"><h2>This comparison hasn&apos;t been explained yet</h2></div>
      )}
    </main>
  );
}
