import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { db } from "./supabase";

// Activity and query logs (table activity_logs).
// - query: what someone asked the app for (keyword research, analyses, agent runs …), with the
//   inputs and whether it worked.
// - activity: sign-ins and changes (keywords added, accounts connected, users edited …).
// Server actions log through logAction() (called from signedIn() in actions.ts); a failure is
// added to the same row by logFailure() (called from fail()), via the request's async context.

export type LogKind = "activity" | "query";
type Who = { id: string | null; email: string | null };

// Searches and runs (query log), with a readable name.
const QUERIES: Record<string, string> = {
  startAnalysis: "Visibility analysis", researchKeyword: "Keyword research", researchPrompts: "Prompt research",
  suggestTrackedKeywords: "Keyword suggestions", startPositionCheck: "Position check", startSiteAudit: "Site audit",
  startContentAgent: "Content agent run", startSeoPlan: "SEO agent run", explainChanges: "Change explainer",
  searchMySite: "Search own website", startPageFixes: "Page fixes", findTrackingLocations: "Location search",
  searchTrackingCities: "City search", findGoogleListings: "Google listing search", draftReviewReply: "Review reply draft",
  suggestTrackingPrompts: "Prompt suggestions", importResearchPrompts: "Import research prompts", startTrackingRun: "Prompt tracking run",
  refreshInsights: "Refresh insights", startSiteIndex: "Index website", refreshReviews: "Refresh reviews", redetectLocation: "Detect business location",
};
// Changes (activity log) with a nicer name than the function name.
const ACTIVITIES: Record<string, string> = {
  updateCompetitors: "Changed competitors", updateCountries: "Changed countries", toggleTopicMonitoring: "Turned topic monitoring on/off",
  updateDraft: "Updated content draft", updatePageFix: "Updated page fix", addTrackedKeywords: "Added tracked keywords",
  removeTrackedKeyword: "Removed tracked keyword", createAuditProject: "Created audit project", saveTrackingLocation: "Saved tracking location",
  connectGoogleListing: "Connected Google listing", disconnectGoogle: "Disconnected Google listing",
  chooseGoogleBusinessLocation: "Chose Business Profile location", disconnectGoogleBusinessProfile: "Disconnected Google Business Profile",
  postReviewReply: "Posted review reply on Google", createTrackingCampaign: "Created prompt tracking campaign",
  updateTrackingCampaign: "Updated prompt tracking campaign", removeTrackingPrompt: "Removed tracked prompt",
  deleteTrackingCampaign: "Deleted prompt tracking campaign", snapshotWebsiteNow: "Saved website snapshot",
  createReportLink: "Created share link", updateSeoAction: "Updated SEO plan action", saveSeoSources: "Changed Windsor.ai accounts",
  signIn: "Signed in", signOut: "Signed out", signInFailed: "Failed sign-in",
  updateProfile: "Updated profile details", changePassword: "Changed password",
  createUser: "Added user", setUserRole: "Changed user role", removeUser: "Removed user", resetUserPassword: "Reset user password",
};
// Pages, for "Opened …" entries in the activity log.
export const PAGE_NAMES: Record<string, string> = {
  "/": "Visibility overview", "/competitors": "Competitor research", "/changes": "Change explainer", "/prompts": "Prompt research",
  "/keywords": "Keyword overview", "/seo": "SEO agent", "/agent": "Content agent", "/fixes": "Page fixes", "/positions": "Position tracking",
  "/audit": "Site audit", "/reviews": "Review management", "/tracking": "Prompt tracking", "/analyze": "Analysis", "/profile": "Profile",
};

// Polling and read-only calls: not logged (they'd bury everything else).
const SKIP = new Set(["stepAnalysis", "stepContentAgent", "siteIndexStep", "positionCheckStep", "siteAuditStep", "reviewsStep",
  "trackingRunStep", "stepSeoPlan", "pageFixForGroup", "trackingCheckDetail", "googleBusinessLocations", "listWindsorAccounts"]);

