"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authClient, safeNext } from "@/lib/auth";

export type AuthState = { error?: string; message?: string; email?: string } | undefined;

// Supabase's own messages are fine to show, except a network failure.
const friendly = (message: string) =>
  /fetch failed|failed to fetch|ENOTFOUND|ECONNREFUSED/i.test(message)
    ? "Couldn't reach Supabase. Check SUPABASE_URL in .env and your internet connection."
    : message;

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = field(form, "email");
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const supabase = await authClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendly(error.message), email };
  redirect(safeNext(form.get("next")));
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = field(form, "email");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (!email || !password) return { error: "Enter your email and a password.", email };
  if (password.length < 8) return { error: "Use a password of at least 8 characters.", email };
  if (password !== confirm) return { error: "The two passwords don't match.", email };

  // Where the confirmation email's link should land.
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  const supabase = await authClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: friendly(error.message), email };

  // Email confirmation off in Supabase: the account is ready straight away.
  if (data.session) redirect("/");
  return { message: `Almost done: we sent a confirmation link to ${email}. Click it, then sign in.` };
}

export async function signOut() {
  const supabase = await authClient();
  await supabase.auth.signOut();
  redirect("/login");
}
