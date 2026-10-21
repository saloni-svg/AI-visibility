"use client";

import { useEffect, useRef, useState } from "react";

type Series = { key: string; label: string; color: string };
type Point = { label: string; byProvider: Record<string, number | undefined> };

const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 40 };
const pct = (v: number) => `${Math.round(v * 100)}%`;

// Line chart of mention rate (0-100%) per run, one 2px line per AI tool, with a
// crosshair that snaps to the nearest run and lists every tool's value.
// unit "count" scales the y axis to the largest value instead of 0-100%.
export default function TrendChart({ series, points, unit = "percent" }: { series: Series[]; points: Point[]; unit?: "percent" | "count" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const peak = Math.max(0, ...points.flatMap((p) => series.map((s) => p.byProvider[s.key] ?? 0)));
  const step = unit === "count" ? Math.max(1, Math.ceil(peak / 4)) : 0.25;
  const top = unit === "count" ? step * 4 : 1;
  const fmt = (v: number) => (unit === "count" ? String(Math.round(v)) : pct(v));
  const y = (v: number) => PAD.top + (1 - v / top) * plotH;

  // Show at most ~6 x-axis labels so they never collide.
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 110))));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  }

  const hovered = hover === null ? null : points[hover];

  return (
    <div className="trend" ref={ref} style={{ position: "relative" }}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={unit === "count" ? "Counts per run" : "Mention rate per run"}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 1, 2, 3, 4].map((i) => i * step).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--grid)"} strokeWidth={1} />
            <text className="axis-text" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={i} className="axis-text" x={x(i)} y={HEIGHT - 8} textAnchor={points.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
              {p.label}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--baseline)" strokeWidth={1} />}
        {series.map((s) => {
          // Break the line where a tool has no answers in a run.
          const segments: string[] = [];
          let current = "";
          points.forEach((p, i) => {
            const v = p.byProvider[s.key];
            if (v === undefined) {
              if (current) segments.push(current);
              current = "";
            } else current += `${current ? "L" : "M"}${x(i)},${y(v)}`;
          });
          if (current) segments.push(current);
          return (
            <g key={s.key}>
              {segments.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {points.map((p, i) => {
                const v = p.byProvider[s.key];
                const isEnd = i === points.length - 1;
                if (v === undefined || (!isEnd && hover !== i && points.length > 1)) return null;
                return <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
              })}
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <div
          className="tooltip"
          style={{ position: "absolute", left: Math.min(x(hover), width - 180), top: PAD.top, transform: "translate(8px, 0)" }}
        >
          <span className="tip-label">{hovered.label}</span>
          {series.map((s) => {
            const v = hovered.byProvider[s.key];
            return (
              <div className="tip-row" key={s.key}>
                <span className="key-line" style={{ background: s.color }} />
                <strong style={{ fontSize: 14 }}>{v === undefined ? "–" : fmt(v)}</strong>
                <span className="tip-label">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
