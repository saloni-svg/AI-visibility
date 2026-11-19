"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addUser, changeMyPassword, changeUserRole, deleteUser, newUserPassword, saveProfile } from "../(dashboard)/actions";

type Fields = { full_name: string | null; phone: string | null; company: string | null; job_title: string | null };
const LABELS: [keyof Fields, string, string][] = [
  ["full_name", "Full name", "e.g. Saloni Shah"],
  ["job_title", "Job title", "e.g. SEO manager"],
  ["company", "Company", "e.g. DigitalRyze"],
  ["phone", "Phone", "e.g. +91 98765 43210"],
];

// Profile details. Email is shown but can never be edited; the other fields only when allowed.
export function ProfileDetails({ userId, email, fields, editable, reason }: { userId: string; email: string; fields: Fields; editable: boolean; reason: string }) {
  const router = useRouter();
  const [form, setForm] = useState(fields);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await saveProfile(userId, form);
    setBusy(false);
    if ("error" in r) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: "Saved." });
    router.refresh();
  }

  return (
    <form className="pf-form" onSubmit={save}>
      <label className="pf-field">
        <span>Email</span>
        <input value={email} readOnly disabled aria-describedby="pf-email-note" />
        <small id="pf-email-note" className="note">🔒 Email can&apos;t be changed.</small>
      </label>
      {LABELS.map(([k, label, ph]) => (
        <label key={k} className="pf-field">
          <span>{label}</span>
          <input value={form[k] ?? ""} placeholder={editable ? ph : "–"} disabled={!editable || busy} maxLength={k === "phone" ? 40 : 120}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        </label>
      ))}
      <div className="pf-actions">
        {editable ? <button type="submit" className="btn-primary btn-small" disabled={busy}>{busy ? "Saving…" : "Save details"}</button> : <p className="note">{reason}</p>}
        {msg && <span className={msg.ok ? "note pf-ok" : "field-error"} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [pw, setPw] = useState({ a: "", b: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.a !== pw.b) return setMsg({ ok: false, text: "The two passwords don't match." });
    setBusy(true); setMsg(null);
    const r = await changeMyPassword(pw.a);
    setBusy(false);
    if ("error" in r) return setMsg({ ok: false, text: r.error });
    setPw({ a: "", b: "" });
    setMsg({ ok: true, text: "Password changed." });
  }
  return (
    <form className="pf-form pf-form-inline" onSubmit={save}>
      <label className="pf-field"><span>New password</span><input type="password" autoComplete="new-password" minLength={8} required value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></label>
      <label className="pf-field"><span>Repeat new password</span><input type="password" autoComplete="new-password" minLength={8} required value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></label>
      <div className="pf-actions">
        <button type="submit" className="btn-secondary btn-small" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
        {msg && <span className={msg.ok ? "note pf-ok" : "field-error"} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}

type Role = "owner" | "admin" | "user";
type UserRow = { id: string; email: string; full_name: string | null; job_title: string | null; role: Role; created_at: string; last_sign_in_at: string | null; logs?: { activity: number; queries: number; last: string | null } };
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never");

// Owner only: add users (with a temporary password shown once), change roles, reset passwords, remove.
export function UsersAdmin({ users, meId, manage = true }: { users: UserRow[]; meId: string; manage?: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", full_name: "", job_title: "", role: "user" as Role });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<{ email: string; password: string; isNew: boolean } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add"); setError(""); setSecret(null);
    const r = await addUser(form);
    setBusy("");
    if ("error" in r) return setError(r.error);
    setSecret({ ...r, isNew: true });
    setForm({ email: "", full_name: "", job_title: "", role: "user" });
    router.refresh();
  }
  async function role(u: UserRow, value: Role) {
    setBusy(u.id); setError("");
    const r = await changeUserRole(u.id, value);
    setBusy("");
    if ("error" in r) setError(r.error);
    router.refresh();
  }
  async function reset(u: UserRow) {
    if (!confirm(`Give ${u.email} a new temporary password? Their current password stops working.`)) return;
    setBusy(u.id); setError(""); setSecret(null);
    const r = await newUserPassword(u.id);
    setBusy("");
    if ("error" in r) return setError(r.error);
    setSecret({ ...r, isNew: false });
  }
  async function remove(u: UserRow) {
    if (!confirm(`Remove ${u.email}? They won't be able to sign in any more. Their logs are kept.`)) return;
    setBusy(u.id); setError("");
    const r = await deleteUser(u.id);
    setBusy("");
    if ("error" in r) return setError(r.error);
    router.refresh();
  }

  return (
    <div className="pf-users">
      {manage && <form className="pf-add" onSubmit={add}>
        <h3>Add a user</h3>
        <div className="pf-add-row">
          <label className="pf-field"><span>Email</span><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" /></label>
          <label className="pf-field"><span>Full name</span><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
          <label className="pf-field"><span>Job title</span><input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} /></label>
          <label className="pf-field"><span>Role</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button type="submit" className="btn-primary pf-add-btn" disabled={busy === "add"}>{busy === "add" ? "Adding…" : "Add user"}</button>
        </div>
        <p className="note pf-role-help">
          {form.role === "user" ? "User: uses the whole app and edits their own details."
            : form.role === "admin" ? "Admin: uses the whole app, edits their own details and those of users."
            : "Owner: everything, plus adding and removing users, choosing roles and seeing everyone's activity and query logs."}
        </p>
      </form>}

      {secret && (
        <div className="pf-secret" role="status">
          <p><b>{secret.isNew ? "User added." : "New password set."}</b> Send these sign-in details to {secret.email}. The password is shown only once; they can change it in their profile.</p>
          <p className="pf-secret-box"><span>Email: <code>{secret.email}</code></span><span>Temporary password: <code>{secret.password}</code></span>
            <button type="button" className="btn-secondary btn-small" onClick={() => navigator.clipboard.writeText(`Sign in at ${window.location.origin}/login\nEmail: ${secret.email}\nPassword: ${secret.password}`)}>Copy</button>
          </p>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}

      <div className="table-wrap">
        <table className="pf-table">
          <thead><tr><th>User</th><th>Role</th><th>Last sign-in</th>{manage && <th>Last action</th>}<th>Added</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.full_name || u.email}</b>{u.full_name && <><br /><span className="note">{u.email}</span></>}{u.job_title && <><br /><span className="note">{u.job_title}</span></>}</td>
                <td>
                  {u.id === meId || !manage ? <span className={`pill ${u.role === "owner" ? "pill-strong" : u.role === "admin" ? "pill-weak" : "pill-shared"}`}>{u.role[0].toUpperCase() + u.role.slice(1)}</span> : (
                    <select value={u.role} disabled={busy === u.id} onChange={(e) => role(u, e.target.value as Role)} aria-label={`Role of ${u.email}`} title={u.role === "owner" ? "Owners can't be removed, but another owner can change their role." : undefined}>
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="user">User</option>
                    </select>
                  )}
                </td>
                <td>{when(u.last_sign_in_at)}</td>
                {manage && <td>{when(u.logs?.last ?? null)}</td>}
                <td>{when(u.created_at)}</td>
                <td className="pf-row-actions">
                  <a className="btn-secondary btn-small" href={`/profile?user=${u.id}`}>Details</a>
                  {manage && <a className="btn-secondary btn-small" href={`/profile?tab=activity&user=${u.id}`}>Activity log ({u.logs?.activity ?? 0})</a>}
                  {manage && <a className="btn-secondary btn-small" href={`/profile?tab=queries&user=${u.id}`}>Query log ({u.logs?.queries ?? 0})</a>}
                  {manage && u.id !== meId && <button type="button" className="btn-secondary btn-small" disabled={busy === u.id} onClick={() => reset(u)}>New password</button>}
                  {u.id !== meId && u.role !== "owner" && (manage || u.role === "user") && <button type="button" className="btn-secondary btn-small pf-danger" disabled={busy === u.id} onClick={() => remove(u)}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
