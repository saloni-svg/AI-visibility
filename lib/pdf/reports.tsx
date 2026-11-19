/* eslint-disable @typescript-eslint/no-explicit-any */
import { Text, View } from "@react-pdf/renderer";
import { findBrand } from "../brands";
import { listRuns, loadExplanation } from "../change-explainer";
import { loadCompetitorReport } from "../competitors";
import { hasKeywordCom } from "../keywordcom";
import { loadOverview, PLATFORMS } from "../overview";
import { loadPositions } from "../positions";
import { loadRankReport } from "../rank-report";
import { loadSeoPage, type SeoData, type SeoPlan } from "../seo-agent";
import type { ShareKind } from "../share";
import {
  BarChart, BigTitle, Bullets, C, Callout, clean, Delta, Donut, FactList, HBars, Kpis, LineChart, num, Para, pct,
  ReportDocument, Section, Table,
} from "./kit";

// The PDF for each report: its own document layout (not a print of the page), built from the
// same data and filters the page shows.

type Params = Record<string, string | undefined>;
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const path = (u: string) => u.replace(/^https?:\/\/(www\.)?[^/]+/, "") || "/";
const statusLabel: Record<string, string> = { missing: "Not mentioned", weak: "Behind", shared: "Tied", strong: "Leading", unique: "Only you" };

export async function buildReportPdf(kind: ShareKind, domain: string, p: Params) {
  switch (kind) {
    case "overview": return overviewPdf(domain, p);
    case "competitors": return competitorsPdf(domain, p);
    case "changes": return changesPdf(domain, p);
    case "positions": return positionsPdf(domain, p);
    case "seo": return seoPdf(domain, p);
  }
}

