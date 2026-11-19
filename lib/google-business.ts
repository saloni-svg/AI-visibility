import { clearCache } from "./cache";
import { matchesDomain } from "./data";
import { requireEnv } from "./env";
import { db } from "./supabase";

// Google Business Profile API: posts review replies straight to Google.
// The owner or a manager of the listing signs in with Google once per brand (OAuth, scope
// business.manage); the refresh token is stored and used from then on.
// Reviews are still fetched with DataForSEO, so the first reply to a review finds that review
// in the Business Profile API (by reviewer name and text) and remembers its id.
// Setup: Google Cloud project with the Business Profile API approved → enable "My Business
// Account Management API", "My Business Business Information API" and "Google My Business API";
// create an OAuth client (Web application) with redirect URI <app>/google/callback.

export const hasGoogleOAuth = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/business.manage"];

export const redirectUri = (origin: string) => process.env.GOOGLE_REDIRECT_URI || `${origin}/google/callback`;

export function authUrl(state: string, redirect: string, scopes: string[] = SCOPES) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"), redirect_uri: redirect, response_type: "code",
    scope: scopes.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  }).toString();
  return u.toString();
}

export async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: requireEnv("GOOGLE_CLIENT_ID"), client_secret: requireEnv("GOOGLE_CLIENT_SECRET"), ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`);
  return data as { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; scope?: string };
}

// Swaps the sign-in code for tokens and saves them for the brand.
export async function saveConnection(brandId: string, code: string, redirect: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirect });
  // Google lets people untick single permissions on its consent screen; without this one nothing works.
  if (!String((t as { scope?: string }).scope ?? "").split(" ").includes("https://www.googleapis.com/auth/business.manage")) {
    throw new Error("Google didn't grant access to your Business Profile. Click Connect again and, on Google's screen, tick the box \"See, edit, create and delete your Google business listings\" before pressing Continue.");
  }
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.");
  let email: string | null = null;
  try { email = JSON.parse(Buffer.from(t.id_token!.split(".")[1], "base64url").toString()).email ?? null; } catch { /* no id token */ }
  const { error } = await db().from("google_business_connections").upsert({
    brand_id: brandId, google_email: email, refresh_token: t.refresh_token, access_token: t.access_token,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    account: null, location: null, location_title: null, location_address: null, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  clearCache();
}

type Conn = { brand_id: string; google_email: string | null; refresh_token: string; access_token: string | null; expires_at: string | null; account: string | null; location: string | null; location_title: string | null; location_address: string | null };

async function connection(brandId: string): Promise<Conn | null> {
  const { data } = await db().from("google_business_connections").select("*").eq("brand_id", brandId).maybeSingle();
  return (data as Conn) ?? null;
}

// What the page may show (never the tokens).
export async function connectionInfo(brandId: string) {
  const c = await connection(brandId).catch(() => null);
  return c ? { email: c.google_email, location: c.location, title: c.location_title, address: c.location_address } : null;
}

export async function disconnectGoogleBusiness(brandId: string) {
  const c = await connection(brandId);
  if (c) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.refresh_token)}`, { method: "POST" }).catch(() => null);
  await db().from("google_business_connections").delete().eq("brand_id", brandId);
  clearCache();
}

async function accessToken(c: Conn) {
  if (c.access_token && c.expires_at && new Date(c.expires_at).getTime() > Date.now()) return c.access_token;
  const t = await tokenRequest({ refresh_token: c.refresh_token, grant_type: "refresh_token" }).catch((e) => {
    throw new Error(`${e.message}. Connect Google Business Profile again.`);
  });
  await db().from("google_business_connections").update({
    access_token: t.access_token, expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
  }).eq("brand_id", c.brand_id);
  return t.access_token;
}

async function gapi(c: Conn, url: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${await accessToken(c)}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error(`Google Business Profile: ${msg} (enable it in Google Cloud Console → APIs & Services → Library).`);
    throw new Error(`Google Business Profile: ${msg}`);
  }
  return data;
}

export type GbpLocation = { account: string; location: string; title: string; address: string | null; website: string | null; placeId: string | null; mapsUri: string | null; match: boolean };

// Every Business Profile location the signed-in Google account can manage; the ones that match
// this brand's Google listing (place id / Maps id) or website first.
export async function listLocations(brandId: string): Promise<GbpLocation[]> {
  const c = await connection(brandId);
  if (!c) throw new Error("Connect Google Business Profile first.");
  const [{ data: src }, { data: brand }] = await Promise.all([
    db().from("review_sources").select("place_id, cid, title").eq("brand_id", brandId).eq("platform", "google").maybeSingle(),
    db().from("brands").select("domain").eq("id", brandId).single(),
  ]);
  const accounts: { name: string }[] = [];
  for (let token = ""; ;) {
    const r = await gapi(c, `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20${token ? `&pageToken=${token}` : ""}`);
    accounts.push(...(r.accounts ?? []));
    if (!(token = r.nextPageToken)) break;
  }
  const out: GbpLocation[] = [];
  for (const a of accounts) {
    for (let token = ""; ;) {
      const r = await gapi(c, `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?pageSize=100&readMask=name,title,storefrontAddress,websiteUri,metadata${token ? `&pageToken=${token}` : ""}`);
      for (const l of r.locations ?? []) {
        const addr = l.storefrontAddress ? [...(l.storefrontAddress.addressLines ?? []), l.storefrontAddress.locality, l.storefrontAddress.postalCode].filter(Boolean).join(", ") : null;
        const website = l.websiteUri ? String(l.websiteUri).replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") : null;
        const placeId = l.metadata?.placeId ?? null;
        const mapsUri = l.metadata?.mapsUri ?? null;
        const match = (!!placeId && placeId === src?.place_id) || (!!src?.cid && !!mapsUri && mapsUri.includes(`cid=${src.cid}`))
          || (!!website && !!brand?.domain && matchesDomain(website, brand.domain));
        out.push({ account: a.name, location: l.name, title: l.title, address: addr, website, placeId, mapsUri, match });
      }
      if (!(token = r.nextPageToken)) break;
    }
  }
  return out.sort((x, y) => Number(y.match) - Number(x.match));
}

