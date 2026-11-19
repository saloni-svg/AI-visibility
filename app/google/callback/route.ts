import { NextResponse, type NextRequest } from "next/server";
import { currentUser, safeNext } from "@/lib/auth";
import { findBrand } from "@/lib/brands";
import { autoChooseLocation, redirectUri, saveConnection } from "@/lib/google-business";
import { saveAdsLogin } from "@/lib/keyword-planner";

// Google sends the user back here after sign-in (see /google/connect).
//  Business Profile: saves the tokens for the brand, picks the matching location when there's
//  exactly one, and returns to the reviews page.
//  Google Ads: saves the app-wide sign-in for Keyword Planner and returns to where it started.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  let saved: { state?: string; domain?: string; kind?: string; next?: string } = {};
  try { saved = JSON.parse(request.cookies.get("gbp_oauth")?.value ?? "{}"); } catch { /* bad cookie */ }
  const ads = saved.kind === "ads";
  const domain = saved.domain ?? "";
  const back = new URL(ads ? safeNext(saved.next) : domain ? `/reviews?domain=${encodeURIComponent(domain)}` : "/", request.url);
  const errKey = ads ? "ads_error" : "gbp_error";
  const done = (key?: string, value?: string) => {
    if (key && value) back.searchParams.set(key, value);
    const res = NextResponse.redirect(back);
    res.cookies.set("gbp_oauth", "", { path: "/google", maxAge: 0 });
    return res;
  };

  if (!(await currentUser())) return NextResponse.redirect(new URL("/login", request.url));
  if (p.get("error")) return done(errKey, p.get("error") === "access_denied" ? "Google sign-in was cancelled." : `Google sign-in failed: ${p.get("error")}`);
  if (!saved.state || p.get("state") !== saved.state || !p.get("code")) return done(errKey, "Google sign-in expired. Try Connect again.");
  const redirect = redirectUri(request.nextUrl.origin);

  if (ads) {
    try {
      await saveAdsLogin(p.get("code")!, redirect);
      return done("ads", "connected");
    } catch (err) {
      return done(errKey, (err as Error).message);
    }
  }

  const brand = await findBrand(domain);
  if (!brand) return done();
  try {
    await saveConnection(brand.id, p.get("code")!, redirect);
    const chosen = await autoChooseLocation(brand.id).catch((e) => `error:${(e as Error).message}`);
    if (chosen.startsWith("error:")) return done("gbp_error", chosen.slice(6));
    return done("gbp", chosen);
  } catch (err) {
    return done("gbp_error", (err as Error).message);
  }
}
