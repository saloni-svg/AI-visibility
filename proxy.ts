import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Runs before every page: refreshes the Supabase login session and sends
// signed-out visitors to /login. Signed-in visitors skip the login pages.
const PUBLIC_PATHS = ["/login", "/signup", "/auth/"];

export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    // Fail closed: never show the dashboard when login can't be checked.
    return new NextResponse("Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to .env, then restart npm run dev.", {
      status: 500,
    });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p));

  let redirectTo: URL | null = null;
  if (!user && !isPublic) {
    redirectTo = new URL("/login", request.url);
    const target = path + request.nextUrl.search;
    if (target !== "/") redirectTo.searchParams.set("next", target);
  } else if (user && (path === "/login" || path === "/signup")) {
    redirectTo = new URL("/", request.url);
  }
  if (!redirectTo) return response;

  // Keep any refreshed session cookies on the redirect.
  const redirect = NextResponse.redirect(redirectTo);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  // Everything except Next.js build files and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
