import "./prompts.css";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { COUNTRIES, COUNTRY_CODES, isCountry, type CountryCode } from "@/lib/countries";
import { cleanTopic, getPromptReport, isMatch, isPlatformFilter, isStale, recentPromptReports, type Match, type PlatformFilter } from "@/lib/prompt-research";
import PromptSearch from "../../components/PromptSearch";
import PromptReportView from "../../components/PromptReportView";

export const dynamic = "force-dynamic";

export default async function PromptsPage({ searchParams }: { searchParams: Promise<{ q?: string; country?: string; platform?: string; match?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const p = await searchParams;
  const q = cleanTopic(p.q ?? "");
  const country: CountryCode = isCountry(p.country) ? p.country : "US";
  const platform: PlatformFilter = isPlatformFilter(p.platform) ? p.platform : "all";
  const match: Match = isMatch(p.match) ? p.match : "broad";
  const [recent, report] = await Promise.all([
    recentPromptReports().catch(() => []),
    q ? getPromptReport(q, country, platform, match).catch(() => null) : Promise.resolve(null),
  ]);
  const countries = COUNTRY_CODES.map((c) => ({ code: c, name: COUNTRIES[c].name, flag: COUNTRIES[c].flag }));
  const recentLinks = recent.map((r) => ({ topic: r.topic, country: r.country, platform: r.platform, match: r.match }));

  // First page: no topic yet.
  if (!q) {
    return (
      <main className="dash pr-page">
        <PromptSearch variant="hero" q="" country={country} platform={platform} match={match} countries={countries} recent={recentLinks} autoRun={false} />
      </main>
    );
  }

  return (
    <main className="dash pr-page">
      <PromptSearch key={`${q}|${country}|${platform}|${match}`} variant="bar" q={q} country={country} platform={platform} match={match} countries={countries} recent={recentLinks} autoRun={!report} />
      {report && <PromptReportView report={report} stale={isStale(report)} countries={countries} />}
    </main>
  );
}
