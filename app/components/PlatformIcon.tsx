// Small coloured mark per platform (not official logos).
const COLORS: Record<string, string> = {
  google: "#4285f4", maps: "#34a853", ai_overview: "#8d5db3", openai: "#10a37f", gemini: "#e8710a", perplexity: "#20808d",
};
export default function PlatformIcon({ k }: { k: string }) {
  return <span className="pt-picon" style={{ background: COLORS[k] ?? "var(--other)" }} aria-hidden="true" />;
}
