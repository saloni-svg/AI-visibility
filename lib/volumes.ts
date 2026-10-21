// Adds up a topic's monthly AI volume over the countries in view.
export type VolumeRow = { topic: string; country: string; volume: number | null; monthly: unknown; source: string | null };
export type TopicVolume = { volume: number; monthly: number[]; source: string | null } | null;

export function topicVolume(rows: VolumeRow[], topic: string, countries: string[]): TopicVolume {
  const list = rows.filter((v) => v.topic === topic && countries.includes(v.country));
  if (!list.length) return null;
  const monthly = new Map<string, number>();
  for (const r of list) for (const m of (r.monthly ?? []) as { month: string; volume: number }[]) monthly.set(m.month, (monthly.get(m.month) ?? 0) + m.volume);
  return {
    volume: list.reduce((s, r) => s + (r.volume ?? 0), 0),
    monthly: [...monthly].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([, v]) => v),
    source: list[0].source,
  };
}
