// Half-circle score gauge (0-100). Colour follows the Low / Medium / High band.
export default function Gauge({ score, band }: { score: number | null; band: string }) {
  const len = Math.PI * 80;
  const value = Math.max(0, Math.min(100, score ?? 0));
  const color = score === null ? "var(--other)" : score < 30 ? "var(--gemini)" : score < 60 ? "var(--c2)" : "var(--good)";
  return (
    <svg viewBox="0 0 200 122" className="gauge" role="img" aria-label={score === null ? "AI visibility score not available" : `AI visibility score ${score} out of 100, ${band}`}>
      <path d="M20 104 A80 80 0 0 1 180 104" fill="none" stroke="var(--grid)" strokeWidth="18" strokeLinecap="round" />
      {score !== null && value > 0 && (
        <path d="M20 104 A80 80 0 0 1 180 104" fill="none" stroke={color} strokeWidth="18" strokeLinecap="round" strokeDasharray={`${(len * value) / 100} ${len}`} />
      )}
      {score === null ? (
        <text x="100" y="96" textAnchor="middle" className="gauge-value">n/a</text>
      ) : (
        <>
          <text x="100" y="70" textAnchor="middle" className="gauge-small" fill={color}>{score} / 100</text>
          <text x="100" y="102" textAnchor="middle" className="gauge-value">{band}</text>
        </>
      )}
    </svg>
  );
}
