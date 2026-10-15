import Link from "next/link";
import type { ReactNode } from "react";
import type { Dashboard, Provider, Rate, Scope } from "@/lib/dashboard";
import HoverTips from "./HoverTips";
import Icon, { type IconName } from "./Icon";
import RunPicker from "./RunPicker";
import TrendChart from "./TrendChart";

export const PROVIDER_META: Record<Provider, { label: string; color: string }> = {
  openai: { label: "ChatGPT", color: "var(--openai)" },
  gemini: { label: "Gemini", color: "var(--gemini)" },
  perplexity: { label: "Perplexity", color: "var(--perplexity)" },
};
export const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "All questions" },
  { value: "unbranded", label: "Unbranded" },
  { value: "branded", label: "Branded" },
];

const share = (r: Rate) => (r.total ? r.hits / r.total : 0);
const pct = (v: number) => `${Math.round(v * 100)}%`;

// Draws the dashboard for already-loaded data.
export default function DashboardView({ data }: { data: Extract<Dashboard, { state: "ok" }> }) {
  const { brand, kpis, providers, scope } = data;
  const series = providers.map((p) => ({ key: p, ...PROVIDER_META[p] }));
  const rateNow = share(kpis.mentionRate);
  const deltaPts = kpis.previousRate ? Math.round((rateNow - share(kpis.previousRate)) * 100) : null;
  const scopeLabel = scope === "all" ? "all" : scope;

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="eyebrow">{brand.name}</p>
          <h1>AI visibility overview</h1>
          <p className="subtitle">How often ChatGPT, Gemini and Perplexity recommend {brand.name}.</p>
        </div>
        {/* Filters scope everything below them. */}
        <div className="filters">
          <RunPicker runs={data.runs} value={data.run.id} scope={scope} />
          <nav className="segmented" aria-label="Question type">
            {SCOPES.map((s) => (
              <Link key={s.value} href={`/?run=${data.run.id}&type=${s.value}`} aria-current={s.value === scope}>
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {kpis.answers === 0 ? (
        <div className="card empty-state">
          <span className="empty-icon"><Icon name="database" size={22} /></span>
          <h2>No {scopeLabel} answers in this run</h2>
          <p className="note">Pick another run or question type.</p>
        </div>
      ) : (
        <>
          <section id="overview" className="kpis" aria-label="Summary">
            <Stat icon="message" label="Mentioned in" value={pct(rateNow)} hero>
              {kpis.mentionRate.hits} of {kpis.mentionRate.total} {scopeLabel} answers
              {deltaPts !== null && (
                <span className={`delta ${deltaPts > 0 ? "delta-up" : deltaPts < 0 ? "delta-down" : ""}`}>
                  {deltaPts > 0 ? "▲ +" : deltaPts < 0 ? "▼ " : "■ "}
                  {deltaPts} pts vs previous run
                </span>
              )}
            </Stat>
            <Stat icon="hash" label="Average position" value={kpis.avgPosition === null ? "–" : kpis.avgPosition.toFixed(1)}>
              When mentioned · 1 = named first
            </Stat>
            <Stat icon="link" label="Your website cited" value={pct(share(kpis.siteCited))}>
              {kpis.siteCited.hits} of {kpis.siteCited.total} answers link to {brand.domain ?? "your site"}
            </Stat>
            <Stat icon="database" label="Answers analysed" value={String(kpis.answers)}>
              From {providers.map((p) => PROVIDER_META[p].label).join(", ")}
            </Stat>
          </section>

          <Card id="competitors" icon="users" title="You vs competitors" note={`Share of ${scopeLabel} answers from each AI tool that name the brand.`}>
            <Legend series={series} shape="rect" />
            <HoverTips>
              <div className="bars">
                {data.entities.map((e) => (
                  <div className="bar-row" key={e.id}>
                    <div className="bar-name">
                      <span>
                        {e.name}
                        {e.isBrand && <span className="badge badge-you">You</span>}
                      </span>
                      <small>{pct(share(e.overall))} overall</small>
                    </div>
                    <div className="bar-group">
                      {series.map((s) => {
                        const r = e.byProvider[s.key as Provider];
                        if (!r) return null;
                        return (
                          <div
                            className="bar-line"
                            key={s.key}
                            tabIndex={0}
                            data-tip-value={`${pct(share(r))} (${r.hits} of ${r.total})`}
                            data-tip-label={`${e.name} · ${s.label}`}
                          >
                            {r.hits > 0 && <span className="bar" style={{ width: `calc((100% - 48px) * ${share(r)})`, background: s.color }} />}
                            <span className="bar-value">{pct(share(r))}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </HoverTips>
            {data.entities.length === 1 && <p className="note">Add competitors in Supabase to compare against them.</p>}
          </Card>

          <Card id="trend" icon="trend" title="Mention rate over time" note={`${brand.name}'s mention rate in ${scopeLabel} answers, per run.`}>
            {data.trend.length < 2 ? (
              <div className="inline-empty">
                <Icon name="trend" />
                <span>Only one run so far. Run <code>npm run track</code> again on another day to see a trend.</span>
              </div>
            ) : (
              <>
                <ul className="legend">
                  {series.map((s) => {
                    const last = data.trend[data.trend.length - 1].byProvider[s.key as Provider];
                    return (
                      <li key={s.key}>
                        <span className="key-line" style={{ background: s.color }} />
                        {s.label} {last === undefined ? "" : `· ${pct(last)} latest`}
                      </li>
                    );
                  })}
                </ul>
                <TrendChart series={series} points={data.trend} />
              </>
            )}
          </Card>

          <div className="two-col">
            <Card id="recommended" icon="sparkles" title="Who AI recommends" note="Every brand named in these answers.">
              <HoverTips>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Brand</th>
                        <th>Answers</th>
                        <th className="num">Avg position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topNames.map((n) => (
                        <tr key={n.name}>
                          <td>
                            {n.name}
                            {n.kind === "brand" && <span className="badge badge-you">You</span>}
                            {n.kind === "competitor" && <span className="badge">Competitor</span>}
                          </td>
                          <td>
                            <div className="inline-bar" tabIndex={0} data-tip-value={`${n.answers} of ${kpis.answers} answers`} data-tip-label={n.name}>
                              <span
                                className="bar"
                                style={{
                                  width: `${(n.answers / data.topNames[0].answers) * 80}px`,
                                  background: n.kind === "brand" ? "var(--you)" : "var(--other)",
                                }}
                              />
                              <span className="bar-value">{n.answers}</span>
                            </div>
                          </td>
                          <td className="num">{n.avgPosition.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </HoverTips>
            </Card>

            <Card id="sources" icon="globe" title="Most-cited websites" note="Getting featured on these helps you get mentioned.">
              {data.topDomains.length === 0 ? (
                <div className="inline-empty">
                  <Icon name="globe" />
                  <span>No sources were cited in these answers.</span>
                </div>
              ) : (
                <HoverTips>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Website</th>
                          <th>Answers citing it</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topDomains.map((d) => (
                          <tr key={d.domain}>
                            <td style={{ overflowWrap: "anywhere" }}>
                              {d.domain}
                              {d.isBrand && <span className="badge badge-you">You</span>}
                            </td>
                            <td>
                              <div className="inline-bar" tabIndex={0} data-tip-value={`${d.answers} of ${kpis.answers} answers`} data-tip-label={d.domain}>
                                <span
                                  className="bar"
                                  style={{
                                    width: `${(d.answers / data.topDomains[0].answers) * 80}px`,
                                    background: d.isBrand ? "var(--you)" : "var(--other)",
                                  }}
                                />
                                <span className="bar-value">{d.answers}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </HoverTips>
              )}
            </Card>
          </div>

          <Card
            id="questions"
            icon="list"
            title="Question by question"
            note={`Tries that mentioned ${brand.name}, and its best position (#1 = named first).`}
          >
            <div className="table-wrap">
              <table className="questions">
                <thead>
                  <tr>
                    <th>Question</th>
                    {series.map((s) => (
                      <th key={s.key} className="num">
                        <span className="key-rect" style={{ background: s.color, marginRight: 6 }} />
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.prompts.map((p) => (
                    <tr key={p.text}>
                      <td>
                        <span className="q-text">{p.text}</span>
                        <span className={`badge badge-${p.type}`}>{p.type}</span>
                      </td>
                      {series.map((s) => {
                        const c = p.byProvider[s.key as Provider];
                        return (
                          <td key={s.key} className="num">
                            {!c ? (
                              <span className="muted">n/a</span>
                            ) : c.hits === 0 ? (
                              <span className="pill pill-miss">0/{c.total}</span>
                            ) : (
                              <span className="pill pill-hit">
                                {c.hits}/{c.total} · #{c.best}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}

function Stat({ icon, label, value, hero, children }: { icon: IconName; label: string; value: string; hero?: boolean; children: ReactNode }) {
  return (
    <div className={`card stat${hero ? " stat-hero" : ""}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="icon-chip"><Icon name={icon} size={16} /></span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{children}</div>
    </div>
  );
}

function Card({ id, icon, title, note, children }: { id: string; icon: IconName; title: string; note: string; children: ReactNode }) {
  return (
    <section id={id} className="card panel">
      <div className="panel-head">
        <span className="icon-chip"><Icon name={icon} size={16} /></span>
        <div>
          <h2>{title}</h2>
          <p className="note">{note}</p>
        </div>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Legend({ series, shape }: { series: { key: string; label: string; color: string }[]; shape: "rect" | "line" }) {
  return (
    <ul className="legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className={shape === "rect" ? "key-rect" : "key-line"} style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
