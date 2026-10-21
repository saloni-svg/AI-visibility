import "./reviews.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { findBrand } from "@/lib/brands";
import { cleanDomain } from "@/lib/domain";
import { loadReviews } from "@/lib/reviews";
import Icon from "../../components/Icon";
import ReviewsApp from "../../components/ReviewsApp";

export const dynamic = "force-dynamic";

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const domain = cleanDomain((await searchParams).domain ?? "");
  if (!domain) redirect("/");
  const brand = await findBrand(domain);
  if (!brand) {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="users" size={22} /></span>
          <h2>Analyze {domain} first</h2>
          <Link href={`/analyze?domain=${domain}`} className="btn-primary btn-link">Analyze {domain}</Link>
        </div>
      </main>
    );
  }
  let data: Awaited<ReturnType<typeof loadReviews>>;
  try {
    data = await loadReviews(brand.id);
  } catch {
    return (
      <main className="dash">
        <div className="card empty-state empty-error">
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h2>Review management isn&apos;t set up yet</h2>
          <p className="note">Run <code>supabase/migrations/0007_reviews.sql</code> in the Supabase SQL editor, then reload.</p>
        </div>
      </main>
    );
  }
  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> Boost &amp; Monitor <span aria-hidden="true">›</span> Review management</p>
          <h1>Review management: <span className="muted-strong">{domain}</span></h1>
          <p className="subtitle">All Google reviews for this business in one place, with AI-drafted replies.</p>
        </div>
      </header>
      <ReviewsApp domain={domain} source={data.source} reviews={data.reviews} />
    </main>
  );
}
