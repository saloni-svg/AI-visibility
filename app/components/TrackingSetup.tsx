"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ENGINES, LANGUAGES, MAX_PROMPTS, type Engine } from "@/lib/tracking-shared";
import {
  createTrackingCampaign, deleteTrackingCampaign, importResearchPrompts, searchTrackingCities, suggestTrackingPrompts, updateTrackingCampaign,
} from "../(dashboard)/actions";
import PlatformIcon from "./PlatformIcon";

type Country = { code: string; name: string; flag: string };
type Research = { topic: string; country: string; platform: string; match: string };
export type SetupCampaign = {
  id: string; domain: string; brand_name: string; aliases: string[]; engines: Engine[]; country: string;
  location: { code: number; name: string } | null; language: string; device: string; competitors: string[];
};
type Line = { prompt: string; tags: string[] };

const title = (d: string) => { const r = d.split(".")[0]; return r.charAt(0).toUpperCase() + r.slice(1); };
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// Two-step campaign wizard: targeting, then prompts. Also used to edit a campaign.
export default function TrackingSetup({ mode, domain, campaign, existing, countries, ready, research, onClose }: {
  mode: "new" | "edit"; domain: string; campaign?: SetupCampaign; existing?: { id: string; prompt: string; tags: string[] }[];
  countries: Country[]; ready: Record<Engine, boolean>; research: Research[]; onClose: () => void;
}) {
  const router = useRouter();
  const base = campaign;
  const [step, setStep] = useState<1 | 2>(1);
  const [engines, setEngines] = useState<Engine[]>(base?.engines ?? (ENGINES.filter((e) => ready[e.key]).slice(0, 2).map((e) => e.key)));
  const [country, setCountry] = useState(base?.country ?? "US");
  const [location, setLocation] = useState<{ code: number; name: string } | null>(base?.location ?? null);
  const [cityQ, setCityQ] = useState("");
  const [cities, setCities] = useState<{ code: number; name: string; type: string }[]>([]);
  const [language, setLanguage] = useState(base?.language ?? "en");
  const [device, setDevice] = useState(base?.device ?? "desktop");
  const [brandName, setBrandName] = useState(base?.brand_name ?? title(domain));
  const [aliases, setAliases] = useState((base?.aliases ?? []).join(", "));
  const [competitors, setCompetitors] = useState((base?.competitors ?? []).join(", "));
  const [text, setText] = useState("");
  const [tagged, setTagged] = useState(false);
  const [commonTag, setCommonTag] = useState("");
  const [showTag, setShowTag] = useState(false);
  const [pending, setPending] = useState<Line[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [ideas, setIdeas] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const cityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const langs = LANGUAGES[country] ?? [{ code: "en", name: "English" }];
  const kept = (existing ?? []).filter((p) => !removed.has(p.id));
  const count = kept.length + pending.length;
  const known = useMemo(() => new Set([...kept.map((p) => p.prompt.toLowerCase()), ...pending.map((p) => p.prompt.toLowerCase())]), [kept, pending]);
  const countryName = countries.find((c) => c.code === country)?.name ?? country;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  useEffect(() => { if (!langs.some((l) => l.code === language)) setLanguage(langs[0].code); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  function findCity(q: string) {
    setCityQ(q);
    if (cityTimer.current) clearTimeout(cityTimer.current);
    if (q.trim().length < 2) return setCities([]);
    cityTimer.current = setTimeout(async () => {
      const r = await searchTrackingCities(country, q);
      setCities("error" in r ? [] : r.locations);
    }, 300);
  }

  function addLines(lines: Line[]) {
    const extra = commonTag.trim() ? [commonTag.trim().toLowerCase()] : [];
    const fresh: Line[] = [];
    for (const l of lines) {
      const prompt = l.prompt.trim().replace(/\s+/g, " ");
      if (prompt.length < 3 || known.has(prompt.toLowerCase()) || fresh.some((f) => f.prompt.toLowerCase() === prompt.toLowerCase())) continue;
      fresh.push({ prompt, tags: [...new Set([...l.tags, ...extra])] });
    }
    if (count + fresh.length > MAX_PROMPTS) return setError(`A campaign can track up to ${MAX_PROMPTS} prompts.`);
    setError("");
    setPending((p) => [...p, ...fresh]);
    setIdeas((i) => i.filter((x) => !fresh.some((f) => f.prompt.toLowerCase() === x.toLowerCase())));
  }
  function addFromText() {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      if (!tagged) return { prompt: l, tags: [] };
      const [prompt, tags = ""] = l.split("|");
      return { prompt, tags: list(tags.toLowerCase()) };
    });
    addLines(lines);
    setText("");
  }

  async function suggest() {
    setBusy("suggest"); setError("");
    const r = await suggestTrackingPrompts(domain, brandName, country, [...known]);
    setBusy("");
    if ("error" in r) return setError(r.error);
    setIdeas(r.prompts);
  }
  async function importFrom(i: number) {
    const x = research[i];
    if (!x) return;
    setBusy("import"); setError("");
    const r = await importResearchPrompts(x.topic, x.country, x.platform, x.match);
    setBusy("");
    if ("error" in r) return setError(r.error);
    setIdeas(r.prompts.filter((p) => !known.has(p.toLowerCase())));
  }

  const input = () => ({ domain, brandName, aliases: list(aliases), engines, country, location, language, device, competitors: list(competitors) });

  async function finish() {
    if (!engines.length) { setStep(1); return setError("Pick at least one AI engine."); }
    setBusy("save"); setError("");
    if (mode === "new") {
      const r = await createTrackingCampaign(input(), pending);
      if ("error" in r) { setBusy(""); return setError(r.error); }
      router.push(`/tracking/${r.id}?start=1`);
    } else {
      const r = await updateTrackingCampaign(base!.id, input(), pending, [...removed]);
      setBusy("");
      if ("error" in r) return setError(r.error);
      onClose();
      router.refresh();
    }
  }
  async function remove() {
    if (!base || !confirm(`Delete this campaign for ${domain}? Its check history is deleted too.`)) return;
    setBusy("delete");
    const r = await deleteTrackingCampaign(base.id);
    if ("error" in r) { setBusy(""); return setError(r.error); }
    router.push("/tracking");
  }

  const targetSummary = `${location ? location.name.split(",")[0] : countryName} · ${engines.length ? engines.map((e) => ENGINES.find((x) => x.key === e)!.label).join(", ") : "no engines"}`;

  return (
    <div className="tr-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="tr-modal" role="dialog" aria-modal="true" aria-labelledby="tr-modal-title">
        <aside className="tr-rail">
          <h2 id="tr-modal-title">{mode === "new" ? "New prompt tracking campaign" : "Campaign settings"}</h2>
          <ol>
            <li>
              <button type="button" aria-current={step === 1 ? "step" : undefined} onClick={() => setStep(1)}>
                <span className="tr-rail-n">{step === 2 ? "✓" : "1"}</span>
                <span><b>Targeting</b>{step === 2 && <small>{targetSummary}</small>}</span>
              </button>
            </li>
            <li>
              <button type="button" aria-current={step === 2 ? "step" : undefined} onClick={() => engines.length && setStep(2)}>
                <span className="tr-rail-n">2</span>
                <span><b>Prompts</b><small>Added: {count}</small></span>
              </button>
            </li>
          </ol>
          <p className="tr-rail-note">Each check asks every prompt to every engine you pick, then reads the answer for your brand, its position, and the sites it cites.</p>
        </aside>

        <div className="tr-body">
          <button type="button" className="tr-close" onClick={onClose} disabled={!!busy} aria-label="Close">×</button>

          {step === 1 ? (
            <div className="tr-step">
              <h3>Targeting</h3>
              <div className="tr-domain">
                <span className="tr-domain-icon" aria-hidden="true">🌐</span>
                <div><b>{domain}</b><span className="note">root domain · pages on any subdomain count as yours</span></div>
              </div>

              <fieldset className="tr-field">
                <legend>AI engines <span className="note">pick one or more</span></legend>
                <div className="tr-engines">
                  {ENGINES.map((e) => {
                    const on = engines.includes(e.key);
                    return (
                      <button key={e.key} type="button" className="tr-engine" aria-pressed={on} disabled={!ready[e.key]}
                        title={ready[e.key] ? undefined : "Add this engine's API key to .env to use it"}
                        onClick={() => setEngines((x) => (on ? x.filter((k) => k !== e.key) : [...x, e.key]))}>
                        <PlatformIcon k={e.key} /> {e.label}{on && <span className="tr-check" aria-hidden="true">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="tr-grid">
                <label className="tr-field">
                  <span className="tr-label">Country</span>
                  <select value={country} onChange={(e) => { setCountry(e.target.value); setLocation(null); setCities([]); setCityQ(""); }}>
                    {countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                  </select>
                </label>
                <label className="tr-field">
                  <span className="tr-label">Language <span className="note">(Google AI Overview)</span></span>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                    {langs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="tr-field">
                <span className="tr-label">City or region <span className="note">(optional, for local businesses)</span></span>
                {location ? (
                  <div className="tr-city-picked">📍 {location.name.replace(/,/g, ", ")} <button type="button" className="link-btn" onClick={() => setLocation(null)}>Change</button></div>
                ) : (
                  <div className="tr-city">
                    <input value={cityQ} onChange={(e) => findCity(e.target.value)} placeholder={`Whole of ${countryName}, or search a city`} />
                    {cities.length > 0 && (
                      <ul>
                        {cities.map((c) => <li key={c.code}><button type="button" onClick={() => { setLocation({ code: c.code, name: c.name }); setCities([]); setCityQ(""); }}>{c.name.replace(/,/g, ", ")} <span className="muted">{c.type}</span></button></li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {engines.includes("ai_overview") && (
                <div className="tr-field">
                  <span className="tr-label">Device <span className="note">(Google AI Overview)</span></span>
                  <div className="seg" role="group" aria-label="Device">
                    {["desktop", "mobile"].map((d) => <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)}>{d === "desktop" ? "Desktop" : "Mobile"}</button>)}
                  </div>
                </div>
              )}

              <div className="tr-grid">
                <label className="tr-field">
                  <span className="tr-label">Brand name</span>
                  <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="How AI refers to you" />
                </label>
                <label className="tr-field">
                  <span className="tr-label">Other names <span className="note">(optional, comma separated)</span></span>
                  <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="e.g. DigitalRyze Agency, Digital Ryze" />
                </label>
              </div>
              <label className="tr-field">
                <span className="tr-label">Competitors to follow <span className="note">(optional, names or domains, comma separated)</span></span>
                <input value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="e.g. WebFX, techmagnate.com" />
              </label>

              {error && <p className="field-error">{error}</p>}
              <div className="tr-foot">
                {mode === "edit" && <button type="button" className="link-btn tr-danger" onClick={remove} disabled={!!busy}>Delete campaign</button>}
                <button type="button" className="tr-next" disabled={!engines.length} onClick={() => { setError(""); setStep(2); }}>Continue to prompts →</button>
              </div>
            </div>
          ) : (
            <div className="tr-step">
              <h3>Prompts</h3>
              <p className="note tr-intro">The questions your customers ask AI. Enter one per line.</p>
              <div className="tr-prompt-tools">
                <div className="seg" role="group" aria-label="Entry mode">
                  <button type="button" aria-pressed={!tagged} onClick={() => setTagged(false)}>Prompts only</button>
                  <button type="button" aria-pressed={tagged} onClick={() => setTagged(true)}>Prompts with tags</button>
                </div>
                <div className="tr-prompt-src">
                  <button type="button" className="btn-secondary btn-small" onClick={suggest} disabled={!!busy}>✨ {busy === "suggest" ? "Reading your site…" : "Suggest with AI"}</button>
                  {research.length > 0 && (
                    <label className="tr-import">
                      <span className="sr-only">Import from Prompt research</span>
                      <select value="" onChange={(e) => importFrom(Number(e.target.value))} disabled={!!busy}>
                        <option value="">{busy === "import" ? "Importing…" : "Import from Prompt research…"}</option>
                        {research.map((r, i) => <option key={`${r.topic}|${r.country}|${r.platform}|${r.match}`} value={i}>{r.topic} ({r.country})</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </div>
              <textarea className="tr-textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={tagged ? "best digital marketing agency in mumbai | agency, local\nis digitalryze good for seo | brand" : "best digital marketing agency in mumbai\ntop seo companies for startups\nis digitalryze good for seo"} />
              <div className="tr-add-row">
                {showTag ? (
                  <label className="tr-common-tag">
                    <span className="note">Tag for all:</span>
                    <input autoFocus value={commonTag} onChange={(e) => setCommonTag(e.target.value)} placeholder="e.g. local" />
                  </label>
                ) : <button type="button" className="tr-dashed" onClick={() => setShowTag(true)}>+ Add common tag</button>}
                {text && <button type="button" className="link-btn" onClick={() => setText("")}>× Clear</button>}
                <button type="button" className="btn-dark btn-small tr-add-btn" onClick={addFromText} disabled={!text.trim()}>Add prompts to campaign</button>
              </div>

              {ideas.length > 0 && (
                <div className="tr-ideas">
                  <div className="tr-ideas-head"><span className="note">Click to add</span><button type="button" className="link-btn" onClick={() => addLines(ideas.map((p) => ({ prompt: p, tags: [] })))}>Add all {ideas.length}</button></div>
                  <div className="tr-ideas-list">{ideas.map((p) => <button key={p} type="button" className="tr-idea" onClick={() => addLines([{ prompt: p, tags: [] }])}>+ {p}</button>)}</div>
                </div>
              )}

              <div className="tr-added-head">
                <h4>Added to campaign <span className="tr-count">{count}</span></h4>
                {pending.length > 0 && <button type="button" className="link-btn" onClick={() => setPending([])}>Remove new</button>}
                <div className="tr-limit"><span>Prompt limit</span><b>{count}/{MAX_PROMPTS}</b><span className="tr-limit-bar"><span style={{ width: `${(count / MAX_PROMPTS) * 100}%` }} /></span></div>
              </div>
              <div className="tr-added">
                {count === 0 ? (
                  <div className="tr-added-empty">
                    <svg viewBox="0 0 64 48" aria-hidden="true"><rect x="6" y="6" width="52" height="36" rx="6" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M14 18h22M14 26h30M14 34h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    <p className="note">No prompts yet. Type some above, ask AI to suggest some, or import them from Prompt research.</p>
                  </div>
                ) : (
                  <table>
                    <thead><tr><th>Prompt</th><th>Tags</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {pending.map((p, i) => (
                        <tr key={`n${p.prompt}`}><td>{p.prompt}</td><td>{p.tags.map((t) => <span key={t} className="tr-tag">{t}</span>)}</td><td><span className="tr-new">New</span></td>
                          <td><button type="button" className="tr-x" aria-label={`Remove ${p.prompt}`} onClick={() => setPending((x) => x.filter((_, j) => j !== i))}>×</button></td></tr>
                      ))}
                      {kept.map((p) => (
                        <tr key={p.id}><td>{p.prompt}</td><td>{p.tags.map((t) => <span key={t} className="tr-tag">{t}</span>)}</td><td className="muted">Tracking</td>
                          <td><button type="button" className="tr-x" aria-label={`Stop tracking ${p.prompt}`} onClick={() => setRemoved((x) => new Set(x).add(p.id))}>×</button></td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {error && <p className="field-error">{error}</p>}
              <div className="tr-foot tr-foot-2">
                <button type="button" className="link-btn" onClick={() => setStep(1)} disabled={!!busy}>← Back to targeting</button>
                <button type="button" className="tr-start" onClick={finish} disabled={!!busy || count === 0}>
                  {busy === "save" ? "Saving…" : mode === "new" ? "Start tracking" : "Save changes"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
