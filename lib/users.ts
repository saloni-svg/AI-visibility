import { randomBytes } from "node:crypto";
import { cache } from "react";
import { currentUser } from "./auth";
import { db } from "./supabase";

// Users and roles (table profiles, one row per Supabase Auth user).
//   owner: adds and removes users, sets their role, edits anyone's details, sees everyone's logs.
//   admin: edits their own details and those of users (role "user").
//   user:  edits their own details.
// Nobody can change an email from the app. The main owner is OWNER_EMAIL in .env (default
// salonidigitalryze@gmail.com): always an owner, can't be removed. Owners can make others owners too.

export type Role = "owner" | "admin" | "user";
export const ROLES: Role[] = ["owner", "admin", "user"];
export type Profile = {
  id: string; email: string; full_name: string | null; phone: string | null; company: string | null; job_title: string | null;
  role: Role; created_at: string; updated_at: string; last_seen_at: string | null; created_by: string | null;
};
export type ProfileFields = Pick<Profile, "full_name" | "phone" | "company" | "job_title">;

export const ownerEmail = () => (process.env.OWNER_EMAIL || "salonidigitalryze@gmail.com").trim().toLowerCase();

// The signed-in user's profile, created on first visit (the owner email gets the owner role).
// Cached per request.
export const currentProfile = cache(async (): Promise<Profile | null> => {
  const user = await currentUser();
  if (!user) return null;
  return ensureProfile(user.id, user.email ?? "");
});

async function ensureProfile(id: string, email: string): Promise<Profile | null> {
  const isOwner = email.toLowerCase() === ownerEmail();
  const { data, error } = await db().from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) return null; // table not created yet: the app works as before
  if (!data) {
    const { data: made } = await db().from("profiles")
      .upsert({ id, email, role: isOwner ? "owner" : "user", last_seen_at: new Date().toISOString() }).select("*").single();
    return (made as Profile) ?? null;
  }
  const p = data as Profile;
  const patch: Record<string, unknown> = {};
  if (isOwner && p.role !== "owner") patch.role = "owner"; // the owner can't be locked out
  if (!p.last_seen_at || Date.now() - new Date(p.last_seen_at).getTime() > 5 * 60_000) patch.last_seen_at = new Date().toISOString();
  if (Object.keys(patch).length) await db().from("profiles").update(patch).eq("id", id);
  return { ...p, ...patch } as Profile;
}

// ---- permissions ----
export const canManageUsers = (me: Profile) => me.role === "owner";
export const canSeeEveryone = (me: Profile) => me.role === "owner";
// Removing: nobody can remove an owner; owners remove admins and users; admins remove users.
export const canRemove = (me: { id: string; role: Role }, target: { id: string; role: Role }) =>
  me.id !== target.id && target.role !== "owner" && (me.role === "owner" || (me.role === "admin" && target.role === "user"));

export const canEditProfile = (me: Profile, target: Profile) =>
  me.role === "owner" || me.id === target.id || (me.role === "admin" && target.role === "user");

function need(ok: boolean, message = "Only the owner can do this.") {
  if (!ok) throw new Error(message);
}

// ---- reading ----
export async function getProfile(id: string) {
  const { data, error } = await db().from("profiles").select("*").eq("id", id).single();
  if (error) throw new Error("User not found.");
  return data as Profile;
}

export const canSeeUsers = (me: Profile) => me.role === "owner" || me.role === "admin";

