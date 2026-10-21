import "./keywords.css";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { COUNTRIES, COUNTRY_CODES, isCountry, type CountryCode } from "@/lib/countries";
import { getReport, recentReports, usdRates } from "@/lib/keyword-research";
import Link from "next/link";
import KeywordOverview from "../../components/KeywordOverview";
import KeywordSearch from "../../components/KeywordSearch";

export const dynamic = "force-dynamic";

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<{ q?: string; country?: string; device?: string; domain?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const p = await searchParams;
  const recent = await recentReports().catch(() => []);
  // No keyword in the address: open the last researched keyword instead of an empty page.
  const last = !p.q ? recent[0] : undefined;
  const q = (p.q ?? last?.keyword ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const country: CountryCode = isCountry(p.country) ? p.country : last?.country ?? "US";
  const device = (p.device ?? last?.device) === "mobile" ? "mobile" : "desktop";
  const report = q ? await getReport(q, country, device).catch(() => null) : null;
  const rates = report ? await usdRates() : null;
  const countries = COUNTRY_CODES.map((c) => ({ code: c, name: COUNTRIES[c].name, flag: COUNTRIES[c].flag }));

  return (
    <main className="dash kw-page">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> Keyword research <span aria-hidden="true">›</span> Keyword overview</p>
          <h1>Keyword Overview{q && <>: <span className="muted-strong">{q}</span></>}</h1>
        </div>
      </header>
      <KeywordSearch key={`${q}|${country}|${device}`} q={q} country={country} device={device} countries={countries} autoRun={!!q && !report} />
      {recent.length > 1 && (
        <nav className="kw-recent" aria-label="Recent searches">
          <span className="note">Recent:</span>
          {recent.map((r) => (
            <Link key={`${r.keyword}|${r.country}|${r.device}`} href={`/keywords?q=${encodeURIComponent(r.keyword)}&country=${r.country}&device=${r.device}${p.domain ? `&domain=${p.domain}` : ""}`}
              className="suggestion" aria-current={r.keyword === q && r.country === country && r.device === device ? "true" : undefined}>
              {r.keyword} <span className="muted">{r.country}</span>
            </Link>
          ))}
        </nav>
      )}
      {report && <KeywordOverview report={report} rates={rates} />}
      {!q && (
        <section className="kw-empty-state">
          <div>
            <h2>Research any keyword</h2>
            <p className="note">Volume, difficulty, intent, CPC, trend, keyword ideas, questions, a content plan and the top 100 Google results, for any country.</p>
          </div>
          <svg className="kw-empty-art" viewBox="0 0 240 140" aria-hidden="true">
            <rect x="8" y="14" width="150" height="30" rx="15" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="30" cy="29" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M35 34l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M48 29h70" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 6" />
            <path d="M20 128V96M52 128V78M84 128V88M116 128V62M148 128V70M180 128V40M212 128V52" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M20 96 52 78 84 88 116 62 148 70 180 40 212 52" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M8 128h224" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </section>
      )}
    </main>
  );
}
