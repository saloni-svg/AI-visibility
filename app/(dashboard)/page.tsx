import { loadDashboard, type Dashboard, type Scope } from "@/lib/dashboard";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import DashboardView, { SCOPES } from "../components/DashboardView";
import Icon from "../components/Icon";

// Always read fresh data from Supabase; nothing here is cached at build time.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ run?: string; type?: string }> }) {
  // proxy.ts already redirects signed-out visitors; check again here so the
  // data is never loaded without a signed-in user.
  if (!(await currentUser())) redirect("/login");

  const params = await searchParams;
  const scope: Scope = SCOPES.some((s) => s.value === params.type) ? (params.type as Scope) : "all";

  let data: Dashboard;
  try {
    data = await loadDashboard({ runId: params.run, scope });
  } catch (err) {
    return (
      <main className="dash">
        <div className="card empty-state empty-error">
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h2>Couldn&apos;t load data</h2>
          <p className="note">{(err as Error).message ?? String(err)}</p>
          <p className="note">Check <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> in <code>.env</code>, then reload.</p>
        </div>
      </main>
    );
  }

  if (data.state !== "ok") {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="database" size={22} /></span>
          <h2>{data.state === "no-brand" ? "No brand set up yet" : "No completed runs yet"}</h2>
          <p className="note">
            {data.state === "no-brand"
              ? "Add your brand, competitors and prompts in Supabase (see supabase/seed.sql)."
              : <>Run <code>npm run track</code> to collect answers, then reload this page.</>}
          </p>
        </div>
      </main>
    );
  }

  return <DashboardView data={data} />;
}
