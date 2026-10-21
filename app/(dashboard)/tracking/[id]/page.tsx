import "../tracking.css";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { COUNTRIES, COUNTRY_CODES } from "@/lib/countries";
import { recentPromptReports } from "@/lib/prompt-research";
import { ENGINES, engineReady, listCampaigns, listPrompts, loadTracking, type Engine } from "@/lib/prompt-tracking";
import TrackingDashboard from "../../../components/TrackingDashboard";

export const dynamic = "force-dynamic";

export default async function TrackingCampaignPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ engine?: string; run?: string; start?: string }>;
}) {
  if (!(await currentUser())) redirect("/login");
  const { id } = await params;
  const sp = await searchParams;
  const data = await loadTracking(id, { engine: sp.engine, runId: sp.run });
  if (!data) notFound();
  const [campaigns, prompts, research] = await Promise.all([listCampaigns(), listPrompts(id), recentPromptReports(12).catch(() => [])]);
  const countries = COUNTRY_CODES.map((c) => ({ code: c, name: COUNTRIES[c].name, flag: COUNTRIES[c].flag }));
  const ready = Object.fromEntries(ENGINES.map((e) => [e.key, engineReady(e.key)])) as Record<Engine, boolean>;
  return (
    <main className="dash tr-page">
      <TrackingDashboard data={data} campaigns={campaigns} prompts={prompts} countries={countries} ready={ready} autoStart={sp.start === "1"}
        research={research.map((r) => ({ topic: r.topic, country: r.country, platform: r.platform, match: r.match }))} />
    </main>
  );
}
