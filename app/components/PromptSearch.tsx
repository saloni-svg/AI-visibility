"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { researchPrompts } from "../(dashboard)/actions";

type Country = { code: string; name: string; flag: string };
type Recent = { topic: string; country: string; platform: string; match: string };

const PLATFORMS = [
  { key: "all", label: "All AI" },
  { key: "google", label: "AI Overviews" },
  { key: "chat_gpt", label: "ChatGPT" },
];
const EXAMPLES = ["crm software", "ai seo", "running shoes", "home insurance", "project management"];
const STEPS = [
  "Pulling real prompts from Google AI Overviews and ChatGPT",
  "Measuring AI search volume and 12-month trends",
  "Grouping prompts into topics and reading their intent",
  "Collecting the brands and websites the answers cite",
];

export const promptsHref = (topic: string, country: string, platform: string, match = "broad") =>
  `/prompts?q=${encodeURIComponent(topic.trim().toLowerCase())}&country=${country}&platform=${platform}${match === "exact" ? "&match=exact" : ""}`;
export const MATCH_HELP = {
  broad: "Broad: prompts where the topic appears in the question or in the AI's answer (how Semrush counts). More prompts, some only loosely related; relevance sorts them.",
  exact: "Exact: only prompts whose question itself asks about the topic. Fewer prompts, all on-topic.",
};