export async function chooseLocation(brandId: string, l: { account: string; location: string; title: string; address: string | null }) {
  if (!/^accounts\/[\w-]+$/.test(l.account) || !/^locations\/[\w-]+$/.test(l.location)) throw new Error("Invalid location.");
  const { error } = await db().from("google_business_connections").update({
    account: l.account, location: l.location, location_title: l.title, location_address: l.address, updated_at: new Date().toISOString(),
  }).eq("brand_id", brandId);
  if (error) throw error;
  clearCache();
}

// After sign-in: picks the location automatically when exactly one matches the brand.
export async function autoChooseLocation(brandId: string): Promise<"chosen" | "pick"> {
  const all = await listLocations(brandId);
  const matched = all.filter((l) => l.match);
  const pick = matched.length === 1 ? matched[0] : all.length === 1 ? all[0] : null;
  if (!pick) return "pick";
  await chooseLocation(brandId, pick);
  return "chosen";
}

// ---- Posting replies ----
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
// Google adds "(Translated by Google) …" to translated reviews; compare the original words only.
// Letters and digits only, in any script (names and reviews are often not in English).
const normalize = (t: string) => t.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const words = (t: string | null | undefined) => normalize(String(t ?? "").replace(/\(Translated by Google\)[\s\S]*?(\(Original\))?/i, "").replace(/<br\s*\/?>/gi, " "));

type GReview = { name: string; reviewer?: { displayName?: string; isAnonymous?: boolean }; starRating?: string; comment?: string; createTime?: string; reviewReply?: { comment: string; updateTime?: string } };

// Finds our review (fetched from DataForSEO) among the location's Business Profile reviews.
async function findGoogleReview(c: Conn, r: { author: string | null; text: string | null; rating: number | null; published_at: string | null }): Promise<GReview> {
  const parent = `${c.account}/${c.location}`;
  const name = normalize(r.author ?? "");
  const text = words(r.text);
  const when = r.published_at ? new Date(r.published_at).getTime() : null;
  const candidates: GReview[] = [];
  for (let token = "", pages = 0; pages < 40; pages++) {
    const res = await gapi(c, `https://mybusiness.googleapis.com/v4/${parent}/reviews?pageSize=50&orderBy=updateTime%20desc${token ? `&pageToken=${token}` : ""}`);
    for (const g of (res.reviews ?? []) as GReview[]) {
      if (!name || normalize(g.reviewer?.displayName ?? "") !== name) continue;
      const gText = words(g.comment);
      if (text && gText && (gText === text || gText.startsWith(text.slice(0, 80)) || text.startsWith(gText.slice(0, 80)))) return g; // same words: certain
      candidates.push(g);
    }
    if (!(token = res.nextPageToken)) break;
  }
  // Same reviewer, no text to compare: accept when the stars match and the date is close (or it's the only one).
  const close = candidates.filter((g) => (!r.rating || STARS[g.starRating ?? ""] === r.rating)
    && (!when || !g.createTime || Math.abs(new Date(g.createTime).getTime() - when) < 3 * 86_400_000));
  if (close.length === 1) return close[0];
  throw new Error(close.length > 1
    ? `Found several reviews by ${r.author} on Google and couldn't tell which one this is. Reply on Google directly.`
    : `Couldn't find this review by ${r.author ?? "this reviewer"} in the Business Profile for ${c.location_title ?? "this location"}. Check the right location is connected.`);
}

// Posts (or, if the review was already found, updates) the reply on Google and saves it.
export async function postReply(brandId: string, reviewId: string, text: string) {
  const comment = text.trim();
  if (!comment) throw new Error("Write a reply first.");
  if (comment.length > 4000) throw new Error("Replies can be at most 4,000 characters.");
  const c = await connection(brandId);
  if (!c) throw new Error("Connect Google Business Profile first.");
  if (!c.account || !c.location) throw new Error("Choose which Business Profile location this brand is.");
  const { data: r, error } = await db().from("reviews").select("id, author, text, rating, published_at, owner_reply, gbp_review_name").eq("id", reviewId).eq("brand_id", brandId).single();
  if (error || !r) throw new Error("Review not found.");

  let name = r.gbp_review_name as string | null;
  if (!name) {
    const g = await findGoogleReview(c, r);
    name = g.name;
    if (g.reviewReply?.comment) {
      // Replied on Google since our last fetch: show that reply instead of overwriting it.
      await db().from("reviews").update({ gbp_review_name: name, owner_reply: g.reviewReply.comment, owner_reply_at: g.reviewReply.updateTime ?? new Date().toISOString() }).eq("id", reviewId);
      clearCache();
      throw new Error("This review already has a reply on Google, so nothing was posted. Its reply is now shown here.");
    }
  }
  const res = await gapi(c, `https://mybusiness.googleapis.com/v4/${name}/reply`, { method: "PUT", body: { comment } });
  const now = new Date().toISOString();
  await db().from("reviews").update({
    gbp_review_name: name, owner_reply: res.comment ?? comment, owner_reply_at: res.updateTime ?? now, reply_posted_at: now, ai_reply: comment,
  }).eq("id", reviewId);
  clearCache();
}
