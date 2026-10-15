import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv } from "./env";

// Supabase Auth for the dashboard. Uses the publishable key (not the service
// role key), and keeps the login session in cookies.
export const authConfig = () => ({
  url: requireEnv("SUPABASE_URL"),
  key: requireEnv("SUPABASE_PUBLISHABLE_KEY"),
});

export async function authClient() {
  const store = await cookies();
  const { url, key } = authConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

export async function currentUser() {
  const supabase = await authClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// Only allow redirects to paths on this site, never to another domain.
export function safeNext(value: unknown) {
  const path = typeof value === "string" ? value : "";
  // "//x" and "/\x" are read by browsers as links to another site.
  return /^\/(?![\/\\])/.test(path) ? path : "/";
}