// ---------------------------------------------------------------- Visibility overview
async function overviewPdf(domain: string, p: Params) {
  const platform = PLATFORMS.some((x) => x.value === p.platform) ? p.platform! : "all";
  const data: any = await loadOverview({ domain, runId: p.run, country: p.country ?? "all", platform });
  if (data.state !== "ok") throw new Error(`No visibility results for ${domain} yet.`);
  const country = data.countryOptions.find((c: any) => c.code === p.country);
  const scope = `${country ? country.name : "Worldwide"} · ${PLATFORMS.find((x) => x.value === platform)?.label ?? "All AI sources"} · check of ${data.run.label}`;
  const m = data.metrics;
  const avail = data.distribution.filter((d: any) => d.available);

  return (
    <ReportDocument meta={{ title: "AI Visibility Overview", domain, scope }}>
      <BigTitle sub={scope}>AI visibility summary</BigTitle>
      <Kpis items={[
        { label: "AI visibility score", value: data.score == null ? "–" : `${data.score}/100`, sub: data.band ? `${data.band}` : undefined },
        { label: "Mentions", value: num(m.mentions.value), delta: <Delta now={m.mentions.value} before={m.mentions.prev} />, sub: "AI answers that name you" },
        { label: "Citations", value: num(m.citations.value), delta: <Delta now={m.citations.value} before={m.citations.prev} />, sub: `Links to ${domain}` },
        { label: "Cited pages", value: num(m.citedPages.value), delta: <Delta now={m.citedPages.value} before={m.citedPages.prev} />, sub: "Different pages linked" },
      ]} />
      {data.scoreNote ? <Callout>{<Text style={{ fontSize: 9 }}>{clean(data.scoreNote)}</Text>}</Callout> : null}

      <Section title="Mentions, citations and cited pages over time" keep scope={`${domain} · last ${data.trend.length} checks`}>
        <LineChart
          labels={data.trend.map((t: any) => t.label)}
          series={[
            { name: "Mentions", color: C.series[0], values: data.trend.map((t: any) => t.byProvider.mentions) },
            { name: "Citations", color: C.series[1], values: data.trend.map((t: any) => t.byProvider.citations) },
            { name: "Cited pages", color: C.series[3], values: data.trend.map((t: any) => t.byProvider.citedPages) },
          ]}
        />
      </Section>

      <Section title="Distribution by AI source" keep scope={`${domain} · share of all mentions`}>
        <View style={{ flexDirection: "row", gap: 24 }}>
          <View style={{ flex: 1 }}>
            <Donut size={120} center={num(avail.reduce((a: number, d: any) => a + d.mentions, 0))}
              slices={avail.map((d: any, i: number) => ({ label: d.label, value: d.mentions, color: C.series[i % C.series.length] }))} />
          </View>
          <View style={{ flex: 1 }}>
            <Table cols={[{ label: "AI source", width: 3 }, { label: "Answers", width: 1.4, align: "right" }, { label: "Mentions", width: 1.5, align: "right" }, { label: "Pages", width: 1.2, align: "right" }]}
              rows={avail.map((d: any) => [d.label, num(d.answers), num(d.mentions), num(d.pages)])} />
          </View>
        </View>
      </Section>

      {data.countries.length > 1 ? (
        <Section title="Mentions by country" keep scope={domain}>
          <HBars items={data.countries.map((c: any) => ({ label: c.name, value: c.mentions, sub: `(${pct(c.share, 1)})` }))} />
        </Section>
      ) : null}

      <Section title={`Topics where AI mentions you (${data.performingTopics.length})`} scope={domain}>
        <Table cols={[{ label: "Topic", width: 4 }, { label: "AI visibility", width: 1.6, align: "right" }, { label: "Mentions", width: 1.4, align: "right" }, { label: "Answers", width: 1.3, align: "right" }, { label: "AI volume", width: 1.5, align: "right" }]}
          rows={data.performingTopics.slice(0, 25).map((t: any) => [{ text: t.name, bold: true, sub: t.keyword ?? undefined }, { text: `${t.visibility}%`, bar: t.visibility / 100 }, num(t.mentions), num(t.answers), num(t.volume?.volume)])}
          empty="No topics mention you yet" />
      </Section>

      <Section title={`Topic opportunities (${data.topicOpportunities.length})`} note="Topics where AI answers never name you, highest demand first." scope={domain}>
        <Table cols={[{ label: "Topic", width: 4 }, { label: "Answers checked", width: 1.6, align: "right" }, { label: "AI volume", width: 1.5, align: "right" }]}
          rows={data.topicOpportunities.slice(0, 20).map((t: any) => [{ text: t.name, bold: true, sub: t.keyword ?? undefined }, num(t.answers), num(t.volume?.volume)])}
          empty="No missing topics" />
      </Section>

      <Section title="Websites AI cites" note="The sources AI assistants link to in these answers, and how many of those answers also name you." scope={domain}>
        <Table cols={[{ label: "Website", width: 4 }, { label: "Answers citing it", width: 1.8, align: "right" }, { label: "With you", width: 1.4, align: "right" }]}
          rows={data.citedSources.slice(0, 20).map((s: any) => [{ text: s.domain, bold: s.isYou, color: s.isYou ? C.brand : undefined }, num(s.answers), num(s.withYou)])} />
      </Section>

      {data.sourceOpportunities.length ? (
        <Section title="Source opportunities" note="Websites AI cites for competitors but not for you: places to get listed or mentioned." scope={domain}>
          <Table cols={[{ label: "Website", width: 3 }, { label: "Answers", width: 1.2, align: "right" }, { label: "Brands it leads AI to", width: 4 }]}
            rows={data.sourceOpportunities.slice(0, 15).map((s: any) => [{ text: s.domain, bold: true }, num(s.answers), (s.brands ?? []).join(", ")])} />
        </Section>
      ) : null}

      {data.citedPages.length ? (
        <Section title="Your pages AI cites" scope={domain}>
          <Table cols={[{ label: "Page", width: 5 }, { label: "Citations", width: 1.2, align: "right" }, { label: "Cited by", width: 2.5 }]}
            rows={data.citedPages.slice(0, 20).map((x: any) => [path(x.url), num(x.count), x.sources.join(", ")])} />
        </Section>
      ) : null}

      {data.insights?.length ? (
        <Section title="What to do next" scope="Recommendations from this check">
          {data.insights.map((i: any, k: number) => (
            <Callout key={k} title={i.title}><Text style={{ fontSize: 8.5, lineHeight: 1.45 }}>{clean(i.body)}</Text>{i.action ? <Text style={{ fontSize: 8.5, color: C.brand, marginTop: 3, fontWeight: 600 }}>{clean(i.action)}</Text> : null}</Callout>
          ))}
        </Section>
      ) : null}
    </ReportDocument>
  );
}

