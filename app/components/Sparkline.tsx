// Tiny area chart of monthly volume.
export default function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="sparkline sparkline-empty" aria-hidden="true" />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 60},${22 - (v / max) * 20}`);
  return (
    <svg className="sparkline" viewBox="0 0 60 24" aria-hidden="true">
      <path d={`M0,24 L${pts.join(" L")} L60,24 Z`} fill="var(--accent-soft)" />
      <path d={`M${pts.join(" L")}`} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
