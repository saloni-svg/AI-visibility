import { db } from "./supabase";

// Shared database helpers for the dashboard pages.

// Supabase returns at most 1000 rows per request, so page through results.
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

// Runs `.in(column, ids)` queries 150 ids at a time (URLs have a length limit).
export async function inChunks<T>(ids: string[], load: (chunk: string[]) => any): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    out.push(...(await fetchAll<T>((from, to) => load(chunk).order("id").range(from, to))));
  }
  return out;
}

// "15 Oct, 2:09 pm": the time tells apart several checks on the same day.
export const formatRun = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export const matchesDomain = (domain: string | null | undefined, brandDomain: string | null) => {
  const d = domain?.replace(/^www\./, "");
  return !!d && !!brandDomain && (d === brandDomain || d.endsWith(`.${brandDomain}`));
};

// Completed runs that contain answers to this brand's prompts, newest first.
export async function brandRuns(promptIds: string[], limit = 30): Promise<{ id: string; started_at: string }[]> {
  if (!promptIds.length) return [];
  const rows = await inChunks<{ run_id: string }>(promptIds, (chunk) =>
    db().from("answers").select("id, run_id").in("prompt_id", chunk).not("answer_text", "is", null));
  const ids = [...new Set(rows.map((r) => r.run_id))];
  const runs = await inChunks<{ id: string; started_at: string }>(ids, (chunk) =>
    db().from("runs").select("id, started_at").eq("status", "completed").in("id", chunk));
  return runs.sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, limit);
}
