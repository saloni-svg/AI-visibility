import { NextResponse, type NextRequest } from "next/server";

// Password-protects the whole dashboard with the browser's built-in login box
// (HTTP Basic auth). Any username works; the password is DASHBOARD_PASSWORD.
// Locally, no password is needed unless you set one. On Vercel the site stays
// locked until DASHBOARD_PASSWORD is set, so it is never public by accident.
export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    if (!process.env.VERCEL) return NextResponse.next();
    return new NextResponse("Set DASHBOARD_PASSWORD in your Vercel project settings to open this dashboard.", { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (safeEqual(given, password)) return NextResponse.next();
  }
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AI visibility dashboard", charset="UTF-8"' },
  });
}

// Compares without exiting early, so response time doesn't hint at the password.
function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = {
  // Everything except Next.js build files and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
