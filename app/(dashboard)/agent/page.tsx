import "./agent.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadAgentPage } from "@/lib/agent/run";
import { currentUser } from "@/lib/auth";
import { findBrand } from "@/lib/brands";
import { cleanDomain } from "@/lib/domain";
import AgentRunner from "../../components/AgentRunner";
import DraftList from "../../components/DraftList";
import Icon from "../../components/Icon";

export const dynamic = "force-dynamic";

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const domain = cleanDomain((await searchParams).domain ?? "");
  if (!domain) redirect("/");
  const brand = await findBrand(domain);
  if (!brand) {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="sparkles" size={22} /></span>
          <h2>Analyze {domain} first</h2>
          <p className="note">The agent works from your visibility results.</p>
          <Link href={`/analyze?domain=${domain}`} className="btn-primary btn-link">Analyze {domain}</Link>
        </div>
      </main>
    );
  }
  let data: Awaited<ReturnType<typeof loadAgentPage>>;
  try {
    data = await loadAgentPage(brand.id);
  } catch {
    return (
      <main className="dash">
        <div className="card empty-state empty-error">
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h2>The content agent isn&apos;t set up yet</h2>
          <p className="note">Run <code>supabase/migrations/0003_content_agent.sql</code> in the Supabase SQL editor, then reload.</p>
        </div>
      </main>
    );
  }
  const lastRun = data.runs[0] ?? null;

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> Boost &amp; Monitor <span aria-hidden="true">›</span> Content agent</p>
          <h1>Content agent: <span className="muted-strong">{domain}</span></h1>
          <p className="subtitle">Checks your site, finds where AI recommends others instead of you, and drafts the content to fix it.</p>
        </div>
      </header>

      <div className="split-layout">
      <div className="split-side">
      <AgentRunner
        domain={domain}
        running={lastRun?.status === "running" ? { id: lastRun.id, log: lastRun.log } : null}
        lastSummary={lastRun?.status === "completed" ? lastRun.summary : null}
        lastError={lastRun?.status === "failed" ? lastRun.error : null}
      />
      </div>
      <div className="split-main">
      <DraftList domain={domain} drafts={data.drafts} />
      </div>
      </div>
    </main>
  );
}
