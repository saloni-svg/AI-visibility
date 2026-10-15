"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "../(auth)/actions";
import Icon from "./Icon";

// Shared sign-in / sign-up form. Errors and messages come back from the server action.
export default function AuthForm({ mode, next, initialError }: { mode: "signin" | "signup"; next?: string; initialError?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "signin" ? signIn : signUp,
    initialError ? { error: initialError } : undefined,
  );
  const [showPassword, setShowPassword] = useState(false);
  const isSignIn = mode === "signin";
  const passwordType = showPassword ? "text" : "password";

  return (
    <div className="auth-card">
      <h1>{isSignIn ? "Welcome back" : "Create your account"}</h1>
      <p className="auth-lead">{isSignIn ? "Sign in to see your AI visibility dashboard." : "Start tracking how AI tools talk about your brand."}</p>

      {state?.message ? (
        <div className="auth-message" role="status">
          <span className="check"><Icon name="mail" size={16} /></span>
          <p>{state.message}</p>
        </div>
      ) : (
        <form action={action} className="auth-form">
          {next && <input type="hidden" name="next" value={next} />}
          <label className="field">
            <span>Email</span>
            <span className="input-wrap">
              <Icon name="mail" size={17} />
              <input name="email" type="email" autoComplete="email" placeholder="you@company.com" defaultValue={state?.email} key={state?.email} required />
            </span>
          </label>
          <label className="field">
            <span>Password</span>
            <span className="input-wrap">
              <Icon name="lock" size={17} />
              <input
                name="password"
                type={passwordType}
                autoComplete={isSignIn ? "current-password" : "new-password"}
                placeholder={isSignIn ? "Your password" : "At least 8 characters"}
                minLength={isSignIn ? undefined : 8}
                required
              />
              <button type="button" className="reveal" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>
                <Icon name={showPassword ? "eyeOff" : "eye"} size={17} />
              </button>
            </span>
          </label>
          {!isSignIn && (
            <label className="field">
              <span>Confirm password</span>
              <span className="input-wrap">
                <Icon name="lock" size={17} />
                <input name="confirm" type={passwordType} autoComplete="new-password" placeholder="Type it again" minLength={8} required />
              </span>
            </label>
          )}
          {state?.error && (
            <p className="auth-error" role="alert">
              <Icon name="alert" size={16} />
              {state.error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Please wait…" : isSignIn ? "Sign in" : "Create account"}
          </button>
        </form>
      )}

      <p className="auth-switch">
        {isSignIn ? "New to AI Visibility? " : "Already have an account? "}
        <Link href={isSignIn ? "/signup" : "/login"}>{isSignIn ? "Create an account" : "Sign in"}</Link>
      </p>
    </div>
  );
}