// ---------------------------------------------------------------- Competitor research
async function competitorsPdf(domain: string, p: Params) {
  const report: any = await loadCompetitorReport({ domain, runId: p.run, country: p.country ?? "all", platform: p.platform ?? "all" });
  if (!report || report.empty) throw new Error(`No competitor results for ${domain} yet.`);
  const ents = report.entities as { id: string; name: string; label: string; isBrand: boolean }[];
  const country = report.countries.find((c: any) => c.code === p.country);
  const scope = `${country ? country.name : "Worldwide"} · ${report.platforms.find((x: any) => x.value === p.platform)?.label ?? "All AI sources"}${report.run ? ` · check of ${report.run.label}` : ""}`;
  const you = report.totals[0];
  const color = (i: number) => C.series[i % C.series.length];

  return (
    <ReportDocument meta={{ title: "Competitor Research", domain, scope }}>
      <BigTitle sub={scope}>How AI assistants compare you with competitors</BigTitle>
      <Kpis items={[
        { label: "Your AI visibility", value: `${you.visibility}%`, sub: "Named and ranked in AI answers" },
        { label: "Your mentions", value: num(you.mentions), sub: `of ${num(report.answers)} answers` },
        { label: "Share of voice", value: pct(you.share, 1), sub: "Your share of all brand mentions" },
        { label: "Competitors", value: num(ents.length - 1), sub: ents.slice(1).map((e) => e.label).join(", ").slice(0, 60) },
      ]} />

      <Section title="Competitive position" scope={`${domain} · ${report.answers} AI answers that don't name you in the question`}>
        <Table cols={[{ label: "Brand", width: 4 }, { label: "AI visibility", width: 2, align: "right" }, { label: "Mentions", width: 1.5, align: "right" }, { label: "Share of voice", width: 2, align: "right" }]}
          rows={ents.map((e, i) => [{ text: e.label, bold: e.isBrand, color: e.isBrand ? C.brand : undefined, sub: e.name !== e.label ? e.name : undefined }, { text: `${report.totals[i].visibility}%`, bar: report.totals[i].visibility / 100 }, num(report.totals[i].mentions), pct(report.totals[i].share, 1)])} />
      </Section>

      <Section title="Share of voice" keep scope={domain}>
        <Donut size={130} center={pct(you.share)} slices={ents.map((e, i) => ({ label: e.label, value: report.totals[i].mentions, color: color(i) }))} />
      </Section>

      {report.trend.length > 1 ? (
        <Section title="AI visibility over time" keep scope={`${domain} and competitors`}>
          <LineChart percent labels={report.trend.map((t: any) => t.label)}
            series={ents.map((e, i) => ({ name: e.label, color: color(i), values: report.trend.map((t: any) => t.visibility[e.id] ?? null) }))} />
        </Section>
      ) : null}

      <Section title="Topics: where you lead and where you're missing" scope={`${report.topics.length} topics`}>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
          {Object.entries(report.topicStatus as Record<string, number>).map(([k, n]) => (
            <View key={k} style={{ flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 7 }}>
              <Text style={{ fontSize: 7.5, color: C.muted }}>{statusLabel[k] ?? k}</Text>
              <Text style={{ fontSize: 14, fontWeight: 700, color: k === "missing" || k === "weak" ? C.bad : C.ink }}>{n}</Text>
            </View>
          ))}
        </View>
        <Table cols={[{ label: "Topic", width: 4 }, { label: "Status", width: 1.7 }, { label: "You", width: 1, align: "right" }, { label: "Best competitor", width: 1.8, align: "right" }, { label: "AI volume", width: 1.4, align: "right" }]}
          rows={report.topics.filter((t: any) => t.status).sort((a: any, b: any) => (b.volume?.volume ?? 0) - (a.volume?.volume ?? 0)).slice(0, 30).map((t: any) => {
            const best = Math.max(0, ...t.counts.slice(1));
            const bad = t.status === "missing" || t.status === "weak";
            return [{ text: t.name, bold: true }, { text: statusLabel[t.status] ?? t.status, color: bad ? C.bad : C.good }, num(t.counts[0]), num(best), num(t.volume?.volume)];
          })} />
      </Section>

      <Section title="Websites AI cites in these answers" note="How often each brand appears in the answers that cite the site." scope={domain}>
        <Table cols={[{ label: "Website", width: 3.5 }, { label: "Answers", width: 1.1, align: "right" }, ...ents.slice(0, 5).map((e) => ({ label: e.label.slice(0, 14), width: 1.2, align: "right" as const }))]}
          rows={report.sites.slice(0, 20).map((s: any) => [{ text: s.domain, bold: s.owner === 0, color: s.owner === 0 ? C.brand : undefined }, num(s.answers), ...s.counts.slice(0, 5).map((n: number) => num(n))])} />
      </Section>

      {report.insights?.length ? (
        <Section title="Where competitors win and you don't" scope="Sites that lead AI to competitors but never to you">
          {report.insights.slice(0, 8).map((i: any, k: number) => (
            <Callout key={k} title={i.domain} tone="warn"><Text style={{ fontSize: 8.5 }}>Cited in {num(i.answers)} answers that name competitors but not you. Getting listed or mentioned here is one of the fastest ways into these answers.</Text></Callout>
          ))}
        </Section>
      ) : null}
    </ReportDocument>
  );
}

