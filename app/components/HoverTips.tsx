"use client";

import { useState, type ReactNode } from "react";

// Shows a tooltip for any child element carrying data-tip-value / data-tip-label.
// Works on hover and on keyboard focus. Text is rendered by React, never as HTML.
type Tip = { value: string; label: string; x: number; y: number };

function tipFrom(target: EventTarget | null, x: number, y: number): Tip | null {
  const el = (target as HTMLElement | null)?.closest?.("[data-tip-value]") as HTMLElement | null;
  if (!el) return null;
  return { value: el.dataset.tipValue ?? "", label: el.dataset.tipLabel ?? "", x, y };
}

export default function HoverTips({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <div
      className="hover-root"
      onPointerMove={(e) => setTip(tipFrom(e.target, e.clientX, e.clientY))}
      onPointerLeave={() => setTip(null)}
      onFocus={(e) => {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        setTip(tipFrom(e.target, rect.right, rect.top));
      }}
      onBlur={() => setTip(null)}
    >
      {children}
      {tip && (
        <div className="tooltip" role="status" style={{ left: tip.x, top: tip.y }}>
          <strong>{tip.value}</strong>
          <span className="tip-label">{tip.label}</span>
        </div>
      )}
    </div>
  );
}
