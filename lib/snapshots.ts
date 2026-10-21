import { createHash } from "node:crypto";
import { runPool } from "./http";
import { chunk, getText, pageSections } from "./site";
import { db } from "./supabase";

// Saves what key pages of the website said at a point in time, so later we can
// tell whether the website changed between two visibility checks.

export async function capturePages(brandId: string, domain: string, extraUrls: string[] = []) {
  const { data: indexed } = await db().from("site_pages").select("url").eq("brand_id", brandId).limit(15);
  const urls = [...new Set([`https://${domain}/`, ...extraUrls, ...(indexed ?? []).map((p) => p.url)])].slice(0, 25);
  const rows: Record<string, unknown>[] = [];
  await runPool(urls, 5, async (url) => {
    try {
      const res = await getText(url);
      const { title, sections } = pageSections(res.text);
      const text = chunk(sections).map((c) => c.text).join("\n");
      rows.push({
        brand_id: brandId, url, status_code: res.status, title,
        word_count: text.split(/\s+/).filter(Boolean).length,
        content_hash: createHash("sha256").update(text).digest("hex"),
        text: text.slice(0, 20_000),
      });
    } catch {
      rows.push({ brand_id: brandId, url, status_code: 0 });
    }
  });
  if (rows.length) await db().from("page_snapshots").insert(rows);
  return rows.length;
}

const sentences = (t: string) => new Set(t.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter((s) => s.split(" ").length >= 5));

export type PageChange = {
  url: string; kind: "changed" | "new" | "removed" | "status";
  titleBefore: string | null; titleAfter: string | null; wordsBefore: number | null; wordsAfter: number | null;
  added: string[]; removed: string[]; statusBefore: number | null; statusAfter: number | null;
};

// Website changes between two moments: the latest snapshot at or before `from`
// versus the latest at or before `to`.
export async function websiteChanges(brandId: string, from: string, to: string) {
  const { data } = await db().from("page_snapshots").select("url, status_code, title, word_count, content_hash, text, captured_at")
    .eq("brand_id", brandId).lte("captured_at", to).order("captured_at", { ascending: false }).limit(2000);
  const all = data ?? [];
  const latest = (url: string, before: string) => all.find((s) => s.url === url && s.captured_at <= before) ?? null;
  const urls = [...new Set(all.map((s) => s.url))];
  const hasBaseline = all.some((s) => s.captured_at <= from);
  const changes: PageChange[] = [];
  for (const url of urls) {
    const a = latest(url, from);
    const b = latest(url, to);
    if (!b || a === b) continue;
    if (!a) {
      if (hasBaseline) changes.push({ url, kind: "new", titleBefore: null, titleAfter: b.title, wordsBefore: null, wordsAfter: b.word_count, added: [], removed: [], statusBefore: null, statusAfter: b.status_code });
      continue;
    }
    if (a.status_code !== b.status_code && (a.status_code === 200 || b.status_code === 200)) {
      changes.push({ url, kind: "status", titleBefore: a.title, titleAfter: b.title, wordsBefore: a.word_count, wordsAfter: b.word_count, added: [], removed: [], statusBefore: a.status_code, statusAfter: b.status_code });
      continue;
    }
    if (a.content_hash && b.content_hash && a.content_hash !== b.content_hash) {
      const sa = sentences(a.text ?? ""), sb = sentences(b.text ?? "");
      changes.push({
        url, kind: "changed", titleBefore: a.title, titleAfter: b.title, wordsBefore: a.word_count, wordsAfter: b.word_count,
        added: [...sb].filter((s) => !sa.has(s)).slice(0, 5), removed: [...sa].filter((s) => !sb.has(s)).slice(0, 5),
        statusBefore: a.status_code, statusAfter: b.status_code,
      });
    }
  }
  return { hasBaseline, pagesCompared: urls.length, changes };
}

// After each visibility check: save the website's key pages (once per 6 hours at most).
export async function snapshotAfterCheck(brandId: string) {
  const { data: b } = await db().from("brands").select("domain").eq("id", brandId).single();
  if (!b?.domain) return;
  const { data: recent } = await db().from("page_snapshots").select("id").eq("brand_id", brandId)
    .gte("captured_at", new Date(Date.now() - 6 * 3_600_000).toISOString()).limit(1);
  if (recent?.length) return;
  await capturePages(brandId, b.domain);
}