// Topic box with country and AI platform. The hero variant is the first page; the bar sits
// above a report and runs the research when there's no saved result yet.
export default function PromptSearch({ variant, q, country, platform, match, countries, recent, autoRun }: {
  variant: "hero" | "bar"; q: string; country: string; platform: string; match: string; countries: Country[]; recent: Recent[]; autoRun: boolean;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState(q);
  const [c, setC] = useState(country);
  const [p, setP] = useState(platform);
  const [m, setM] = useState(match);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const ran = useRef(false);
  const chatGptOff = c !== "US";

  async function run() {
    setBusy(true);
    setError("");
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    const r = await researchPrompts(q, country, platform, match);
    clearInterval(timer);
    setBusy(false);
    if ("error" in r) return setError(r.error);
    router.refresh();
  }
  useEffect(() => {
    if (autoRun && !ran.current) { ran.current = true; run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(t: string) {
    const k = t.trim();
    if (k.length < 2) return setError("Enter a topic, for example \"crm software\".");
    router.push(promptsHref(k, c, chatGptOff && p === "chat_gpt" ? "all" : p, m));
  }

  const form = (
    <form className={`pr-form ${variant === "hero" ? "pr-form-hero" : ""}`} onSubmit={(e) => { e.preventDefault(); go(topic); }}>
      <div className="pr-input">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <label htmlFor="pr-q" className="sr-only">Topic</label>
        <input id="pr-q" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Enter a topic, e.g. crm software" autoComplete="off" />
      </div>
      <div className="pr-form-row">
        <label><span className="sr-only">Country</span>
          <select value={c} onChange={(e) => setC(e.target.value)}>
            {countries.map((x) => <option key={x.code} value={x.code}>{x.flag} {x.name}</option>)}
          </select>
        </label>
        <div className="seg" role="group" aria-label="AI platform">
          {PLATFORMS.map((x) => (
            <button key={x.key} type="button" aria-pressed={p === x.key} onClick={() => setP(x.key)}
              disabled={x.key === "chat_gpt" && chatGptOff} title={x.key === "chat_gpt" && chatGptOff ? "ChatGPT prompts are only available for the United States" : undefined}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Match">
          {(["broad", "exact"] as const).map((x) => (
            <button key={x} type="button" aria-pressed={m === x} onClick={() => setM(x)} title={MATCH_HELP[x]}>{x === "broad" ? "Broad" : "Exact"}</button>
          ))}
        </div>
        <button type="submit" className="btn-dark pr-go" disabled={busy}>Analyze</button>
      </div>
    </form>
  );

  if (variant === "hero") {
    return (
      <>
        <section className="pr-hero">
          <div className="pr-hero-copy">
            <p className="pr-kicker"><span aria-hidden="true" /> Prompt research</p>
            <h1 className="pr-hero-title">Find the questions AI is answering <em>about your market</em></h1>
            <p className="pr-hero-sub">
              Enter a topic to see the real prompts people send to Google AI Overviews and ChatGPT: how much AI demand
              each has, the intent behind it, and which brands and websites the answers rely on.
            </p>
            {form}
            {error && <p className="field-error">{error}</p>}
            <div className="pr-try">
              <span className="note">Try</span>
              {EXAMPLES.map((x) => <button key={x} type="button" className="pr-chip" onClick={() => { setTopic(x); go(x); }}>{x}</button>)}
            </div>
            {recent.length > 0 && (
              <div className="pr-try">
                <span className="note">Recent</span>
                {recent.map((r) => (
                  <Link key={`${r.topic}|${r.country}|${r.platform}|${r.match}`} className="pr-chip pr-chip-recent" href={promptsHref(r.topic, r.country, r.platform, r.match)}>
                    {r.topic} <span className="muted">{r.country}{r.match === "exact" ? " · exact" : ""}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <HeroArt />
        </section>

        <section className="pr-how" aria-label="What you get">
          <article className="card pr-how-card">
            <span className="pr-how-n">01</span>
            <h2>AI demand, not guesses</h2>
            <p className="note">Every prompt comes with its AI search volume and a 12-month trend, so you can see which questions are growing.</p>
            <MiniBars />
          </article>
          <article className="card pr-how-card">
            <span className="pr-how-n">02</span>
            <h2>Topics and intent</h2>
            <p className="note">Prompts are grouped into topics, ranked by how closely they match your topic, and split by intent: learn, compare, buy, find or do.</p>
            <MiniTopics />
          </article>
          <article className="card pr-how-card">
            <span className="pr-how-n">03</span>
            <h2>Who AI recommends</h2>
            <p className="note">See the brands named in the answers and the websites AI cites as sources: the places your content needs to appear.</p>
            <MiniSources />
          </article>
        </section>
      </>
    );
  }

  return (
    <>
      {form}
      {busy && (
        <div className="card pr-loading" role="status">
          <div className="pr-loading-head">
            <b>Researching “{q}”</b>
            <span className="note">{elapsed}s · usually 15–60 seconds</span>
          </div>
          <div className="progress"><span className="pr-indeterminate" /></div>
          <ul className="pr-steps">
            {STEPS.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
      {recent.length > 1 && !busy && (
        <nav className="pr-try pr-recent" aria-label="Recent research">
          <span className="note">Recent</span>
          {recent.map((r) => (
            <Link key={`${r.topic}|${r.country}|${r.platform}|${r.match}`} className="pr-chip pr-chip-recent" href={promptsHref(r.topic, r.country, r.platform, r.match)}
              aria-current={r.topic === q && r.country === country && r.platform === platform && r.match === match ? "true" : undefined}>
              {r.topic} <span className="muted">{r.country}{r.match === "exact" ? " · exact" : ""}</span>
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}

// Decorative: stacked prompt cards with an intent tag and a demand bar.
function HeroArt() {
  const cards = [
    { text: "best crm for a 10-person sales team?", tag: "Commercial", cls: "commercial", w: 82, src: "ChatGPT" },
    { text: "what is generative engine optimization", tag: "Informational", cls: "informational", w: 64, src: "AI Overview" },
    { text: "write a follow-up email after a demo", tag: "Task", cls: "task", w: 38, src: "ChatGPT" },
  ];
  return (
    <div className="pr-hero-art" aria-hidden="true">
      <div className="pr-orbit" />
      {cards.map((c, i) => (
        <div key={c.text} className={`pr-bubble pr-bubble-${i}`}>
          <div className="pr-bubble-top">
            <span className={`pr-intent ${c.cls}`}>{c.tag}</span>
            <span className="pr-bubble-src">{c.src}</span>
          </div>
          <p>{c.text}</p>
          <div className="pr-bubble-bar"><span style={{ width: `${c.w}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function MiniBars() {
  const v = [30, 38, 34, 46, 52, 49, 61, 66, 72, 70, 84, 92];
  return (
    <svg className="pr-how-art" viewBox="0 0 240 70" aria-hidden="true">
      {v.map((h, i) => <rect key={i} x={i * 20 + 2} y={68 - h * 0.7} width="14" height={h * 0.7} rx="3" fill={i > 8 ? "var(--mint, var(--accent))" : "var(--other)"} />)}
    </svg>
  );
}
function MiniTopics() {
  return (
    <svg className="pr-how-art" viewBox="0 0 240 70" aria-hidden="true">
      <circle cx="60" cy="36" r="28" fill="var(--pr-informational)" opacity="0.85" />
      <circle cx="122" cy="30" r="20" fill="var(--pr-commercial)" opacity="0.85" />
      <circle cx="170" cy="46" r="14" fill="var(--pr-transactional)" opacity="0.85" />
      <circle cx="206" cy="26" r="10" fill="var(--pr-task)" opacity="0.85" />
      <circle cx="226" cy="54" r="7" fill="var(--pr-navigational)" opacity="0.85" />
    </svg>
  );
}
function MiniSources() {
  const rows = [92, 70, 54, 38];
  return (
    <svg className="pr-how-art" viewBox="0 0 240 70" aria-hidden="true">
      {rows.map((w, i) => (
        <g key={i}>
          <circle cx="8" cy={i * 17 + 9} r="5" fill="var(--other)" />
          <rect x="20" y={i * 17 + 5} width={w * 2.2} height="8" rx="4" fill={i === 0 ? "var(--mint, var(--accent))" : "var(--other)"} />
        </g>
      ))}
    </svg>
  );
}
