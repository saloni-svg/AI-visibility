"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "../(auth)/actions";
import Icon from "./Icon";

// Top-right profile button: a round avatar (initials). Click it to see who's signed in and open
// the profile, activity log, query log, users (owner) or sign out.
export default function ProfileMenu({ email, name, role }: { email: string; name?: string | null; role?: string | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();
  const initials = (name?.trim() ? name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) : email.slice(0, 1)).toUpperCase();
  const roleText = role ? `${role[0].toUpperCase()}${role.slice(1)}` : null;

  useEffect(() => setOpen(false), [path]); // close after following a link
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className="pm" ref={box}>
      <button type="button" className="pm-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={email}>
        <span className="pm-avatar" aria-hidden="true">{initials}</span>
        <span className="sr-only">Profile menu for {email}</span>
        <svg className="pm-caret" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="pm-menu" role="menu">
          <div className="pm-who">
            <span className="pm-avatar pm-avatar-lg" aria-hidden="true">{initials}</span>
            <div className="pm-who-text">
              {name?.trim() && <b>{name.trim()}</b>}
              <span className="pm-email" title={email}>{email}</span>
              {roleText && <span className={`pill ${role === "owner" ? "pill-strong" : role === "admin" ? "pill-weak" : "pill-shared"}`}>{roleText}</span>}
            </div>
          </div>
          <nav className="pm-links">
            <Link role="menuitem" href="/profile"><Icon name="users" size={15} /> Profile details</Link>
            <Link role="menuitem" href="/profile?tab=activity"><Icon name="list" size={15} /> Activity log</Link>
            <Link role="menuitem" href="/profile?tab=queries"><Icon name="search" size={15} /> Query log</Link>
            {(role === "owner" || role === "admin") && <Link role="menuitem" href="/profile?tab=users"><Icon name="lock" size={15} /> {role === "owner" ? "Manage users" : "Users"}</Link>}
          </nav>
          <form action={signOut} className="pm-signout">
            <button type="submit" role="menuitem"><Icon name="logout" size={15} /> Sign out</button>
          </form>
        </div>
      )}
    </div>
  );
}