export async function listUsers(me: Profile) {
  need(canSeeUsers(me), "Only the owner and admins can see the user list.");
  const [{ data: rows, error }, auth] = await Promise.all([
    db().from("profiles").select("*").order("created_at"),
    db().auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (error) throw error;
  // Accounts that exist in Supabase Auth but haven't opened the app yet get a profile now.
  const known = new Set((rows ?? []).map((r) => r.id));
  for (const u of auth.data?.users ?? []) if (!known.has(u.id)) await ensureProfile(u.id, u.email ?? "");
  const { data: all } = await db().from("profiles").select("*").order("created_at");
  const signIns = new Map((auth.data?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));
  const counts = new Map<string, { activity: number; queries: number; last: string | null }>();
  await Promise.all(((all ?? []) as Profile[]).map(async (p) => {
    const [a, q, l] = await Promise.all([
      db().from("activity_logs").select("id", { count: "exact", head: true }).eq("user_id", p.id).eq("kind", "activity"),
      db().from("activity_logs").select("id", { count: "exact", head: true }).eq("user_id", p.id).eq("kind", "query"),
      db().from("activity_logs").select("created_at").eq("user_id", p.id).order("created_at", { ascending: false }).limit(1),
    ]);
    counts.set(p.id, { activity: a.count ?? 0, queries: q.count ?? 0, last: (l.data?.[0]?.created_at as string) ?? null });
  }));
  const order: Record<Role, number> = { owner: 0, admin: 1, user: 2 };
  return ((all ?? []) as Profile[]).map((p) => ({ ...p, last_sign_in_at: signIns.get(p.id) ?? null, logs: counts.get(p.id) ?? { activity: 0, queries: 0, last: null } }))
    .sort((a, b) => order[a.role] - order[b.role] || a.email.localeCompare(b.email));
}

// ---- changing ----
const tidy = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function updateProfile(me: Profile, id: string, fields: Partial<ProfileFields>) {
  const target = id === me.id ? me : await getProfile(id);
  need(canEditProfile(me, target), "You can't change this user's details.");
  // Email is never changed here.
  const patch = { full_name: tidy(fields.full_name), phone: tidy(fields.phone, 40), company: tidy(fields.company), job_title: tidy(fields.job_title), updated_at: new Date().toISOString() };
  const { error } = await db().from("profiles").update(patch).eq("id", id);
  if (error) throw error;
  return { email: target.email };
}

const tempPassword = () => `${randomBytes(9).toString("base64url")}#7a`;

export async function createUser(me: Profile, input: { email: string; role: Role; full_name?: string; job_title?: string }) {
  need(canManageUsers(me));
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!ROLES.includes(input.role)) throw new Error("Choose a role.");
  const password = tempPassword();
  const { data, error } = await db().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(/already/i.test(error.message) ? "A user with this email already exists." : error.message);
  const { error: pErr } = await db().from("profiles").upsert({
    id: data.user!.id, email, role: input.role, full_name: tidy(input.full_name), job_title: tidy(input.job_title), created_by: me.id,
  });
  if (pErr) throw pErr;
  return { id: data.user!.id, email, password };
}

export async function setUserRole(me: Profile, id: string, role: Role) {
  need(canManageUsers(me));
  if (id === me.id) throw new Error("You can't change your own role. Ask another owner.");
  if (!ROLES.includes(role)) throw new Error("Choose a role.");
  const target = await getProfile(id);
  if (target.email.toLowerCase() === ownerEmail() && role !== "owner") throw new Error(`${target.email} is the main owner (OWNER_EMAIL) and always stays owner.`);
  const { error } = await db().from("profiles").update({ role, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  return { email: target.email, from: target.role, to: role };
}

export async function removeUser(me: Profile, id: string) {
  const target = await getProfile(id);
  if (id === me.id) throw new Error("You can't remove yourself.");
  if (target.role === "owner") throw new Error("Owners can't be removed by anyone.");
  need(canRemove(me, target), me.role === "admin" ? "Admins can only remove users." : "Only owners and admins can remove users.");
  const { error } = await db().auth.admin.deleteUser(id); // the profile goes with it; logs keep the email
  if (error) throw error;
  return { email: target.email };
}

export async function resetUserPassword(me: Profile, id: string) {
  need(canManageUsers(me));
  const target = await getProfile(id);
  const password = tempPassword();
  const { error } = await db().auth.admin.updateUserById(id, { password });
  if (error) throw error;
  return { email: target.email, password };
}
