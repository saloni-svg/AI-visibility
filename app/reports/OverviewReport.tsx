import Link from "next/link";
import { loadOverview, PLATFORMS, type Overview } from "@/lib/overview";
import Icon from "../components/Icon";
import OverviewView from "../components/OverviewView";

const TABS = ["performing", "topic-opportunities", "cited-sources", "source-opportunities", "cited-pages"];

// Visibility overview for one domain. Used by the dashboard page and by share links (`shared` =
// read-only: no editing controls, no links into the app).
export default async function OverviewReport({ domain, params, shared = false }: {
  domain: string; params: { run?: string; country?: string; platform?: string; tab?: string; dist?: string }; shared?: boolean;
}) {
  const platform = PLATFORMS.some((p) => p.value === params.platform) ? params.platform! : "all";
  const tab = TABS.includes(params.tab ?? "") ? params.tab! : "performing";
  const dist = params.dist === "pages" ? "pages" : "mentions";

  let data: Overview;
  try {
    data = await loadOverview({ domain, runId: params.run, country: params.country ?? "all", platform });
  } catch (err) {
    return (
      <main className="dash">
        <div className="card empty-state empty-error">
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h2>Couldn&apos;t load data</h2>
          <p className="note">{(err as Error).message ?? String(err)}</p>
          {!shared && (
            <p className="note">
              If it mentions a missing column or table, run <code>supabase/migrations/0002_visibility_overview.sql</code> in the Supabase SQL editor.
            </p>
          )}
        </div>
      </main>
    );
  }

  if (data.state !== "ok") {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="database" size={22} /></span>
          <h2>No results for {domain} yet</h2>
          <p className="note">Run the first check to see how AI assistants talk about this brand.</p>
          {!shared && <Link href={`/analyze?domain=${domain}&force=1`} className="btn-primary btn-link">Analyze {domain}</Link>}
        </div>
      </main>
    );
  }

  const country = data.countryOptions.some((c) => c.code === params.country) ? params.country! : "all";
  return <OverviewView data={data} domain={domain} params={{ country, platform, tab, dist }} platforms={PLATFORMS} shared={shared} />;
}
