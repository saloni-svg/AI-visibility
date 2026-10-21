import { clearCache } from "./cache";
import { COUNTRIES, isCountry } from "./countries";
import { matchesDomain } from "./data";
import { dataForSeo, hasDataForSeo } from "./dataforseo";
import { domainRoot } from "./domain";
import { config, requireEnv } from "./env";
import { postJson } from "./http";
import { normalize } from "./parser";
import { db } from "./supabase";

// Review management. "Connect to Google" = find the business's Google Maps
// listing (DataForSEO Maps search, matched to the website), let the user confirm
// it, then fetch its reviews with DataForSEO's Google Reviews API (a task that
// takes a minute or two; the browser checks back until it's ready).

const DEPTH = Number(process.env.REVIEWS_DEPTH || 500); // most recent reviews to fetch

export type Listing = {
  cid: string | null; place_id: string | null; title: string; address: string | null;
  rating: number | null; reviews_count: number | null; url: string | null; domain: string | null; matchesSite: boolean;
  locationCode?: number;
};

async function brandOf(brandId: string) {
  const { data, error } = await db().from("brands").select("id, name, domain, countries, tracking_locations").eq("id", brandId).single();
  if (error) throw error;
  const country = (data.countries as string[])?.[0] ?? "US";
  const loc = ((data.tracking_locations ?? {}) as Record<string, { code: number; name: string }>)[country];
  const code = loc?.code ?? (isCountry(country) ? COUNTRIES[country].locationCode : 2840);
  return { ...data, country, locationCode: code, place: loc?.name.split(",")[0] ?? null };
}

// Where to search Google Maps: every country the brand is tracked in (its city when
// known), plus any country named in the search text ("…, india").
function searchPlaces(b: Awaited<ReturnType<typeof brandOf>>, query?: string) {
  const locs = (b.tracking_locations ?? {}) as Record<string, { code: number; name: string }>;
  const countries = [...((b.countries as string[]) ?? [])];
  const q = (query ?? "").toLowerCase();
  for (const c of Object.keys(COUNTRIES) as (keyof typeof COUNTRIES)[]) {
    const name = COUNTRIES[c].name.toLowerCase();
    if (q && (q.includes(name) || new RegExp(`\\b${c.toLowerCase()}\\b`).test(q.replace(/,/g, " ")))) countries.unshift(c);
  }
  const out: { code: number; place: string | null }[] = [];
  for (const c of [...new Set(countries)]) {
    if (!isCountry(c)) continue;
    out.push({ code: locs[c]?.code ?? COUNTRIES[c].locationCode, place: locs[c]?.name.split(",")[0] ?? null });
  }
  return out.length ? out.slice(0, 3) : [{ code: b.locationCode, place: b.place }];
}

// Google Maps businesses that could be this brand, website matches first.
export async function findListings(brandId: string, query?: string): Promise<Listing[]> {
  if (!hasDataForSeo()) throw new Error("Connecting to Google needs DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env.");
  const b = await brandOf(brandId);
  const name = b.name === b.domain ? domainRoot(b.domain!) : b.name;
  const places = searchPlaces(b, query);
  const seen = new Map<string, Listing>();
  const searches = places.flatMap((p) =>
    (query?.trim() ? [query.trim()] : [...new Set([p.place ? `${name} ${p.place}` : name, b.domain!])]).map((keyword) => ({ keyword, code: p.code })));
  const results = await Promise.all(searches.map(({ keyword, code }) =>
    dataForSeo("serp/google/maps/live/advanced", [{ keyword, location_code: code, language_code: "en", depth: 20 }], 45_000)
      .then((raw) => ({ code, items: (raw.tasks[0].result?.[0]?.items ?? []) as any[] }))
      .catch(() => ({ code, items: [] as any[] }))));
  for (const { code, items } of results) {
    for (const i of items) {
      if (i.type !== "maps_search") continue;
      const key = String(i.cid ?? i.place_id ?? i.title);
      if (seen.has(key)) continue;
      const domain = i.domain ? String(i.domain).replace(/^www\./, "") : null;
      seen.set(key, {
        cid: i.cid ? String(i.cid) : null, place_id: i.place_id ?? null, title: i.title, address: i.address ?? null,
        rating: i.rating?.value ?? null, reviews_count: i.rating?.votes_count ?? null,
        url: i.cid ? `https://maps.google.com/?cid=${i.cid}` : i.url ?? null, domain,
        matchesSite: (!!domain && matchesDomain(domain, b.domain)) || (normalize(name).length >= 4 && normalize(i.title ?? "").includes(normalize(name))),
        locationCode: code,
      });
    }
  }
  return [...seen.values()].sort((a, c) => Number(c.matchesSite) - Number(a.matchesSite)).slice(0, 8);
}

