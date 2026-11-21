// Small chart pieces (plain SVG/CSS, no hooks) used on pages that were mostly text:
// a progress ring, horizontal bars and stacked rows. Work in server and client components.

export const SERIES = ["var(--you)", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];

// Progress ring: value out of total, the share in the middle.
export function Ring({ value, total, label, color = "var(--you)", size = 112 }: { value: number; total: number; label: string; color?: string; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const share = total ? value / total : 0;
  return (
    <div className="mc-ring">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${label}: ${value} of ${total}`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--grid)" strokeWidth="10" />
        {share > 0 && (
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 50 50)" />
        )}
        <text x="50" y="49" textAnchor="middle" className="mc-ring-big">{Math.round(share * 100)}%</text>
        <text x="50" y="64" textAnchor="middle" className="mc-ring-sub">{value} of {total}</text>
      </svg>
      <span className="mc-ring-label">{label}</span>
    </div>
  );
}

// Horizontal bars, longest first as given; value printed at the end of each bar.
export function HBars({ rows, format = (v) => v.toLocaleString("en-IN"), color = "var(--you)" }: {
  rows: { label: string; value: number; color?: string; title?: string }[]; format?: (v: number) => string; color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="mc-hbars">
      {rows.map((r) => (
        <li key={r.label} title={r.title ?? `${r.label}: ${format(r.value)}`}>
          <span className="mc-hbar-label">{r.label}</span>
          <span className="mc-hbar-track"><span className="mc-hbar-fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color ?? color }} /></span>
          <span className="mc-hbar-val">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

// One stacked bar per row (e.g. actions per period split by priority), with a legend.
export function StackRows({ rows, keys }: {
  rows: { label: string; parts: Record<string, number> }[]; keys: { key: string; label: string; color: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => keys.reduce((s, k) => s + (r.parts[k.key] ?? 0), 0)));
  return (
    <div className="mc-stack">
      <ul className="mc-hbars">
        {rows.map((r) => {
          const total = keys.reduce((s, k) => s + (r.parts[k.key] ?? 0), 0);
          return (
            <li key={r.label} title={keys.map((k) => `${k.label}: ${r.parts[k.key] ?? 0}`).join(", ")}>
              <span className="mc-hbar-label">{r.label}</span>
              <span className="mc-hbar-track">
                <span className="mc-stack-bar" style={{ width: `${(total / max) * 100}%` }}>
                  {keys.map((k) => (r.parts[k.key] ? <span key={k.key} style={{ flex: r.parts[k.key], background: k.color }} /> : null))}
                </span>
              </span>
              <span className="mc-hbar-val">{total}</span>
            </li>
          );
        })}
      </ul>
      <p className="mc-legend">{keys.map((k) => <span key={k.key}><i style={{ background: k.color }} />{k.label}</span>)}</p>
    </div>
  );
}
