import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listBrands } from "@/lib/brands";
import { cleanDomain } from "@/lib/domain";
import { loadOverview, PLATFORMS, type Overview } from "@/lib/overview";
import DomainForm from "../components/DomainForm";
import Icon from "../components/Icon";
import OverviewView from "../components/OverviewView";

// Always read fresh data from Supabase; nothing here is cached at build time.
export const dynamic = "force-dynamic";

const TABS = ["performing", "topic-opportunities", "cited-sources", "source-opportunities", "cited-pages"];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; run?: string; country?: string; platform?: string; tab?: string; dist?: string }>;
}) {
  // proxy.ts already redirects signed-out visitors; check again here so the
  // data is never loaded without a signed-in user.
  if (!(await currentUser())) redirect("/login");

  const params = await searchParams;
  const domain = cleanDomain(params.domain ?? "");
  if (!domain) return <StartPage />;

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
          <p className="note">
            If it mentions a missing column or table, run <code>supabase/migrations/0002_visibility_overview.sql</code> in the Supabase SQL editor.
          </p>
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
          <Link href={`/analyze?domain=${domain}&force=1`} className="btn-primary btn-link">Analyze {domain}</Link>
        </div>
      </main>
    );
  }

  const country = data.countryOptions.some((c) => c.code === params.country) ? params.country! : "all";
  return <OverviewView data={data} domain={domain} params={{ country, platform, tab, dist }} platforms={PLATFORMS} />;
}

// Shown when no domain is chosen: a landing screen with the domain box,
// recently checked websites, and what the analysis shows.
async function StartPage() {
  let brands: Awaited<ReturnType<typeof listBrands>> = [];
  try {
    brands = await listBrands();
  } catch {
    // The page still works without the list.
  }
  const tracked = brands.filter((b) => b.domain);
  const sources = ["ChatGPT", "Google AI Overview", "Gemini", "Perplexity"];
  const features = [
    { img: "feature-overview", title: "Visibility overview", text: "A 0–100 score, mentions, citations and trends, split by AI source and country." },
    { img: "feature-competitors", title: "Competitor research", text: "Compare with up to four competitors and see the questions where they win." },
    { img: "feature-topics", title: "Topics & sources", text: "The topics you're missing, their AI search volume, and the sites AI trusts." },
  ];
  const steps = [
    { title: "Enter your website", text: "We read it and write the questions your customers ask AI." },
    { title: "We ask 4 AI assistants", text: "ChatGPT, Google AI Overview, Gemini and Perplexity answer, with web search on." },
    { title: "See where you stand", text: "Your score, the competitors AI picks instead, and what to fix first." },
  ];
  return (
    <main className="start">
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-inner">
          <p className="hero-kicker"><span className="hero-dot" />AI Visibility</p>
          <h1 className="hero-title">
            Be the brand AI recommends
            <span>From search results to AI answers</span>
          </h1>
          <p className="hero-sub">
            Enter a website. We ask the questions its customers ask AI, then show who gets recommended, which sites AI trusts, and what to fix.
          </p>
          <div className="hero-form">
            <DomainForm large button="Check visibility" />
          </div>
          {tracked.length > 0 && (
            <p className="hero-recent">
              <span>Last checked:</span>
              {tracked.slice(-4).reverse().map((b) => (
                <Link key={b.id} href={`/analyze?domain=${b.domain}`}>{b.domain}</Link>
              ))}
            </p>
          )}
          <ul className="hero-sources" aria-label="AI sources checked">
            {sources.map((s) => <li key={s}><span className="dot" />{s}</li>)}
          </ul>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="hero-preview" src="/illustrations/hero-preview.svg" alt="Example report: visibility score, mentions trend, share of voice and answers from each AI assistant" />
      </section>

      <section className="steps" aria-label="How it works">
        {steps.map((st, i) => (
          <div key={st.title} className="step">
            <span className="step-num">{i + 1}</span>
            <div>
              <h2>{st.title}</h2>
              <p>{st.text}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="start-features" aria-label="What you get">
        {features.map((f) => (
          <article key={f.title} className="card start-feature">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/illustrations/${f.img}.svg`} alt="" />
            <div className="start-feature-text">
              <h2>{f.title}</h2>
              <p>{f.text}</p>
            </div>
          </article>
        ))}
      </section>
      <p className="note start-note">The first check takes 1–3 minutes. Results are saved and reused for 7 days.</p>
    </main>
  );
}