// ---------------------------------------------------------------- Change explainer
async function changesPdf(domain: string, p: Params) {
  const brand = await findBrand(domain);
  if (!brand) throw new Error(`Analyze ${domain} first.`);
  const runs = await listRuns(brand.id);
  if (runs.length < 2) throw new Error("The change explainer needs at least two checks.");
  const run = runs.find((r) => r.id === p.run) ?? runs[0];
  const later = runs.filter((r) => r.at < run.at);
  const prev = later.find((r) => r.id === p.prev) ?? later[0] ?? runs[1];
  const r: any = await loadExplanation(run.id, prev.id).catch(() => null);
  if (!r) throw new Error("This comparison hasn't been explained yet. Open Change explainer and run it first.");
  const e = r.explanation;
  const scope = `Check of ${r.runs.current.label} compared with ${r.runs.previous.label}`;
  const rate = (x: any) => `${pct(x.before)} → ${pct(x.after)}`;
  const verdict = (v: string) => (v === "significant" ? "Real change" : v === "likely_noise" ? "Could be chance" : "Too few answers");
  const cause: Record<string, string> = { website_change: "Website change", ai_results_changed: "AI results changed", competitor_gains: "Competitors gained", measurement_noise: "Measurement noise", mixed: "Several causes", not_enough_data: "Not enough data" };

  return (
    <ReportDocument meta={{ title: "AI Visibility Change Report", domain, scope }}>
      <BigTitle sub={scope}>What changed and why</BigTitle>
      <Kpis items={[
        { label: "Mention rate, all questions", value: pct(r.overall.all.after), delta: <Delta now={r.overall.all.after} before={r.overall.all.before} />, sub: `was ${pct(r.overall.all.before)} · ${verdict(r.overall.all.verdict)}` },
        { label: "Mention rate, unbranded", value: pct(r.overall.unbranded.after), delta: <Delta now={r.overall.unbranded.after} before={r.overall.unbranded.before} />, sub: `was ${pct(r.overall.unbranded.before)}` },
        { label: "Questions gained / lost", value: `${r.promptChanges.filter((c: any) => c.change === "gained").length} / ${r.promptChanges.filter((c: any) => c.change === "lost").length}`, sub: `${num(r.compared.pairs)} question pairs compared` },
        { label: "Likely cause", value: e ? cause[e.likely_cause] ?? e.likely_cause : "–" },
      ]} />

      {e ? (
        <Section title="Summary">
          <Para>{clean(e.summary)}</Para>
          {e.website_vs_ai ? <Callout title="Website or AI?"><Text style={{ fontSize: 8.5, lineHeight: 1.45 }}>{clean(e.website_vs_ai)}</Text></Callout> : null}
          {e.consistency ? <Callout title="How consistent the answers are"><Text style={{ fontSize: 8.5, lineHeight: 1.45 }}>{clean(e.consistency)}</Text></Callout> : null}
        </Section>
      ) : null}

      <Section title="By AI source" scope={scope}>
        <Table cols={[{ label: "AI source", width: 3 }, { label: "Mention rate", width: 2.4, align: "right" }, { label: "Change", width: 1.3, align: "right" }, { label: "Verdict", width: 2 }]}
          rows={r.byProvider.map((x: any) => [{ text: x.label, bold: true }, rate(x), { text: `${x.diff > 0 ? "+" : ""}${Math.round(x.diff * 100)} pts`, color: x.diff > 0 ? C.good : x.diff < 0 ? C.bad : undefined }, verdict(x.verdict)])} />
      </Section>

      {r.byCountry?.length ? (
        <Section title="By country">
          <Table cols={[{ label: "Country", width: 3 }, { label: "Mention rate", width: 2.4, align: "right" }, { label: "Change", width: 1.3, align: "right" }, { label: "Verdict", width: 2 }]}
            rows={r.byCountry.map((x: any) => [{ text: x.country, bold: true }, rate(x), { text: `${x.diff > 0 ? "+" : ""}${Math.round(x.diff * 100)} pts`, color: x.diff > 0 ? C.good : x.diff < 0 ? C.bad : undefined }, verdict(x.verdict)])} />
        </Section>
      ) : null}

      {e?.findings?.length ? (
        <Section title="Findings" note="Each conclusion with its evidence and how sure we are.">
          {e.findings.map((f: any, i: number) => (
            <Callout key={i} title={f.claim} tone={f.confidence === "high" ? "good" : f.confidence === "low" ? "warn" : "brand"}>
              <Text style={{ fontSize: 7.5, color: C.muted, marginBottom: 2 }}>Confidence: {f.confidence}</Text>
              {(f.evidence ?? []).map((id: string) => {
                const ev = r.evidence.find((x: any) => x.id === id);
                return ev ? <Text key={id} style={{ fontSize: 8, color: C.text, lineHeight: 1.4 }}>[{id}] {clean(ev.text)}</Text> : null;
              })}
            </Callout>
          ))}
        </Section>
      ) : null}

      <Section title="Questions that changed" scope={`${r.promptChanges.length} questions`}>
        <Table cols={[{ label: "Question", width: 5 }, { label: "AI", width: 1.6 }, { label: "Change", width: 1.2 }, { label: "Named before → after", width: 2.2, align: "right" }]}
          rows={r.promptChanges.slice(0, 30).map((c: any) => [{ text: c.prompt, sub: c.country }, c.provider, { text: c.change === "gained" ? "Gained" : "Lost", color: c.change === "gained" ? C.good : C.bad }, `${pct(c.rateBefore)} → ${pct(c.rateAfter)}`])} />
      </Section>

      {(r.brands.appeared.length || r.brands.rising.length || r.brands.falling.length) ? (
        <Section title="Competitor brands that moved">
          <Table cols={[{ label: "Brand", width: 4 }, { label: "Mentions before", width: 1.6, align: "right" }, { label: "Mentions after", width: 1.6, align: "right" }]}
            rows={[...r.brands.appeared, ...r.brands.rising, ...r.brands.falling, ...r.brands.disappeared].slice(0, 15).map((b: any) => [{ text: b.name, bold: true }, num(b.before), { text: num(b.after), color: b.after > b.before ? C.bad : C.good }])} />
        </Section>
      ) : null}

      {e?.next_steps?.length ? (
        <Section title="Next steps"><Bullets items={e.next_steps} /></Section>
      ) : null}
      {r.caveats?.length ? <Section title="Notes"><Bullets items={r.caveats} /></Section> : null}
    </ReportDocument>
  );
}

