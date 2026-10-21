import "./changes.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { findBrand } from "@/lib/brands";
import { listRuns, loadExplanation } from "@/lib/change-explainer";
import { cleanDomain } from "@/lib/domain";
import ChangeExplainer from "../../components/ChangeExplainer";
import ChangeRunner from "../../components/ChangeRunner";
import Icon from "../../components/Icon";

export const dynamic = "force-dynamic";

export default async function ChangesPage({ searchParams }: { searchParams: Promise<{ domain?: string; run?: string; prev?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const p = await searchParams;
  const domain = cleanDomain(p.domain ?? "");
  if (!domain) redirect("/");
  const brand = await findBrand(domain);
  const runs = brand ? await listRuns(brand.id) : [];
  if (!brand || runs.length < 2) {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="trend" size={22} /></span>
          <h2>{brand ? "Run at least two checks to compare" : `Analyze ${domain} first`}</h2>
          <p className="note">The change explainer compares two visibility checks and explains what changed and why.</p>
          <Link href={`/analyze?domain=${domain}${brand ? "&refresh=1" : ""}`} className="btn-primary btn-link">{brand ? "Run a new check" : `Analyze ${domain}`}</Link>
        </div>
      </main>
    );
  }
  const run = runs.find((r) => r.id === p.run) ?? runs[0];
  const later = runs.filter((r) => r.at < run.at);
  const prev = later.find((r) => r.id === p.prev) ?? later[0] ?? runs[1];
  const report = await loadExplanation(run.id, prev.id).catch(() => null);

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> AI Analysis <span aria-hidden="true">›</span> Change explainer</p>
          <h1>What changed: <span className="muted-strong">{domain}</span></h1>
          <p className="subtitle">Why AI visibility moved between two checks, with the evidence behind every conclusion.</p>
        </div>
      </header>
      <ChangeRunner domain={domain} runs={runs.map((r) => ({ id: r.id, label: r.label }))} runId={run.id} prevId={prev.id} hasReport={!!report} />
      {report && <ChangeExplainer domain={domain} report={report} />}
    </main>
  );
}
