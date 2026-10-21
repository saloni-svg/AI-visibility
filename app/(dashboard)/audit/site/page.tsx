import "../audit.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listAuditProjects, loadAudit, type AuditData } from "@/lib/audit/report";
import { currentUser } from "@/lib/auth";
import { findBrand } from "@/lib/brands";
import { cleanDomain } from "@/lib/domain";
import AuditProjectSwitch from "../../../components/AuditProjectSwitch";
import AuditReport from "../../../components/AuditReport";
import AuditRunner from "../../../components/AuditRunner";
import Icon from "../../../components/Icon";

export const dynamic = "force-dynamic";

export default async function AuditSitePage({ searchParams }: { searchParams: Promise<{ domain?: string; start?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const params = await searchParams;
  const domain = cleanDomain(params.domain ?? "");
  if (!domain) redirect("/audit");
  const brand = await findBrand(domain);
  if (!brand) redirect("/audit");
  const [data, projects] = await Promise.all([loadAudit(brand.id), listAuditProjects()]);
  const r = data.run;
  const audited = projects.filter((p) => p.latest || p.domain === domain).map((p) => ({ name: p.name, domain: p.domain }));

  return (
    <main className="dash au-page">
      <header className="au-head">
        <p className="crumbs"><Link href="/">Home</Link> <span aria-hidden="true">›</span> <Link href="/audit">Site audit</Link> <span aria-hidden="true">›</span> {brand.name}</p>
        <div className="au-head-row">
          <h1>Site Audit: <AuditProjectSwitch current={domain} projects={audited} /></h1>
          <Link href={`/audit/site?domain=${domain}&start=1`} className="btn-dark"><Icon name="trend" size={15} /> {r ? "Rerun audit" : "Start audit"}</Link>
        </div>
        {r && (
          <p className="au-meta">
            <a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain}</a>
            <span>Updated: {new Date(r.at).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            <span>Desktop</span>
            <span>JS rendering: Disabled</span>
            <span>Pages crawled: {r.pages}/{r.limit}</span>
          </p>
        )}
      </header>

      <AuditRunner key={params.start === "1" ? "start" : "idle"} domain={domain} autoStart={params.start === "1"} runningId={data.running?.id ?? null} hasResult={!!r} />

      {r && "issues" in data && <AuditReport data={data as AuditData} domain={domain} />}
    </main>
  );
}
