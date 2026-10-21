import "./audit.css";
import { redirect } from "next/navigation";
import { listAuditProjects } from "@/lib/audit/report";
import { currentUser } from "@/lib/auth";
import AuditProjects from "../../components/AuditProjects";
import Icon from "../../components/Icon";

export const dynamic = "force-dynamic";

export default async function AuditListPage() {
  if (!(await currentUser())) redirect("/login");
  let projects: Awaited<ReturnType<typeof listAuditProjects>>;
  try {
    projects = await listAuditProjects();
  } catch {
    return (
      <main className="dash">
        <div className="card empty-state empty-error">
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h2>Site audit isn&apos;t set up yet</h2>
          <p className="note">Run <code>supabase/migrations/0006_site_audit.sql</code> in the Supabase SQL editor, then reload.</p>
        </div>
      </main>
    );
  }
  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> Boost &amp; Monitor <span aria-hidden="true">›</span> Site audit</p>
          <h1>Site audit</h1>
          <p className="subtitle">Technical SEO and AI-readiness checks for every website you track. Up to 100 pages per audit.</p>
        </div>
      </header>
      <AuditProjects projects={projects} />
    </main>
  );
}
