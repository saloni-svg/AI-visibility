import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadCompetitorReport } from "@/lib/competitors";
import { cleanDomain } from "@/lib/domain";
import CompetitorChart from "../../components/CompetitorChart";
import CompetitorForm, { ENTITY_COLORS } from "../../components/CompetitorForm";
import CompetitorTable from "../../components/CompetitorTable";
import CountriesEditor from "../../components/CountriesEditor";
import { COUNTRIES, COUNTRY_CODES } from "@/lib/countries";
import Icon from "../../components/Icon";
import InsightsCarousel from "../../components/InsightsCarousel";
import PlatformSelect from "../../components/PlatformSelect";
import RunPicker from "../../components/RunPicker";

export const dynamic = "force-dynamic";

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; run?: string; country?: string; platform?: string }>;
}) {
  if (!(await currentUser())) redirect("/login");
  const params = await searchParams;
  const domain = cleanDomain(params.domain ?? "");
  if (!domain) redirect("/");

  const platform = params.platform ?? "all";
  const country = params.country ?? "all";
  const report = await loadCompetitorReport({ domain, runId: params.run, country, platform });
  if (!report) {
    return (
      <main className="dash">
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="users" size={22} /></span>
          <h2>No results for {domain} yet</h2>
          <p className="note">Analyze the website first, then compare it with competitors.</p>
          <Link href={`/analyze?domain=${domain}`} className="btn-primary btn-link">Analyze {domain}</Link>
        </div>
      </main>
    );
  }

  const link = (over: Record<string, string>) => {
    const p = { domain, run: report.run?.id ?? "", country, platform, ...over };
    return "/competitors?" + Object.entries(p).filter(([, v]) => v && v !== "all").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  };
  const hasCompetitors = report.entities.length > 1;

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> AI Visibility <span aria-hidden="true">›</span> Competitor research</p>
          <h1>Competitor research: <span className="muted-strong">{domain}</span></h1>
        </div>
      </header>

      <div className="filter-bar">
        <nav className="segmented" aria-label="Country">
          <Link href={link({ country: "all" })} aria-current={country === "all"}>🌐 Worldwide</Link>
          {report.countries.map((c) => (
            <Link key={c.code} href={link({ country: c.code })} aria-current={country === c.code}>{c.flag} {c.code}</Link>
          ))}
        </nav>
        <CountriesEditor
          domain={domain}
          selected={report.countries.map((c) => c.code)}
          options={COUNTRY_CODES.map((code) => ({ code, name: COUNTRIES[code].name, flag: COUNTRIES[code].flag }))}
        />
        <PlatformSelect value={platform} options={report.platforms} query={`domain=${domain}&country=${country}`} />
        {report.run && <RunPicker runs={report.runs} value={report.run.id} query={`domain=${domain}&country=${country}&platform=${platform}`} />}
      </div>

      <CompetitorForm
        key={report.competitorInputs.join("|")}
        domain={domain}
        initial={report.competitorInputs}
        suggestions={report.empty ? [] : report.suggestions}
      />

      {report.empty ? (
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="database" size={22} /></span>
          <h2>No completed checks yet</h2>
          <p className="note">Run a check for {domain} to collect AI answers.</p>
          <Link href={`/analyze?domain=${domain}&force=1`} className="btn-primary btn-link">Run check</Link>
        </div>
      ) : !hasCompetitors ? (
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="users" size={22} /></span>
          <h2>Add competitors to view the report</h2>
          <p className="note">Use the fields above to compare with up to four competitors, by domain or name.</p>
        </div>
      ) : (
        <>
          <div className="cr-top">
            <CompetitorChart entities={report.entities} colors={ENTITY_COLORS} totals={report.totals} trend={report.trend} />
            <InsightsCarousel insights={report.insights} />
          </div>
          <CompetitorTable
            domain={domain}
            entities={report.entities}
            colors={ENTITY_COLORS}
            topics={report.topics}
            topicStatus={report.topicStatus}
            promptStatus={report.promptStatus}
            sites={report.sites}
          />
          <p className="note">Compared on {report.answers} AI answers to questions that don&apos;t name you, so your own name doesn&apos;t skew the result.</p>
        </>
      )}
    </main>
  );
}
