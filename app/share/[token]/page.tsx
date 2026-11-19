import "../../components/app-frame-v5.css";
import type { Metadata } from "next";
import Icon from "../../components/Icon";
import { RyzeMark } from "../../components/BrandMark";
import { readShareToken } from "@/lib/share";
import ChangesReport from "../../reports/ChangesReport";
import CompetitorsReport from "../../reports/CompetitorsReport";
import OverviewReport from "../../reports/OverviewReport";
import PositionsReport from "../../reports/PositionsReport";
import SeoReport from "../../reports/SeoReport";

// A shared, read-only report. Opens without logging in (proxy.ts lets /share/ through); the
// signed link decides which report, domain and filters are shown, and nothing can be changed.
export const dynamic = "force-dynamic";

const NAMES = { overview: "Visibility overview", changes: "Change explainer", competitors: "Competitor research", positions: "Position tracking", seo: "SEO plan" };

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const share = readShareToken((await params).token);
  return {
    title: share ? `${NAMES[share.kind]}: ${share.domain} · RyzeIQ` : "Link expired · RyzeIQ",
    robots: { index: false, follow: false },
  };
}

export default async function SharedReport({ params }: { params: Promise<{ token: string }> }) {
  const share = readShareToken((await params).token);
  if (!share) {
    return (
      <div className="shared-view">
        <main className="dash">
          <div className="card empty-state">
            <span className="empty-icon"><Icon name="lock" size={22} /></span>
            <h2>This link has expired or isn&apos;t valid</h2>
            <p className="note">Ask the person who shared it for a new link.</p>
          </div>
        </main>
      </div>
    );
  }
  const { kind, domain, params: p } = share;
  return (
    <div className="shared-view">
      <header className="shared-bar no-print">
        <RyzeMark size={26} />
        <b className="rz-name">Ryze<span>IQ</span></b>
        <span className="note">Shared {NAMES[kind].toLowerCase()} report · read-only · link valid until {new Date(share.exp).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
      </header>
      {kind === "overview" && <OverviewReport domain={domain} params={p} shared />}
      {kind === "changes" && <ChangesReport domain={domain} params={p} shared />}
      {kind === "competitors" && <CompetitorsReport domain={domain} params={p} shared />}
      {kind === "positions" && <PositionsReport domain={domain} params={p} shared />}
      {kind === "seo" && <SeoReport domain={domain} params={p} shared />}
    </div>
  );
}
