import "./tracking.css";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { COUNTRIES, COUNTRY_CODES } from "@/lib/countries";
import { recentPromptReports } from "@/lib/prompt-research";
import { ENGINES, engineReady, knownDomains, listCampaigns, type Engine } from "@/lib/prompt-tracking";
import TrackingHome from "../../components/TrackingHome";

export const dynamic = "force-dynamic";

export default async function TrackingPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const p = await searchParams;
  let setupError: string | null = null;
  const [campaigns, known, research] = await Promise.all([
    listCampaigns().catch((e: Error) => { setupError = e.message; return []; }),
    knownDomains().catch(() => []),
    recentPromptReports(12).catch(() => []),
  ]);
  const countries = COUNTRY_CODES.map((c) => ({ code: c, name: COUNTRIES[c].name, flag: COUNTRIES[c].flag }));
  const ready = Object.fromEntries(ENGINES.map((e) => [e.key, engineReady(e.key)])) as Record<Engine, boolean>;
  return (
    <main className="dash tr-page">
      <TrackingHome campaigns={campaigns} known={known} countries={countries} ready={ready} setupError={setupError}
        research={research.map((r) => ({ topic: r.topic, country: r.country, platform: r.platform, match: r.match }))} initialDomain={p.domain ?? ""} />
    </main>
  );
}
