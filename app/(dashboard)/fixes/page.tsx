import "../agent/agent.css";
import "./fixes.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { findBrand } from "@/lib/brands";
import { cleanDomain } from "@/lib/domain";
import { loadFixes } from "@/lib/rag/fixes";
import { indexStatus } from "@/lib/rag/index";
import FixList from "../../components/FixList";
import Icon from "../../components/Icon";
import RagPanel from "../../components/RagPanel";

export const dynamic = "force-dynamic";

export default async function FixesPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const domain = cleanDomain((await searchParams).domain ?? "");
  if (!domain) redirect("/");
  const brand = await findBrand(domain);
  if (!brand) {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="search" size={22} /></span>
          <h2>Analyze {domain} first</h2>
          <p className="note">Page fixes are written for the questions where AI doesn&apos;t name you.</p>
          <Link href={`/analyze?domain=${domain}`} className="btn-primary btn-link">Analyze {domain}</Link>
        </div>
      </main>
    );
  }
  let status: Awaited<ReturnType<typeof indexStatus>>;
  let fixes: Awaited<ReturnType<typeof loadFixes>>;
  try {
    [status, fixes] = await Promise.all([indexStatus(brand.id), loadFixes(brand.id)]);
  } catch {
    return (
      <main className="dash">
        <div className="card empty-state empty-error">
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h2>Page fixes aren&apos;t set up yet</h2>
          <p className="note">Run <code>supabase/migrations/0004_site_rag.sql</code> in the Supabase SQL editor, then reload.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> Boost &amp; Monitor <span aria-hidden="true">›</span> Page fixes</p>
          <h1>Page fixes: <span className="muted-strong">{domain}</span></h1>
          <p className="subtitle">Exact changes to your existing pages: today&apos;s text, and what to write instead, for each question AI doesn&apos;t name you for.</p>
        </div>
      </header>
      <div className="split-layout">
        <div className="split-side"><RagPanel domain={domain} status={status} /></div>
        <div className="split-main"><FixList domain={domain} fixes={fixes} /></div>
      </div>
    </main>
  );
}
