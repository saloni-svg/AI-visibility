// Is a change in a rate (e.g. 4/30 answers → 12/30) more than chance?
// Two-proportion z-test; p < 0.05 = unlikely to be random variation between checks.

function erf(x: number) {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

export type RateTest = { before: number; after: number; nBefore: number; nAfter: number; diff: number; pValue: number | null; verdict: "significant" | "likely_noise" | "too_few" };

export function compareRates(xBefore: number, nBefore: number, xAfter: number, nAfter: number): RateTest {
  const before = nBefore ? xBefore / nBefore : 0;
  const after = nAfter ? xAfter / nAfter : 0;
  const base = { before, after, nBefore, nAfter, diff: after - before };
  if (nBefore < 5 || nAfter < 5) return { ...base, pValue: null, verdict: "too_few" };
  const pooled = (xBefore + xAfter) / (nBefore + nAfter);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nBefore + 1 / nAfter));
  if (se === 0) return { ...base, pValue: before === after ? 1 : 0, verdict: before === after ? "likely_noise" : "significant" };
  const z = (after - before) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { ...base, pValue: Math.round(pValue * 1000) / 1000, verdict: pValue < 0.05 ? "significant" : "likely_noise" };
}
