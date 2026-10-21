// Semi-circle score gauge for the site audit (0–100%).
export default function AuditGauge({ value, change, color = "var(--you)" }: { value: number; change: number | null; color?: string }) {
  const len = Math.PI * 80;
  const v = Math.max(0, Math.min(100, value));
  return (
    <svg viewBox="0 0 200 118" className="aug" role="img" aria-label={`${v}%`}>
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--grid)" strokeWidth="26" />
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={color} strokeWidth="26" strokeDasharray={`${(len * v) / 100} ${len}`} />
      <text x="100" y="84" textAnchor="middle" className="aug-value">{v}%</text>
      <text x="100" y="106" textAnchor="middle" className="aug-sub">
        {change === null ? "first audit" : change === 0 ? "no changes" : `${change > 0 ? "+" : ""}${change}% since last`}
      </text>
    </svg>
  );
}
