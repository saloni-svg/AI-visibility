// In-memory cache for dashboard data. A page loads a domain's data from
// Supabase once; switching filters then only recalculates. Entries expire
// after 10 minutes and are cleared whenever that domain's data changes.
const TTL_MS = 10 * 60_000;
const g = globalThis as unknown as { __aivCache?: Map<string, { at: number; value: Promise<unknown> }> };
const store = (g.__aivCache ??= new Map());

export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: Date.now(), value });
  value.catch(() => store.delete(key)); // never keep a failed load
  return value;
}

// Keys look like "<kind>|<domain>|<run>". Clear one domain, or everything.
export function clearCache(domain?: string) {
  for (const key of [...store.keys()]) if (!domain || key.split("|")[1] === domain) store.delete(key);
}
