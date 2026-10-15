"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthState } from "../(auth)/actions";

// Shared sign-in / sign-up form. Errors and messages come back from the server action.
export default function AuthForm({ mode, next, initialError }: { mode: "signin" | "signup"; next?: string; initialError?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "signin" ? signIn : signUp, initialError ? { error: initialError } : undefined);
  const isSignIn = mode === "signin";

  return (
    <div className="auth-card card">
      <div className="auth-mark">AI Visibility</div>
      <h1>{isSignIn ? "Sign in" : "Create an account"}</h1>
      <p className="note">{isSignIn ? "Welcome back. Sign in to see your dashboard." : "Sign up to track how AI tools talk about your brand."}</p>

      {state?.message ? (
        <p className="auth-message" role="status">{state.message}</p>
      ) : (
        <form action={action} className="auth-form">
          {next && <input type="hidden" name="next" value={next} />}
          <label>
            Email
            <input name="email" type="email" autoComplete="email" defaultValue={state?.email} key={state?.email} required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete={isSignIn ? "current-password" : "new-password"} minLength={isSignIn ? undefined : 8} required />
          </label>
          {!isSignIn && (
            <label>
              Confirm password
              <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
            </label>
          )}
          {state?.error && <p className="auth-error" role="alert">{state.error}</p>}
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Please wait…" : isSignIn ? "Sign in" : "Sign up"}
          </button>
        </form>
      )}

      <p className="note auth-switch">
        {isSignIn ? "New here? " : "Already have an account? "}
        <Link href={isSignIn ? "/signup" : "/login"}>{isSignIn ? "Create an account" : "Sign in"}</Link>
      </p>
    </div>
  );
}
