"use server";

import { redirect } from "next/navigation";
import { authClient, safeNext } from "@/lib/auth";
import { writeLog } from "@/lib/activity";

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
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    await writeLog({ id: null, email: email.toLowerCase() }, "signInFailed", { email }, { status: "error", error: error.message });
    return { error: friendly(error.message), email };
  }
  await writeLog({ id: data.user.id, email: data.user.email ?? email }, "signIn", { email });
  redirect(safeNext(form.get("next")));
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  // Accounts are created by the owner (Profile → Users), so sign-up is closed.
  return { error: "Accounts are created by the owner. Ask them to add you.", email: field(form, "email") };
}

export async function signOut() {
  const supabase = await authClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) await writeLog({ id: data.user.id, email: data.user.email ?? null }, "signOut", {});
  await supabase.auth.signOut();
  redirect("/login");
}
