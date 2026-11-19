// Windsor.ai Connectors API: real Google Search Console and Google Analytics 4 data for the SEO
// agent, through the accounts connected in Windsor.ai (onboard.windsor.ai).
// Setup (.env): WINDSOR_API_KEY. Requests: GET https://connectors.windsor.ai/{connector}
// ?api_key=…&fields=a,b&date_from=YYYY-MM-DD&date_to=…&select_accounts=…&filter=[…]
// Response: {"data":[{…}]}; errors: {"error":{"code","message"}} or {"error":"…"}.
// Limits: 600 requests/minute, 10,000/day.

const BASE = "https://connectors.windsor.ai";
export const hasWindsor = () => !!process.env.WINDSOR_API_KEY;

export type WindsorQuery = {
  fields: string[];
  from?: string; to?: string;   // YYYY-MM-DD
  preset?: string;              // e.g. last_30d (used when from/to aren't given)
  accounts?: string[];          // select_accounts
  filter?: unknown[];           // [["field","eq","value"], "and", …]
  maxRows?: number;
};

function message(body: any, status: number) {
  const e = body?.error;
  const text = typeof e === "string" ? e : e?.message ?? body?.message ?? body?.detail ?? `HTTP ${status}`;
  return `Windsor.ai: ${text}`;
}

// One request. Retries on rate limits and server errors. The API key is never put in error text.
export async function windsor(connector: string, q: WindsorQuery): Promise<Record<string, any>[]> {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) throw new Error("Add WINDSOR_API_KEY to .env (Windsor.ai → account settings → API key).");
  const p = new URLSearchParams({ api_key: key, fields: q.fields.join(","), _renderer: "json" });
  if (q.from) { p.set("date_from", q.from); if (q.to) p.set("date_to", q.to); } else p.set("date_preset", q.preset ?? "last_30d");
  if (q.accounts?.length) p.set("select_accounts", q.accounts.join(","));
  if (q.filter) p.set("filter", JSON.stringify(q.filter));
  if (q.maxRows) p.set("_max_rows", String(q.maxRows));

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${connector}?${p}`, { headers: { "User-Agent": "Windsor/1.0" }, signal: AbortSignal.timeout(180_000) });
    } catch (err) {
      if (attempt >= 2) throw new Error(`Couldn't reach Windsor.ai (${(err as Error).name === "TimeoutError" ? "timed out" : "network error"}).`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    const body: any = await res.json().catch(() => null);
    if (res.ok && body && !body.error) return Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
    throw new Error(message(body, res.status));
  }
}

// The field ids a connector offers (cached for a day), to pick names that exist.
const fieldCache = new Map<string, { at: number; ids: Set<string> }>();
export async function windsorFields(connector: string): Promise<Set<string> | null> {
  const hit = fieldCache.get(connector);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.ids;
  try {
    const res = await fetch(`${BASE}/${connector}/fields?api_key=${encodeURIComponent(process.env.WINDSOR_API_KEY ?? "")}`, { signal: AbortSignal.timeout(30_000) });
    const body: any = await res.json();
    const list: any[] = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.fields) ? body.fields : [];
    const ids = new Set(list.map((f) => (typeof f === "string" ? f : f?.id ?? f?.field ?? f?.name)).filter(Boolean).map(String));
    if (!ids.size) return null;
    fieldCache.set(connector, { at: Date.now(), ids });
    return ids;
  } catch {
    return null;
  }
}

// First candidate the connector has (or the first candidate if the list can't be read).
export async function pickField(connector: string, candidates: string[]): Promise<string | null> {
  const ids = await windsorFields(connector);
  if (!ids) return candidates[0];
  return candidates.find((c) => ids.has(c)) ?? null;
}

export type WindsorAccount = { id: string; name: string; hosts?: string[]; volume: number };

// Accounts connected in Windsor.ai for a connector, with recent volume (clicks or sessions).
export async function windsorAccounts(connector: "searchconsole" | "googleanalytics4"): Promise<WindsorAccount[]> {
  const gsc = connector === "searchconsole";
  const rows = await windsor(connector, {
    fields: gsc ? ["account_id", "account_name", "clicks"] : ["account_id", "account_name", "hostname", "sessions"],
    preset: "last_30d", maxRows: 5000,
  });
  const out = new Map<string, WindsorAccount>();
  for (const r of rows) {
    const id = String(r.account_id ?? r.site ?? "");
    if (!id) continue;
    const a = out.get(id) ?? { id, name: String(r.account_name ?? id), hosts: [], volume: 0 };
    a.volume += Number(gsc ? r.clicks : r.sessions) || 0;
    if (r.hostname && !a.hosts!.includes(String(r.hostname))) a.hosts!.push(String(r.hostname));
    out.set(id, a);
  }
  return [...out.values()].sort((a, b) => b.volume - a.volume);
}

// "sc-domain:example.com", "https://www.example.com/", "www.example.com" -> "example.com"
export const hostOf = (s: string) => s.toLowerCase().replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/:].*$/, "");
const sameSite = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

// The account that belongs to a domain: Search Console by its site URL, GA4 by the hostnames
// it records (most sessions on the domain wins), falling back to the account name.
export function matchAccount(accounts: WindsorAccount[], domain: string): WindsorAccount | null {
  const d = hostOf(domain);
  const byId = accounts.filter((a) => sameSite(hostOf(a.id), d) || sameSite(hostOf(a.name), d));
  if (byId.length) return byId.sort((a, b) => Number(a.id.startsWith("sc-domain:") ? 0 : 1) - Number(b.id.startsWith("sc-domain:") ? 0 : 1) || b.volume - a.volume)[0];
  const byHost = accounts.filter((a) => a.hosts?.some((h) => sameSite(hostOf(h), d)));
  if (byHost.length) return byHost.sort((a, b) => b.volume - a.volume)[0];
  const root = d.split(".")[0];
  return accounts.find((a) => a.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(root.replace(/[^a-z0-9]/g, ""))) ?? null;
}
