import { createHash } from "node:crypto";
import { clearCache } from "../cache";
import { runPool } from "../http";
import { chunk, getText, listSitePages, pageSections } from "../site";
import { db } from "../supabase";
import { embed, toVector } from "./embed";

// Indexing: every page of the site is split into sections and each section is
// embedded, so the app can later find the parts of the site that relate to a
// question by meaning, not keywords. Runs in steps so the app can show progress.

export async function discoverPages(brandId: string, domain: string) {
  const urls = await listSitePages(domain);
  if (!urls.length) throw new Error(`Couldn't find any pages on ${domain}.`);
  const { error } = await db()
    .from("site_pages")
    .upsert(urls.map((url) => ({ brand_id: brandId, url, needs_index: true })), { onConflict: "brand_id,url" });
  if (error) throw error;
  return urls.length;
}

async function indexPage(brandId: string, page: { id: string; url: string; content_hash: string | null }) {
  try {
    const res = await getText(page.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { title, sections } = pageSections(res.text);
    const chunks = chunk(sections);
    const hash = createHash("sha256").update(chunks.map((c) => c.text).join("\n")).digest("hex");
    const words = chunks.reduce((s, c) => s + c.text.split(" ").length, 0);
    if (hash !== page.content_hash) {
      // Changed (or new): replace this page's sections and embeddings.
      const vectors = chunks.length ? await embed(chunks.map((c) => `${title}\n${c.heading}\n${c.text}`)) : [];
      await db().from("page_chunks").delete().eq("page_id", page.id);
      if (chunks.length) {
        const { error } = await db().from("page_chunks").insert(
          chunks.map((c, i) => ({
            brand_id: brandId, page_id: page.id, url: page.url, heading: c.heading, chunk_index: i, content: c.text, embedding: toVector(vectors[i]),
          })),
        );
        if (error) throw error;
      }
    }
    await db().from("site_pages")
      .update({ title, content_hash: hash, word_count: words, needs_index: false, error: null, indexed_at: new Date().toISOString() })
      .eq("id", page.id);
  } catch (err) {
    await db().from("site_pages").update({ needs_index: false, error: (err as Error).message.slice(0, 300) }).eq("id", page.id);
  }
}

// Indexes the next few pages. Returns how many are done.
export async function indexStep(brandId: string, batch = 8) {
  const { data: pages, error } = await db()
    .from("site_pages").select("id, url, content_hash").eq("brand_id", brandId).eq("needs_index", true).limit(batch);
  if (error) throw error;
  await runPool(pages ?? [], 4, (p) => indexPage(brandId, p));
  const status = await indexStatus(brandId);
  if (status.pending === 0) clearCache();
  return status;
}

export async function indexStatus(brandId: string) {
  const count = (q: any) => q.then((r: any) => r.count ?? 0);
  const [total, pending, failed, chunks, last] = await Promise.all([
    count(db().from("site_pages").select("id", { count: "exact", head: true }).eq("brand_id", brandId)),
    count(db().from("site_pages").select("id", { count: "exact", head: true }).eq("brand_id", brandId).eq("needs_index", true)),
    count(db().from("site_pages").select("id", { count: "exact", head: true }).eq("brand_id", brandId).not("error", "is", null)),
    count(db().from("page_chunks").select("id", { count: "exact", head: true }).eq("brand_id", brandId)),
    db().from("site_pages").select("indexed_at").eq("brand_id", brandId).not("indexed_at", "is", null)
      .order("indexed_at", { ascending: false }).limit(1).maybeSingle().then((r) => r.data?.indexed_at ?? null),
  ]);
  return { total: total as number, pending: pending as number, failed: failed as number, chunks: chunks as number, lastIndexed: last as string | null };
}