// ---------------------------------------------------------------- Position tracking
async function positionsPdf(domain: string, p: Params) {
  const brand = await findBrand(domain);
  if (!brand) throw new Error(`Analyze ${domain} first.`);
  const countries = brand.countries?.length ? brand.countries : ["US"];
  const country = countries.includes(p.country ?? "") ? p.country! : countries[0];
  const data: any = await loadPositions({ id: brand.id, domain, countries }, country, p.run);
  const report: any = hasKeywordCom() ? await loadRankReport(domain, p.project).catch(() => null) : null;
  const cName = data.countries.find((c: any) => c.code === country)?.name ?? country;
  const scope = `${data.location ? data.location.name.replace(/,/g, ", ") : `${cName} (whole country)`}${report?.checked ? ` · ranks checked ${report.checked}` : ""}`;
  const s = data.summary;
  const rows: any[] = report?.rows ?? [];
  const ranked = rows.filter((r) => r.rank != null);
  const avg = ranked.length ? Math.round((ranked.reduce((a, r) => a + r.rank, 0) / ranked.length) * 10) / 10 : s?.you.avgPosition ?? null;
  const dist = [["1-3", 1, 3], ["4-10", 4, 10], ["11-20", 11, 20], ["21-30", 21, 30], ["31-50", 31, 50], ["51-100", 51, 100]] as const;

  return (
    <ReportDocument meta={{ title: "Position Tracking", domain, scope }}>
      <BigTitle sub={scope}>Google rankings</BigTitle>
      <Kpis items={[
        { label: "Keywords tracked", value: num(rows.length || data.keywordCount) },
        { label: "Average rank", value: avg == null ? "–" : String(avg), sub: `${ranked.length} in Google's top 100` },
        { label: "Top 3 / Top 10", value: `${ranked.filter((r) => r.rank <= 3).length} / ${ranked.filter((r) => r.rank <= 10).length}` },
        { label: "Visibility", value: s ? `${s.you.visibility}%` : "–", delta: s ? <Delta now={s.you.visibility} before={s.prev?.visibility} /> : undefined, sub: s ? `Est. traffic ${num(s.you.traffic)}/month` : undefined },
      ]} />

      {ranked.length ? (
        <Section title="Keyword position distribution" keep scope={`${domain} · ${cName}`}>
          <BarChart height={140} data={dist.map(([label, a, b]) => ({ label, value: ranked.filter((r) => r.rank >= a && r.rank <= b).length }))} />
        </Section>
      ) : null}

      {s?.competitors?.length ? (
        <Section title="You and your competitors" keep scope={cName}>
          <Table cols={[{ label: "Domain", width: 4 }, { label: "Visibility", width: 1.5, align: "right" }, { label: "Avg position", width: 1.6, align: "right" }, { label: "Top 10", width: 1.2, align: "right" }]}
            rows={[[{ text: domain, bold: true, color: C.brand }, `${s.you.visibility}%`, String(s.you.avgPosition ?? "–"), num(s.you.top10)],
              ...s.competitors.map((c: any) => [c.domain, `${c.visibility}%`, String(c.avgPosition ?? "–"), num(c.top10)])]} />
        </Section>
      ) : null}

      {data.trend?.length > 1 ? (
        <Section title="Visibility over time" keep scope={`${domain} and competitors`}>
          <LineChart percent labels={data.trend.map((t: any) => t.label)}
            series={[{ name: domain, color: C.series[0], values: data.trend.map((t: any) => t.byProvider.you ?? null) },
              ...data.competitors.slice(0, 4).map((d: string, i: number) => ({ name: d, color: C.series[(i % 4) + 1], values: data.trend.map((t: any) => t.byProvider[d] ?? null) }))]} />
        </Section>
      ) : null}

      <Section title={`Keyword rankings (${rows.length})`} scope={`Ranks from Keyword.com · search volume and average CPC from Google Keyword Planner`}>
        <Table cols={[{ label: "Keyword", width: 3.6 }, { label: "Location", width: 2 }, { label: "Rank", width: 0.9, align: "right" }, { label: "7 days", width: 1, align: "right" }, { label: "Best", width: 0.9, align: "right" }, { label: "Volume", width: 1.2, align: "right" }, { label: "CPC", width: 1.2, align: "right" }, { label: "", width: 0.3 }, { label: "Ranking page", width: 2.8 }]}
          rows={[...rows].sort((a, b) => (a.rank ?? 101) - (b.rank ?? 101)).map((r) => {
            const ch = r.change?.week;
            return [{ text: r.keyword, bold: true }, r.location, r.rank == null ? ">100" : String(r.rank),
              { text: ch == null ? "–" : ch === 0 ? "0" : `${ch > 0 ? "+" : ""}${ch}`, color: ch > 0 ? C.good : ch < 0 ? C.bad : undefined },
              r.best == null ? ">100" : String(r.best), r.volume ? num(r.volume) : "–", r.cpc != null ? `$${r.cpc.toFixed(2)}` : "–", "", r.url ? path(r.url) : "–"];
          })}
          empty="No keywords tracked yet" />
      </Section>
    </ReportDocument>
  );
}

