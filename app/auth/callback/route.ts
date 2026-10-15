import { NextResponse, type NextRequest } from "next/server";
import { authClient, safeNext } from "@/lib/auth";

// The confirmation email links here. Swaps the one-time code for a login session.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  if (code) {
    const supabase = await authClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("error", "That link has expired or was already used. Sign in, or sign up again.");
  return NextResponse.redirect(login);
}
