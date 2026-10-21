import { db } from "../supabase";
import { embed, toVector } from "./embed";

export type SiteMatch = { id: string; url: string; heading: string | null; content: string; similarity: number };

// Retrieval: the sections of the brand's site closest in meaning to `query`.
export async function searchSite(brandId: string, query: string, count = 5): Promise<SiteMatch[]> {
  const [vector] = await embed([query]);
  const { data, error } = await db().rpc("match_page_chunks", { p_brand_id: brandId, p_embedding: toVector(vector), p_count: count });
  if (error) throw error;
  return (data ?? []) as SiteMatch[];
}

export async function isIndexed(brandId: string) {
  const { count } = await db().from("page_chunks").select("id", { count: "exact", head: true }).eq("brand_id", brandId);
  return (count ?? 0) > 0;
}
