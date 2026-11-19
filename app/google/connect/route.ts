import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { currentUser, safeNext } from "@/lib/auth";
import { findBrand } from "@/lib/brands";
import { cleanDomain } from "@/lib/domain";
import { authUrl, hasGoogleOAuth, redirectUri } from "@/lib/google-business";
import { ADS_SCOPE, keywordPlannerConfigured } from "@/lib/keyword-planner";

// Sends the user to Google's sign-in, remembering what it's for in a short-lived cookie (with a
// random state value, checked on the way back):
//   ?domain=x.com            Google Business Profile for that brand (posting review replies)
//   ?kind=ads&next=/path     Google Ads, app-wide (Keyword Planner volume and CPC)
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  if (!(await currentUser())) return NextResponse.redirect(new URL("/login", request.url));
  const state = randomBytes(24).toString("base64url");
  const cookie = (value: object, to: string) => {
    const res = NextResponse.redirect(to);
    res.cookies.set("gbp_oauth", JSON.stringify({ state, ...value }), {
      httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/google", maxAge: 600,
    });
    return res;
  };

  if (p.get("kind") === "ads") {
    const next = safeNext(p.get("next"));
    if (!keywordPlannerConfigured()) {
      const back = new URL(next, request.url);
      back.searchParams.set("ads_error", "Add GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart the app.");
      return NextResponse.redirect(back);
    }
    return cookie({ kind: "ads", next }, authUrl(state, redirectUri(request.nextUrl.origin), ["openid", "email", ADS_SCOPE]));
  }

  const domain = cleanDomain(p.get("domain") ?? "") ?? "";
  const back = new URL(`/reviews?domain=${encodeURIComponent(domain)}`, request.url);
  if (!hasGoogleOAuth()) {
    back.searchParams.set("gbp_error", "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart the app.");
    return NextResponse.redirect(back);
  }
  if (!domain || !(await findBrand(domain))) return NextResponse.redirect(new URL("/", request.url));
  return cookie({ domain }, authUrl(state, redirectUri(request.nextUrl.origin)));
}