// ---------------------------------------------------------------- SEO plan
async function seoPdf(domain: string, p: Params) {
  const brand = await findBrand(domain);
  if (!brand) throw new Error(`Analyze ${domain} first.`);
  const page = await loadSeoPage(brand.id, p.plan);
  if (!page.plan) throw new Error("No SEO plan yet. Create one on the SEO agent page first.");
  const d = page.plan.data as SeoData;
  const plan = page.plan.plan as SeoPlan;
  const g = d.gsc;
  const ctr = (x: { clicks: number; impressions: number }) => (x.impressions ? x.clicks / x.impressions : 0);
  const scope = `Plan of ${new Date(page.plan.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}${d.periods ? ` · data ${d.periods.cur[0]} to ${d.periods.cur[1]}` : ""}${plan.writtenBy ? ` · written by ${plan.writtenBy}` : ""}`;
  const when = { "30": "Days 1-30", "60": "Days 31-60", "90": "Days 61-90" } as const;
  const o = d.opportunities;

  return (
    <ReportDocument meta={{ title: "SEO Plan", domain, scope }}>
      <BigTitle sub={scope}>Organic search summary</BigTitle>
      {g ? (
        <Kpis items={[
          { label: "Clicks · 28 days", value: num(g.totals.cur.clicks), delta: <Delta now={g.totals.cur.clicks} before={g.totals.prev.clicks} />, sub: `${g.totals.yoy.clicks ? `${num(g.totals.yoy.clicks)} a year ago` : ""}` },
          { label: "Impressions", value: num(g.totals.cur.impressions), delta: <Delta now={g.totals.cur.impressions} before={g.totals.prev.impressions} /> },
          { label: "Click-through rate", value: pct(ctr(g.totals.cur), 1), delta: <Delta now={ctr(g.totals.cur)} before={ctr(g.totals.prev)} /> },
          { label: "Average position", value: String(g.totals.cur.position ?? "–"), delta: <Delta now={g.totals.cur.position} before={g.totals.prev.position} lowerIsBetter />, sub: "Lower is better" },
        ]} />
      ) : null}
      {g && g.monthly.length > 1 ? (
        <Section title="Clicks from Google by month" keep scope="Search Console · last 16 months">
          <BarChart height={150} data={g.monthly.map((m) => ({ label: new Date(`${m.month}-01`).toLocaleDateString("en-GB", { month: "short" }), value: m.clicks }))} />
        </Section>
      ) : null}

      <Section title="Summary">
        <Para>{clean(plan.summary)}</Para>
        {plan.priorities?.length ? <Callout title="Top priorities"><Bullets items={plan.priorities} /></Callout> : null}
        {plan.progress ? <Para><Text style={{ fontWeight: 600 }}>Since the last plan: </Text>{clean(plan.progress)}</Para> : null}
      </Section>

      {(["30", "60", "90"] as const).map((t, ti) => {
        const list = plan.actions.filter((a) => a.timeframe === t && a.status !== "dismissed");
        if (!list.length) return null;
        return (
          <Section key={t} title={`${when[t]} · ${list.length} actions`}>
            {list.map((a, i) => (
              <View key={a.id ?? i} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 9, marginBottom: 8 }} wrap={false}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontSize: 10, fontWeight: 700, color: C.ink, flex: 1 }}>{clean(a.title)}{a.status === "done" ? "  (done)" : ""}</Text>
                  <Text style={{ fontSize: 7.5, fontWeight: 600, color: a.priority === "high" ? C.bad : a.priority === "medium" ? C.warn : C.muted }}>{a.priority.toUpperCase()} PRIORITY · EFFORT {a.effort.toUpperCase()}</Text>
                </View>
                {a.target && a.target !== "site-wide" ? <Text style={{ fontSize: 8, color: C.brand, marginTop: 2 }}>{clean(/^https?:/.test(a.target) ? short(a.target) : `"${a.target}"`)}</Text> : null}
                <Text style={{ fontSize: 8.5, lineHeight: 1.45, marginTop: 4 }}><Text style={{ fontWeight: 600 }}>Why: </Text>{clean(a.why)}</Text>
                {a.steps?.length ? <View style={{ marginTop: 3 }}>{a.steps.map((st, k) => <Text key={k} style={{ fontSize: 8.5, lineHeight: 1.4 }}>{k + 1}. {clean(st)}</Text>)}</View> : null}
                <Text style={{ fontSize: 8.5, lineHeight: 1.45, marginTop: 3 }}><Text style={{ fontWeight: 600 }}>Expected impact: </Text>{clean(a.impact)}</Text>
                {a.draft?.title || a.draft?.meta_description ? (
                  <View style={{ backgroundColor: C.band, borderRadius: 4, padding: 6, marginTop: 5 }}>
                    {a.draft.title ? <Text style={{ fontSize: 8 }}><Text style={{ color: C.muted }}>TITLE  </Text>{clean(a.draft.title)}</Text> : null}
                    {a.draft.meta_description ? <Text style={{ fontSize: 8, marginTop: 2 }}><Text style={{ color: C.muted }}>META  </Text>{clean(a.draft.meta_description)}</Text> : null}
                  </View>
                ) : null}
              </View>
            ))}
          </Section>
        );
      })}

      {o?.quickWins?.length ? (
        <Section title="Quick wins" note="Search terms ranking 4-15 with real demand. Extra clicks = estimate at position 3.">
          <Table cols={[{ label: "Search term", width: 4 }, { label: "Position", width: 1.1, align: "right" }, { label: "Impressions", width: 1.4, align: "right" }, { label: "Clicks", width: 1, align: "right" }, { label: "Extra clicks", width: 1.3, align: "right" }]}
            rows={o.quickWins.slice(0, 20).map((q) => [{ text: q.query, bold: true, sub: path(q.page) }, String(q.position), num(q.impressions), num(q.clicks), { text: `+${num(q.extraClicks)}`, color: C.good }])} />
        </Section>
      ) : null}
      {o?.lowCtr?.length ? (
        <Section title="Low click-through rate" note="Page-one pages getting under half the clicks their position normally gets.">
          <Table cols={[{ label: "Page", width: 4 }, { label: "Position", width: 1.1, align: "right" }, { label: "Impressions", width: 1.4, align: "right" }, { label: "CTR", width: 1, align: "right" }, { label: "Typical", width: 1, align: "right" }]}
            rows={o.lowCtr.map((x) => [{ text: path(x.page), bold: true, sub: x.topQueries.slice(0, 3).join(" · ") }, String(x.position), num(x.impressions), `${x.ctr}%`, `${x.expectedCtr}%`])} />
        </Section>
      ) : null}
      {o?.decaying?.length ? (
        <Section title="Declining pages">
          <Table cols={[{ label: "Page", width: 4.5 }, { label: "Clicks now", width: 1.3, align: "right" }, { label: "Before", width: 1.8, align: "right" }, { label: "Change", width: 1.1, align: "right" }]}
            rows={o.decaying.map((x) => [{ text: path(x.page), bold: true }, num(x.clicks), `${num(x.before)} (${x.versus})`, { text: `${x.change}%`, color: C.bad }])} />
        </Section>
      ) : null}
      {d.audit?.issues?.length ? (
        <Section title="Site audit problems" scope={d.audit.score != null ? `Health score ${d.audit.score}` : undefined}>
          <Table cols={[{ label: "Problem", width: 5 }, { label: "Severity", width: 1.4 }, { label: "Pages", width: 1, align: "right" }]}
            rows={d.audit.issues.slice(0, 12).map((x) => [x.title, { text: x.severity, color: x.severity === "error" ? C.bad : C.warn }, num(x.pages)])} />
        </Section>
      ) : null}
      {g ? (
        <Section title="Data used">
          <FactList rows={[
            ["Search terms analysed", num(g.queries.length)],
            ["Pages analysed", num(g.pages.length)],
            ["Brand searches (share of clicks)", g.totals.cur.clicks ? pct(g.branded.clicks / g.totals.cur.clicks) : "–"],
            ["Organic sessions (GA4, 28 days)", d.ga4 ? num(d.ga4.totals.sessions) : "Not connected"],
            ["Tracked keywords", num(d.ranks?.length)],
          ]} />
        </Section>
      ) : null}
    </ReportDocument>
  );
}