export async function connectListing(brandId: string, l: Listing) {
  const b = await brandOf(brandId);
  const { data, error } = await db().from("review_sources").upsert({
    brand_id: brandId, platform: "google", cid: l.cid, place_id: l.place_id, title: l.title, address: l.address,
    rating: l.rating, reviews_count: l.reviews_count, url: l.url, location_code: l.locationCode ?? b.locationCode, status: "idle", error: null, task_id: null,
  }, { onConflict: "brand_id,platform" }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function disconnect(brandId: string) {
  await db().from("review_sources").delete().eq("brand_id", brandId).eq("platform", "google");
  clearCache();
}

// Starts the DataForSEO reviews task (newest first).
export async function startFetch(brandId: string) {
  const { data: s, error } = await db().from("review_sources").select("*").eq("brand_id", brandId).eq("platform", "google").single();
  if (error || !s) throw new Error("Connect a Google listing first.");
  const target = s.cid ? { cid: s.cid } : s.place_id ? { place_id: s.place_id } : { keyword: s.title };
  const raw = await dataForSeo("business_data/google/reviews/task_post", [
    { ...target, location_code: s.location_code ?? 2840, language_code: "en", depth: DEPTH, sort_by: "newest", priority: 2 },
  ], 30_000);
  const taskId = raw.tasks[0].id as string;
  await db().from("review_sources").update({ task_id: taskId, status: "fetching", error: null }).eq("id", s.id);
  return taskId;
}

// Google sends line breaks as <br>; store plain text.
const clean = (t: string | null) => (t ? t.replace(/<br\s*\/?>/gi, "\n").trim() : t);

const toDate = (s: unknown) => {
  if (!s) return null;
  const iso = String(s).replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ?([+-]\d{2}:\d{2})?$/, (_, d, t, z) => `${d}T${t}${z ?? "Z"}`);
  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date.toISOString();
};

// Checks whether the reviews are ready; saves them when they are.
export async function fetchStep(brandId: string): Promise<{ status: string; saved?: number; error?: string }> {
  const { data: s } = await db().from("review_sources").select("*").eq("brand_id", brandId).eq("platform", "google").single();
  if (!s) throw new Error("Connect a Google listing first.");
  if (s.status !== "fetching" || !s.task_id) return { status: s.status, error: s.error ?? undefined };

  const auth = Buffer.from(`${requireEnv("DATAFORSEO_LOGIN")}:${requireEnv("DATAFORSEO_PASSWORD")}`).toString("base64");
  const res = await fetch(`https://api.dataforseo.com/v3/business_data/google/reviews/task_get/${s.task_id}`, {
    headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(60_000),
  });
  const raw: any = await res.json();
  const task = raw?.tasks?.[0];
  const code = task?.status_code ?? 0;
  if (code === 40601 || code === 40602 || code === 20100) return { status: "fetching" }; // still working
  if (code !== 20000) {
    const message = task?.status_message ?? raw?.status_message ?? `HTTP ${res.status}`;
    await db().from("review_sources").update({ status: "failed", error: message }).eq("id", s.id);
    return { status: "failed", error: message };
  }

  const result = task.result?.[0] ?? {};
  const items: any[] = (result.items ?? []).filter((i: any) => i.type === "google_reviews_search");
  const rows = items.map((i) => ({
    source_id: s.id, brand_id: brandId,
    review_id: String(i.review_id ?? `${i.profile_name}-${i.timestamp}`),
    author: i.profile_name ?? null, author_url: i.profile_url ?? null, author_image: i.profile_image_url ?? null,
    local_guide: !!i.local_guide, rating: i.rating?.value ?? null,
    text: clean(i.review_text ?? i.original_review_text ?? null),
    published_at: toDate(i.timestamp), time_ago: i.time_ago ?? null,
    owner_reply: clean(i.owner_answer ?? null), owner_reply_at: toDate(i.owner_timestamp),
    review_url: i.review_url ?? null, photos: i.images?.length ?? i.photos_count ?? null,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db().from("reviews").upsert(rows.slice(i, i + 200), { onConflict: "source_id,review_id" });
    if (error) throw error;
  }
  await db().from("review_sources").update({
    status: "ready", task_id: null, fetched_at: new Date().toISOString(),
    rating: result.rating?.value ?? s.rating, reviews_count: result.reviews_count ?? result.rating?.votes_count ?? s.reviews_count,
    title: result.title ?? s.title,
  }).eq("id", s.id);
  clearCache();
  return { status: "ready", saved: rows.length };
}

export async function loadReviews(brandId: string) {
  const { data: source } = await db().from("review_sources").select("*").eq("brand_id", brandId).eq("platform", "google").maybeSingle();
  if (!source) return { source: null, reviews: [] };
  const { data: reviews, error } = await db().from("reviews")
    .select("id, author, author_url, author_image, local_guide, rating, text, published_at, time_ago, owner_reply, owner_reply_at, review_url, photos, ai_reply")
    .eq("source_id", source.id).order("published_at", { ascending: false, nullsFirst: false }).limit(2000);
  if (error) throw error;
  return { source, reviews: reviews ?? [] };
}

// Drafts a short, personal reply to one review (to copy into Google).
export async function draftReply(brandId: string, reviewId: string) {
  const [{ data: r }, b] = await Promise.all([
    db().from("reviews").select("id, author, rating, text").eq("id", reviewId).eq("brand_id", brandId).single(),
    brandOf(brandId),
  ]);
  if (!r) throw new Error("Review not found.");
  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.parser,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: [
            `You write replies to Google reviews on behalf of ${b.name === b.domain ? domainRoot(b.domain!) : b.name}.`,
            "Warm, professional, 2-4 sentences. Thank the reviewer by first name if given. Refer to something specific they said.",
            "For 1-3 stars: apologise without arguing, don't admit legal fault, and invite them to get in touch to put it right.",
            "Never invent facts, discounts or promises. No hashtags or emojis. Reply with the text only.",
          ].join("\n"),
        },
        { role: "user", content: `Reviewer: ${r.author ?? "Customer"}\nStars: ${r.rating ?? "?"}/5\nReview: ${r.text || "(no text, rating only)"}` },
      ],
    },
  );
  const reply = String(raw.choices[0].message.content ?? "").trim();
  await db().from("reviews").update({ ai_reply: reply }).eq("id", reviewId);
  return reply;
}
