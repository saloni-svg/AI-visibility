import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnv } from "./env";

// Share links: a read-only view of one report (visibility overview, change explainer, competitor
// research, position tracking) that opens without logging in. The link carries which report,
// the domain and the filters, signed with a server secret so it can't be edited to show another
// domain. Nothing is stored; links stop working after SHARE_DAYS.

export const SHARE_KINDS = ["overview", "changes", "competitors", "positions", "seo"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
export type ShareData = { kind: ShareKind; domain: string; params: Record<string, string>; exp: number };

const SHARE_DAYS = 30;
// Filters each report keeps in its link (anything else is dropped).
const ALLOWED: Record<ShareKind, string[]> = {
  overview: ["run", "country", "platform", "tab", "dist"],
  changes: ["run", "prev"],
  competitors: ["run", "country", "platform"],
  positions: ["country", "run", "project"],
  seo: ["plan"],
};

const secret = () => createHmac("sha256", process.env.SHARE_SECRET || requireEnv("SUPABASE_SERVICE_ROLE_KEY")).update("report-share-v1").digest();
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function createShareToken(kind: ShareKind, domain: string, query: Record<string, string | undefined>): { token: string; expires: string } {
  const params: Record<string, string> = {};
  for (const k of ALLOWED[kind]) if (query[k]) params[k] = String(query[k]).slice(0, 200);
  const exp = Date.now() + SHARE_DAYS * 86_400_000;
  const body = Buffer.from(JSON.stringify({ k: kind, d: domain, p: params, e: exp })).toString("base64url");
  return { token: `${body}.${sign(body)}`, expires: new Date(exp).toISOString() };
}

// The report a link points to, or null if it was altered or has expired.
export function readShareToken(token: string): ShareData | null {
  const [body, sig] = decodeURIComponent(token).split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!SHARE_KINDS.includes(j.k) || typeof j.d !== "string" || typeof j.e !== "number" || j.e < Date.now()) return null;
    return { kind: j.k, domain: j.d, params: j.p ?? {}, exp: j.e };
  } catch {
    return null;
  }
}