const words = (name: string) => name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
export const kindOf = (action: string): LogKind => (QUERIES[action] ? "query" : "activity");
export const labelOf = (action: string) => QUERIES[action] ?? ACTIVITIES[action] ?? words(action);

// Inputs worth keeping: short strings, numbers, booleans, small lists; long text cut.
function clean(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (Array.isArray(v)) return v.length > 30 ? [...v.slice(0, 30).map((x) => clean(x, depth + 1)), `… ${v.length - 30} more`] : v.map((x) => clean(x, depth + 1));
  if (typeof v === "object" && depth < 3) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !/password|token|secret|key/i.test(k)).slice(0, 20).map(([k, x]) => [k, clean(x, depth + 1)]));
  }
  return String(v).slice(0, 100);
}

// The inputs as one line: "seo agency · GB · desktop".
function summarize(v: unknown): string {
  const parts: string[] = [];
  const walk = (x: unknown) => {
    if (parts.length >= 12 || x == null || x === "") return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === "object") Object.values(x as Record<string, unknown>).forEach(walk);
    else parts.push(String(x));
  };
  walk(v);
  return parts.join(" · ").slice(0, 400);
}

const current = new AsyncLocalStorage<{ id: string; started: number }>();

export async function writeLog(who: Who, action: string, detail: unknown, extra: { status?: "ok" | "error"; error?: string; duration?: number; id?: string; label?: string } = {}) {
  try {
    await db().from("activity_logs").insert({
      id: extra.id ?? randomUUID(), user_id: who.id, email: who.email, kind: kindOf(action), action, label: extra.label ?? labelOf(action),
      detail: clean(detail) ?? null, summary: summarize(clean(detail)) || null, status: extra.status ?? "ok", error: extra.error?.slice(0, 500) ?? null, duration_ms: extra.duration ?? null,
    });
  } catch {
    // Logging never breaks the action itself.
  }
}

// Called at the start of a server action. Remembers the row so a failure can be added to it.
export async function logAction(who: Who, action: string, detail: unknown) {
  if (SKIP.has(action)) return;
  const id = randomUUID();
  current.enterWith({ id, started: Date.now() });
  // Most actions call the domain "input"; show it as "domain".
  const d = detail && typeof detail === "object" && "input" in detail
    ? (({ input, ...rest }: Record<string, unknown>) => ({ domain: input, ...rest }))(detail as Record<string, unknown>)
    : detail;
  await writeLog(who, action, d, { id });
}

// Called when a server action fails: marks its log row as an error, with how long it ran.
export async function logFailure(err: unknown) {
  const ctx = current.getStore();
  if (!ctx) return;
  try {
    await db().from("activity_logs").update({
      status: "error", error: ((err as Error)?.message ?? String(err)).slice(0, 500), duration_ms: Date.now() - ctx.started,
    }).eq("id", ctx.id);
  } catch { /* ignore */ }
}

export type LogRow = {
  id: string; user_id: string | null; email: string | null; kind: LogKind; action: string; label: string;
  detail: Record<string, unknown> | null; summary: string | null; status: "ok" | "error"; error: string | null; duration_ms: number | null; created_at: string;
};

// One page of logs. userId = null: everyone's (owner only; checked by the caller).
export async function listLogs(opts: { kind: LogKind; userId: string | null; page: number; search?: string; pageSize?: number }) {
  const size = opts.pageSize ?? 50;
  let q = db().from("activity_logs").select("*", { count: "exact" }).eq("kind", opts.kind)
    .order("created_at", { ascending: false }).range((opts.page - 1) * size, opts.page * size - 1);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const s = opts.search?.trim().replace(/[%,()]/g, " ");
  if (s) q = q.or(`label.ilike.%${s}%,email.ilike.%${s}%,summary.ilike.%${s}%`);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as LogRow[], total: count ?? 0, pages: Math.max(1, Math.ceil((count ?? 0) / size)) };
}
