"use client";

import { useState } from "react";
import TrendChart from "./TrendChart";

type Entity = { id: string; name: string; isBrand: boolean };
type Mode = "visibility" | "mentions" | "share";
const MODES: { key: Mode; label: string }[] = [
  { key: "visibility", label: "AI Visibility" },
  { key: "mentions", label: "Mentions" },
  { key: "share", label: "Share of voice" },
];

// Per-brand headline numbers with a trend line, switchable between metrics.
export default function CompetitorChart({
  entities,
  colors,
  totals,
  trend,
}: {
  entities: Entity[];
  colors: string[];
  totals: { mentions: number; visibility: number; share: number }[];
  trend: { label: string; visibility: Record<string, number>; mentions: Record<string, number>; share: Record<string, number> }[];
}) {
  const [mode, setMode] = useState<Mode>("visibility");
  const value = (i: number) =>
    mode === "visibility" ? String(totals[i].visibility) : mode === "mentions" ? String(totals[i].mentions) : `${Math.round(totals[i].share * 100)}%`;

  return (
    <div className="card cr-chart">
      <div className="cr-chart-tabs" role="tablist" aria-label="Metric">
        {MODES.map((m) => (
          <button key={m.key} role="tab" aria-selected={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>
        ))}
      </div>
      <div className="cr-stats">
        {entities.map((e, i) => (
          <div key={e.id} className="cr-stat">
            <span className="cr-stat-name"><span className="dot" style={{ background: colors[i] }} />{e.name}</span>
            <span className="cr-stat-value">{value(i)}</span>
          </div>
        ))}
      </div>
      {trend.length < 2 ? (
        <p className="note cr-chart-empty">The trend appears after your second check.</p>
      ) : (
        <TrendChart
          unit={mode === "mentions" ? "count" : "percent"}
          series={entities.map((e, i) => ({ key: e.id, label: e.name, color: colors[i] }))}
          points={trend.map((t) => ({ label: t.label, byProvider: t[mode] }))}
        />
      )}
      <p className="note cr-chart-note">
        {mode === "visibility"
          ? "AI Visibility: 0–100, higher when AI names the brand more often and earlier in its answers."
          : mode === "mentions"
            ? "Mentions: answers that name the brand."
            : "Share of voice: each brand's share of all mentions among the brands compared."}
      </p>
    </div>
  );
}
