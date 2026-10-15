import Link from "next/link";
import type { Dashboard, Provider, Rate, Scope } from "@/lib/dashboard";
import HoverTips from "./HoverTips";
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
  const { scope } = data;
  const { brand, kpis, providers } = data;
  const series = providers.map((p) => ({ key: p, ...PROVIDER_META[p] }));
  const rateNow = share(kpis.mentionRate);
  const deltaPts = kpis.previousRate ? Math.round((rateNow - share(kpis.previousRate)) * 100) : null;
  const scopeLabel = scope === "all" ? "all" : scope;

  return (
    <main>
      <header>
        <h1>AI visibility · {brand.name}</h1>
        <p className="subtitle">How often ChatGPT, Gemini and Perplexity mention {brand.name} when people ask them for recommendations.</p>
      </header>

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

      {kpis.answers === 0 ? (
        <div className="card empty">
          <h2>No {scopeLabel} answers in this run</h2>
          <p className="note">Pick another run or question type.</p>
        </div>
      ) : (
        <>
          <section id="overview" className="grid kpis" aria-label="Summary">
            <div className="card tile-hero">
              <div className="tile-label">Mentioned in</div>
              <div className="tile-value">{pct(rateNow)}</div>
              <div className="tile-sub">
                of {scopeLabel} answers ({kpis.mentionRate.hits} of {kpis.mentionRate.total})
              </div>
              {deltaPts !== null && (
                <div className={`delta ${deltaPts > 0 ? "delta-up" : deltaPts < 0 ? "delta-down" : ""}`}>
                  {deltaPts > 0 ? "▲ +" : deltaPts < 0 ? "▼ " : "■ "}
                  {deltaPts} pts vs previous run
                </div>
              )}
            </div>
            <div className="card">
              <div className="tile-label">Average position when mentioned</div>
              <div className="tile-value">{kpis.avgPosition === null ? "–" : kpis.avgPosition.toFixed(1)}</div>
              <div className="tile-sub">1 = the first brand the AI names</div>
            </div>
            <div className="card">
              <div className="tile-label">Your website cited</div>
              <div className="tile-value">{pct(share(kpis.siteCited))}</div>
              <div className="tile-sub">
                {kpis.siteCited.hits} of {kpis.siteCited.total} answers link to {brand.domain ?? "your domain"}
              </div>
            </div>
            <div className="card">
              <div className="tile-label">Answers analysed</div>
              <div className="tile-value">{kpis.answers}</div>
              <div className="tile-sub">from {providers.map((p) => PROVIDER_META[p].label).join(", ")}</div>
            </div>
          </section>

          <section id="competitors" className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <h2>Mention rate: you vs competitors</h2>
              <p className="note">Share of {scopeLabel} answers from each AI tool that name the brand.</p>
            </div>
            <Legend series={series} shape="rect" />
            <HoverTips>
              <div className="bars">
                {data.entities.map((e) => (
                  <div className="bar-row" key={e.id}>
                    <div className="bar-name">
                      {e.name}
                      {e.isBrand && <span className="badge badge-you">You</span>}
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
            {data.entities.length === 1 && (
              <p className="note">Add competitors in Supabase to compare against them.</p>
            )}
          </section>

          <section id="trend" className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <h2>Your mention rate over time</h2>
              <p className="note">{brand.name}&apos;s mention rate in {scopeLabel} answers, per run.</p>
            </div>
            {data.trend.length < 2 ? (
              <p className="note">Only one run so far. Run <code>npm run track</code> again on another day to see a trend.</p>
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
          </section>

          <div className="grid two">
            <section id="recommended" className="card">
              <div className="card-head">
                <h2>Who AI recommends</h2>
                <p className="note">Every brand named in these answers, by how many answers name it.</p>
              </div>
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
            </section>

            <section id="sources" className="card">
              <div className="card-head">
                <h2>Most-cited websites</h2>
                <p className="note">Sites the AIs used as sources. Being featured on these helps you get mentioned.</p>
              </div>
              {data.topDomains.length === 0 ? (
                <p className="note">No sources were cited in these answers.</p>
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
            </section>
          </div>

          <section id="questions" className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <h2>Question by question</h2>
              <p className="note">
                How many tries mentioned {brand.name}, and its best position (#1 = named first). A dash means not mentioned.
              </p>
            </div>
            <div className="table-wrap">
              <table>
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
                        {p.text}
                        <span className="badge">{p.type}</span>
                      </td>
                      {series.map((s) => {
                        const c = p.byProvider[s.key as Provider];
                        return (
                          <td key={s.key} className="num">
                            {!c ? (
                              <span className="muted">n/a</span>
                            ) : c.hits === 0 ? (
                              <span className="muted">– 0/{c.total}</span>
                            ) : (
                              <span className="cell-hit">
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
          </section>
        </>
      )}
    </main>
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
