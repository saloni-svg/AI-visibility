import { clearCache } from "../cache";
import { matchesDomain } from "../data";
import { runPool } from "../http";
import { listSitePages } from "../site";
import { db } from "../supabase";
import { issueInfo } from "./issues";

// The site audit crawler. Starts at the homepage (plus sitemap URLs), follows
// internal links up to the page limit, records each page's facts, then runs
// cross-page checks and scores at the end. Runs in steps so the app shows progress.

const PAGE_LIMIT = Number(process.env.AUDIT_PAGE_LIMIT || 100);
const UA = "Mozilla/5.0 (compatible; AIVisibilityAudit/1.0)";
const SKIP_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|json|xml|pdf|zip|rar|mp4|mp3|webm|woff2?|ttf|eot|docx?|xlsx?|pptx?)(\?|$)/i;
export const AI_BOTS = ["ChatGPT-User", "OAI-SearchBot", "GPTBot", "Google-Extended", "PerplexityBot", "ClaudeBot"];
export const SEARCH_BOTS = ["Googlebot", "Bingbot"];

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ");

// Absolute, same-site URL without #fragment or ?query, or null.
export function normalizeUrl(href: string, base: string, domain: string): string | null {
  if (!href || /^(mailto:|tel:|javascript:|#|data:)/i.test(href.trim())) return null;
  try {
    const u = new URL(decode(href.trim()), base);
    if (!/^https?:$/.test(u.protocol) || !matchesDomain(u.hostname.replace(/^www\./, ""), domain)) return null;
    u.hash = "";
    u.search = "";
    const s = u.toString();
    return SKIP_EXT.test(s) ? null : s;
  } catch {
    return null;
  }
}

// ---- Parsing one HTML page ----
export function analyzeHtml(html: string, url: string, domain: string) {
  const head = html.slice(0, 200_000);
  const title = decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const metaTags = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (name: string) => metaTags.find((t) => (attr(t, "name") ?? attr(t, "property") ?? "").toLowerCase() === name);
  const description = decode(attr(meta("description") ?? "", "content") ?? "").trim();
  const robots = (attr(meta("robots") ?? "", "content") ?? "").toLowerCase();
  const linkTags = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const canonicalTag = linkTags.find((t) => (attr(t, "rel") ?? "").toLowerCase() === "canonical");
  const canonical = canonicalTag ? attr(canonicalTag, "href") : null;
  const hreflangs = linkTags.filter((t) => (attr(t, "rel") ?? "").toLowerCase() === "alternate" && attr(t, "hreflang"));
  const hreflangValid = hreflangs.every((t) => /^(x-default|[a-z]{2,3}(-[a-z0-9]{2,4})?)$/i.test(attr(t, "hreflang") ?? "") && /^https?:\/\//i.test(attr(t, "href") ?? ""));

  // Structured data (JSON-LD)
  const schemaTypes = new Set<string>();
  let schemaErrors = 0;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v: any): void => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (v && typeof v === "object") {
          const t = v["@type"];
          (Array.isArray(t) ? t : t ? [t] : []).forEach((x: string) => schemaTypes.add(String(x)));
          Object.values(v).forEach(walk);
        }
      };
      walk(JSON.parse(m[1].trim()));
    } catch {
      schemaErrors++;
    }
  }

  const body = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ");
  const h1Count = (body.match(/<h1\b/gi) ?? []).length;
  const h1 = decode(body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "").replace(/\s+/g, " ").trim();
  const text = decode(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const wordCount = text ? text.split(" ").filter((w) => /[a-z0-9]/i.test(w)).length : 0;
  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const imagesNoAlt = imgs.filter((t) => attr(t, "alt") === null).length;
  const links = new Set<string>();
  let emptyAnchors = 0;
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], "href");
    if (!href) continue;
    const u = normalizeUrl(href, url, domain);
    if (u) links.add(u);
    // No visible text, no aria-label/title, and no image alt: the link has no anchor text.
    const inner = m[2];
    const hasText = decode(inner.replace(/<[^>]+>/g, " ")).trim().length > 0;
    const hasLabel = !!(attr(m[1], "aria-label") || attr(m[1], "title")) || /<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(inner);
    if (!hasText && !hasLabel && !/^(#|javascript:)/i.test(href)) emptyAnchors++;
  }
  const isHttps = url.startsWith("https://");
  const mixed = isHttps ? (html.match(/<(img|script|iframe|source|video|audio)\b[^>]*\bsrc\s*=\s*["']http:\/\//gi) ?? []).length +
    (html.match(/<link\b[^>]*rel=["']stylesheet["'][^>]*href\s*=\s*["']http:\/\//gi) ?? []).length : 0;
  // Simple yes/no findings on this page.
  const flags: string[] = [];
  if (!/^\s*(<!--[\s\S]*?-->\s*)*<!doctype\s+html/i.test(html)) flags.push("no_doctype");
  if (!/<meta[^>]+charset\s*=|<meta[^>]+content=["'][^"']*charset=/i.test(head)) flags.push("no_charset");
  if (metaTags.some((t) => (attr(t, "http-equiv") ?? "").toLowerCase() === "refresh")) flags.push("meta_refresh");
  if (linkTags.filter((t) => (attr(t, "rel") ?? "").toLowerCase() === "canonical").length > 1) flags.push("multiple_canonicals");
  if (!/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(head)) flags.push("no_lang");
  if (/<frame\b|<frameset\b/i.test(body)) flags.push("has_frames");
  if ((body.match(/<a\b/gi) ?? []).length > 3000) flags.push("too_many_links");
  if ([...body.matchAll(/<a\b([^>]*)>/gi)].some((m) => { const h = attr(m[1], "href"); return h && normalizeUrl(h, url, domain) && /nofollow/i.test(attr(m[1], "rel") ?? ""); })) flags.push("nofollow_internal");
  if (isHttps && [...links].some((l) => l.startsWith("http://"))) flags.push("links_to_http");
  const canonicalAbs = canonical ? (() => { try { return new URL(canonical, url).toString().replace(/[#?].*$/, ""); } catch { return null; } })() : null;

  return {
    title, meta_description: description, h1_count: h1Count, h1: h1.slice(0, 300), word_count: wordCount,
    text_ratio: html.length ? Math.round((text.length / html.length) * 1000) / 1000 : 0,
    empty_anchor_links: emptyAnchors,
    canonical: canonicalAbs, noindex: /noindex/.test(robots),
    hreflang_count: hreflangs.length, hreflang_valid: hreflangValid,
    schema_types: [...schemaTypes].slice(0, 30), schema_errors: schemaErrors,
    images_total: imgs.length, images_no_alt: imagesNoAlt,
    internal_links: [...links].slice(0, 500), mixed_content: mixed,
    has_viewport: !!meta("viewport"),
    flags,
  };
}

// ---- Site-wide checks ----
async function get(url: string, timeoutMs = 15_000, redirect: RequestRedirect = "follow") {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA }, redirect });
}

function robotsGroups(robots: string) {
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let cur: { agents: string[]; disallow: string[] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) {
      if (!cur || cur.disallow.length) groups.push((cur = { agents: [], disallow: [] }));
      cur.agents.push(v.toLowerCase());
    } else if (/^disallow$/i.test(k) && cur) cur.disallow.push(v);
  }
  return groups;
}

// The rules that apply to a bot: its own group, or the "*" group.
const rulesFor = (groups: ReturnType<typeof robotsGroups>, bot: string) =>
  (groups.find((x) => x.agents.includes(bot.toLowerCase())) ?? groups.find((x) => x.agents.includes("*")))?.disallow.filter(Boolean) ?? [];

// Does a robots.txt Disallow rule (with * and $ wildcards) match a URL path?
export function ruleMatches(rule: string, path: string) {
  const re = new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, (c) => (c === "$" ? "$" : `\\${c}`)).replace(/\\\$$/, "$").replace(/\*/g, ".*"));
  return re.test(path);
}

async function siteChecks(domain: string) {
  const out: Record<string, unknown> = {};
  try {
    const r = await get(`https://${domain}/robots.txt`);
    const text = r.ok ? await r.text() : "";
    out.robots = r.ok && !/<html/i.test(text.slice(0, 300));
    const groups = out.robots ? robotsGroups(text) : [];
    out.robots_sitemap = out.robots ? /^\s*sitemap\s*:/im.test(text) : null;
    const blocked = (bot: string) => rulesFor(groups, bot).includes("/");
    out.blocked_ai_bots = AI_BOTS.filter(blocked);
    out.blocked_search_bots = SEARCH_BOTS.filter(blocked);
    out.disallow = rulesFor(groups, "Googlebot").slice(0, 100); // used to flag pages blocked from crawling
  } catch {
    out.robots = false;
    out.blocked_ai_bots = [];
    out.blocked_search_bots = [];
    out.disallow = [];
  }
  try {
    const r = await get(`https://${domain}/`, 15_000);
    out.hsts = !!r.headers.get("strict-transport-security");
    await r.body?.cancel();
  } catch {
    out.hsts = null;
  }
  try {
    const r = await get(`https://${domain}/sitemap.xml`);
    out.sitemap = r.ok && /<(urlset|sitemapindex)/i.test((await r.text()).slice(0, 2000));
  } catch {
    out.sitemap = false;
  }
  try {
    const r = await get(`http://${domain}/`, 10_000, "manual");
    const loc = r.headers.get("location") ?? "";
    out.https_redirect = r.status >= 300 && r.status < 400 && loc.startsWith("https://");
  } catch {
    out.https_redirect = null; // couldn't test (e.g. HTTP port closed): not counted
  }
  try {
    const r = await get(`https://${domain}/llms.txt`, 8_000);
    out.llms_txt = r.ok && !/<html/i.test((await r.text()).slice(0, 300));
  } catch {
    out.llms_txt = false;
  }
  return out;
}

export function siteIssueCodes(checks: Record<string, any>): string[] {
  const codes: string[] = [];
  if (checks.robots === false) codes.push("no_robots");
  if (checks.sitemap === false) codes.push("no_sitemap");
  if (checks.robots && checks.robots_sitemap === false) codes.push("no_sitemap_in_robots");
  if (checks.https_redirect === false) codes.push("no_https_redirect");
  if ((checks.blocked_ai_bots ?? []).length) codes.push("ai_bots_blocked");
  if ((checks.blocked_search_bots ?? []).includes("Googlebot")) codes.push("googlebot_blocked");
  if (checks.hsts === false) codes.push("no_hsts");
  if (checks.llms_txt === false) codes.push("no_llms_txt");
  return codes;
}

// Pages that count toward the limit: everything except redirects (which only
// point to other pages). Total rows are also capped at twice the limit.
async function realPages(runId: string) {
  const [{ count: all }, { count: redirects }] = await Promise.all([
    db().from("audit_pages").select("id", { count: "exact", head: true }).eq("run_id", runId),
    db().from("audit_pages").select("id", { count: "exact", head: true }).eq("run_id", runId).gte("status_code", 300).lt("status_code", 400),
  ]);
  return (all ?? 0) - (redirects ?? 0);
}

// ---- Run lifecycle ----
export async function startAudit(brandId: string, domain: string) {
  const { data: open } = await db().from("audit_runs").select("id").eq("brand_id", brandId).eq("status", "running").limit(1);
  if (open?.length) return open[0].id as string; // resume

  const checks = await siteChecks(domain);
  const { data: run, error } = await db().from("audit_runs")
    .insert({ brand_id: brandId, page_limit: PAGE_LIMIT, site_checks: checks }).select("id").single();
  if (error) throw error;

  const home = `https://${domain}/`;
  let sitemap: string[] = [];
  try {
    sitemap = (await listSitePages(domain, PAGE_LIMIT)).map((u) => normalizeUrl(u, home, domain)).filter((u): u is string => !!u);
  } catch { /* crawl from the homepage only */ }
  const rows = [
    { run_id: run.id, url: home, depth: 0, in_sitemap: sitemap.includes(home) },
    ...[...new Set(sitemap)].filter((u) => u !== home).slice(0, PAGE_LIMIT - 1).map((url) => ({ run_id: run.id, url, depth: 99, in_sitemap: true })),
  ];
  const { error: insErr } = await db().from("audit_pages").upsert(rows, { onConflict: "run_id,url", ignoreDuplicates: true });
  if (insErr) throw insErr;
  return run.id as string;
}

async function crawlPage(run: { id: string; page_limit: number }, domain: string, page: { id: string; url: string; depth: number }) {
  const started = Date.now();
  const update: Record<string, unknown> = { state: "done" };
  let discovered: string[] = [];
  try {
    const res = await get(page.url, 20_000, "manual");
    update.status_code = res.status;
    update.response_ms = Date.now() - started;
    if (res.status >= 300 && res.status < 400) {
      const target = normalizeUrl(res.headers.get("location") ?? "", page.url, domain);
      update.redirect_to = target ?? res.headers.get("location");
      if (target) discovered = [target];
    } else if ((res.headers.get("content-type") ?? "").includes("html") && res.status < 400) {
      const html = await res.text();
      update.size_bytes = Buffer.byteLength(html);
      const facts = analyzeHtml(html, page.url, domain);
      if (!res.headers.get("content-encoding") && update.size_bytes as number > 1024) facts.flags.push("uncompressed");
      Object.assign(update, facts);
      discovered = update.internal_links as string[];
    } else {
      await res.body?.cancel();
    }
  } catch (err) {
    update.status_code = 0;
    update.error = (err as Error).message.slice(0, 200);
  }
  await db().from("audit_pages").update(update).eq("id", page.id);

  // Queue newly found pages (within the limit) and shorten depths of known ones.
  if (discovered.length) {
    // A redirect target sits at the same depth as the URL that redirects to it.
    const isRedirect = !!update.redirect_to;
    const base = page.depth >= 99 ? 1 : page.depth;
    const nextDepth = isRedirect ? base : base + 1;
    const known: { id: string; url: string; depth: number }[] = [];
    for (let i = 0; i < Math.min(discovered.length, 300); i += 60) {
      const { data } = await db().from("audit_pages").select("id, url, depth").eq("run_id", run.id).in("url", discovered.slice(i, i + 60));
      known.push(...(data ?? []));
    }
    const knownMap = new Map(known.map((k) => [k.url, k]));
    const lower = known.filter((k) => k.depth > nextDepth).map((k) => k.id);
    if (lower.length) await db().from("audit_pages").update({ depth: nextDepth }).in("id", lower);
    const room = Math.max(0, run.page_limit - (await realPages(run.id)));
    const fresh = discovered.filter((u) => !knownMap.has(u)).slice(0, room);
    if (fresh.length) {
      await db().from("audit_pages").upsert(fresh.map((url) => ({ run_id: run.id, url, depth: nextDepth })), { onConflict: "run_id,url", ignoreDuplicates: true });
    }
  }
}

export async function auditStep(runId: string) {
  const { data: run, error } = await db().from("audit_runs").select("id, brand_id, status, page_limit, brands(domain)").eq("id", runId).single();
  if (error) throw error;
  const domain = (run as any).brands?.domain as string;
  if (run.status === "running") {
    // Parallel crawling can queue a few pages past the limit: drop the extras.
    const { count: totalRows } = await db().from("audit_pages").select("id", { count: "exact", head: true }).eq("run_id", runId);
    const room = Math.min(run.page_limit - (await realPages(runId)), run.page_limit * 2 - (totalRows ?? 0) + 12);
    const { data: queuedAll } = await db().from("audit_pages").select("id, url, depth").eq("run_id", runId).eq("state", "queued")
      .order("depth").limit(500);
    const extra = (queuedAll ?? []).slice(Math.max(0, room)).map((q) => q.id);
    for (let i = 0; i < extra.length; i += 100) await db().from("audit_pages").delete().in("id", extra.slice(i, i + 100));
    const queued = (queuedAll ?? []).slice(0, Math.max(0, Math.min(room, 12)));
    if (queued?.length) {
      await runPool(queued, 6, (p) => crawlPage(run, domain, p));
    } else {
      await finalizeAudit(runId, domain);
    }
  }
  const [{ count: done }, { count: total }, { data: fresh }] = await Promise.all([
    db().from("audit_pages").select("id", { count: "exact", head: true }).eq("run_id", runId).eq("state", "done"),
    db().from("audit_pages").select("id", { count: "exact", head: true }).eq("run_id", runId),
    db().from("audit_runs").select("status").eq("id", runId).single(),
  ]);
  return { status: fresh?.status ?? run.status, done: done ?? 0, total: total ?? 0, limit: run.page_limit };
}

// ---- Core Web Vitals (Google PageSpeed Insights) ----
async function coreWebVitals(url: string) {
  const key = process.env.PAGESPEED_API_KEY ? `&key=${process.env.PAGESPEED_API_KEY}` : "";
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance${key}`,
    { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`PageSpeed ${res.status}`);
  const d: any = await res.json();
  const field = d.loadingExperience?.metrics;
  const audits = d.lighthouseResult?.audits ?? {};
  // Real-user (field) data when Google has it, otherwise lab data.
  const lcp = field?.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? audits["largest-contentful-paint"]?.numericValue ?? null;
  const cls = field?.CUMULATIVE_LAYOUT_SHIFT_SCORE ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : audits["cumulative-layout-shift"]?.numericValue ?? null;
  const inp = field?.INTERACTION_TO_NEXT_PAINT?.percentile ?? null;
  const tbt = audits["total-blocking-time"]?.numericValue ?? null;
  const pass = lcp !== null && cls !== null && lcp <= 2500 && cls <= 0.1 && (inp !== null ? inp <= 200 : tbt === null || tbt <= 200);
  return { lcp: lcp && Math.round(lcp), cls: cls !== null ? Math.round(cls * 1000) / 1000 : null, inp, tbt: tbt && Math.round(tbt), source: field ? "field" : "lab", pass };
}

// ---- Final cross-page checks and scores ----
type Page = {
  id: string; url: string; depth: number; in_sitemap: boolean; status_code: number | null; redirect_to: string | null;
  response_ms: number | null; size_bytes: number | null; title: string | null; meta_description: string | null;
  h1_count: number | null; h1: string | null; text_ratio: number | null; empty_anchor_links: number | null; word_count: number | null; canonical: string | null; noindex: boolean | null;
  hreflang_count: number | null; hreflang_valid: boolean | null; schema_types: string[]; schema_errors: number;
  images_no_alt: number | null; internal_links: string[]; flags: string[] | null; mixed_content: number | null; has_viewport: boolean | null;
};

export async function finalizeAudit(runId: string, domain: string) {
  const { data, error } = await db().from("audit_pages").select("*").eq("run_id", runId).limit(2000);
  if (error) throw error;
  const pages = (data ?? []) as Page[];
  const { data: run } = await db().from("audit_runs").select("site_checks").eq("id", runId).single();
  const checks = (run?.site_checks ?? {}) as Record<string, any>;
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const isHtml = (p: Page) => p.status_code === 200 && p.word_count !== null;
  const html = pages.filter(isHtml);

  // Where a link really ends up: follow redirects between crawled URLs (e.g. /page → /page/).
  const finalOf = (u: string) => {
    let cur = u;
    for (let hop = 0; hop < 5; hop++) {
      const p = byUrl.get(cur);
      if (!p || !p.redirect_to || !(p.status_code && p.status_code >= 300 && p.status_code < 400) || p.redirect_to === cur) break;
      cur = p.redirect_to;
    }
    return cur;
  };
  // Incoming internal links per page (after redirects).
  const incoming = new Map<string, number>();
  for (const p of html) for (const l of new Set(p.internal_links.map(finalOf))) if (l !== p.url) incoming.set(l, (incoming.get(l) ?? 0) + 1);
  const count = (field: "title" | "meta_description") => {
    const m = new Map<string, number>();
    for (const p of html) { const v = (p[field] ?? "").trim().toLowerCase(); if (v) m.set(v, (m.get(v) ?? 0) + 1); }
    return m;
  };
  const titles = count("title");
  const metas = count("meta_description");
  const home = finalOf(`https://${domain}/`);

  const issuesOf = (p: Page): string[] => {
    const i: string[] = [];
    const s = p.status_code ?? 0;
    if (s === 0) i.push("fetch_failed");
    else if (s >= 500) i.push("http_5xx");
    else if (s >= 400) i.push("http_4xx");
    if (!p.url.startsWith("https://")) i.push("not_https");
    if (s === 301 || s === 308) i.push("permanent_redirect");
    if (s === 302 || s === 303 || s === 307) i.push("temp_redirect");
    if (s >= 300 && s < 400 && p.redirect_to) {
      const next = byUrl.get(p.redirect_to);
      if (p.redirect_to === p.url || (next?.status_code && next.status_code >= 300 && next.status_code < 400)) i.push("redirect_chain");
    }
    if (p.url.length > 200) i.push("long_url");
    try { if (new URL(p.url).pathname.includes("_")) i.push("url_underscores"); } catch { /* ignore */ }
    const path = (() => { try { const u = new URL(p.url); return u.pathname; } catch { return "/"; } })();
    if ((checks.disallow ?? []).some((r: string) => ruleMatches(r, path))) i.push("blocked_by_robots");
    if (!isHtml(p)) return i;
    const broken = p.internal_links.some((l) => { const t = byUrl.get(finalOf(l)); return t && t.status_code !== null && (t.status_code === 0 || t.status_code >= 400); });
    if (broken) i.push("broken_internal_link");
    if (p.internal_links.some((l) => { const t = byUrl.get(l); return t?.status_code && t.status_code >= 300 && t.status_code < 400; })) i.push("redirect");
    const title = (p.title ?? "").trim();
    if (!title) i.push("missing_title");
    else {
      if ((titles.get(title.toLowerCase()) ?? 0) > 1) i.push("duplicate_title");
      if (title.length > 60) i.push("title_too_long");
      if (title.length < 10) i.push("title_too_short");
    }
    const meta = (p.meta_description ?? "").trim();
    if (!meta) i.push("missing_meta");
    else if ((metas.get(meta.toLowerCase()) ?? 0) > 1) i.push("duplicate_meta");
    if ((p.h1_count ?? 0) === 0) i.push("missing_h1");
    else if (title && p.h1 && p.h1.trim().toLowerCase() === title.toLowerCase()) i.push("h1_equals_title");
    if ((p.text_ratio ?? 1) < 0.1 && (p.word_count ?? 0) >= 50) i.push("low_text_ratio");
    if ((p.empty_anchor_links ?? 0) > 0) i.push("empty_anchor");
    if ((p.h1_count ?? 0) > 1) i.push("multiple_h1");
    if ((p.word_count ?? 0) < 50) i.push("js_only_content");
    else if ((p.word_count ?? 0) < 200) i.push("low_word_count");
    if ((p.images_no_alt ?? 0) > 0) i.push("images_missing_alt");
    if ((p.mixed_content ?? 0) > 0) i.push("mixed_content");
    if ((p.response_ms ?? 0) > 1000) i.push("slow_page");
    if ((p.size_bytes ?? 0) > 2_000_000) i.push("large_page");
    if (!p.has_viewport) i.push("no_viewport");
    if (p.schema_errors > 0) i.push("invalid_schema");
    else if (!p.schema_types.length) i.push("no_schema");
    if ((p.hreflang_count ?? 0) > 0 && !p.hreflang_valid) i.push("invalid_hreflang");
    if (p.noindex) i.push("noindex");
    if (p.canonical && p.canonical.replace(/\/$/, "") !== p.url.replace(/\/$/, "")) i.push("canonical_elsewhere");
    const canon = p.canonical ? byUrl.get(p.canonical) : null;
    if (canon && (canon.status_code === 0 || (canon.status_code ?? 0) >= 400)) i.push("broken_canonical");
    for (const f of p.flags ?? []) if (!i.includes(f)) i.push(f);
    const inLinks = incoming.get(p.url) ?? 0;
    if (p.url !== home) {
      if (inLinks === 0 && p.in_sitemap) i.push("orphan_page");
      else if (inLinks === 1) i.push("single_incoming_link");
      if (p.depth > 3 && p.depth < 99) i.push("deep_page");
    }
    return i;
  };

  const issueMap = new Map<string, string[]>();
  for (const p of pages) issueMap.set(p.id, issuesOf(p));
  await runPool(pages, 10, async (p) => { await db().from("audit_pages").update({ issues: issueMap.get(p.id) }).eq("id", p.id); });

  // Core Web Vitals on the homepage and the two most-linked pages.
  const cwvTargets = [home, ...[...incoming].sort((a, b) => b[1] - a[1]).map(([u]) => u).filter((u) => u !== home && byUrl.get(u) && isHtml(byUrl.get(u)!))].slice(0, 3);
  const cwv: { url: string; pass: boolean }[] = [];
  await runPool(cwvTargets.filter((u) => byUrl.has(u)), 3, async (u) => {
    try {
      const r = await coreWebVitals(u);
      cwv.push({ url: u, pass: r.pass });
      await db().from("audit_pages").update({ cwv: r }).eq("id", byUrl.get(u)!.id);
    } catch (err) {
      console.error(`Core Web Vitals failed for ${u}: ${(err as Error).message}`);
    }
  });

  // ---- Scores (0-100) ----
  const pct = (good: number, all: number) => (all ? Math.round((good / all) * 100) : null);
  const has = (p: Page, code: string) => issueMap.get(p.id)!.includes(code);
  const siteCodes = siteIssueCodes(checks);
  const sev = (code: string) => issueInfo(code)?.severity;

  const pageScore = (p: Page) => {
    const codes = issueMap.get(p.id)!;
    const e = codes.filter((c) => sev(c) === "error").length;
    const w = codes.filter((c) => sev(c) === "warning").length;
    return Math.max(0, 1 - 0.35 * e - 0.08 * w);
  };
  const siteErrors = siteCodes.filter((c) => sev(c) === "error").length;
  const siteWarnings = siteCodes.filter((c) => sev(c) === "warning").length;
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const siteHealth = pages.length ? clamp((pages.reduce((s, p) => s + pageScore(p), 0) / pages.length) * 100 - 5 * siteErrors - 2 * siteWarnings) : 0;

  // AI search health: can AI crawlers read and understand each page?
  const aiPage = (p: Page) => {
    const tests = [
      !p.noindex,
      (p.word_count ?? 0) >= 150,
      !!(p.title ?? "").trim(),
      !!(p.meta_description ?? "").trim(),
      (p.h1_count ?? 0) >= 1,
      p.schema_types.length > 0 && p.schema_errors === 0,
    ];
    return tests.filter(Boolean).length / tests.length;
  };
  const blocked = (checks.blocked_ai_bots ?? []).length;
  const aiHealth = html.length
    ? clamp((html.reduce((s, p) => s + aiPage(p), 0) / html.length) * 100 - Math.min(40, blocked * 10) - (checks.llms_txt === false ? 3 : 0))
    : 0;

  const hreflangPages = html.filter((p) => (p.hreflang_count ?? 0) > 0);
  const scores = {
    siteHealth,
    aiHealth,
    // Redirects are neither good nor bad here (they're reported as notices).
    crawlability: (() => {
      const judged = pages.filter((p) => !(p.status_code && p.status_code >= 300 && p.status_code < 400));
      return pct(judged.filter((p) => p.status_code === 200 && !p.noindex && !issueMap.get(p.id)!.includes("blocked_by_robots")).length, judged.length);
    })(),
    https: (() => {
      const v = pct(pages.filter((p) => p.url.startsWith("https://") && !(p.mixed_content ?? 0)).length, pages.length);
      return v === null ? null : checks.https_redirect === false ? Math.round(v * 0.8) : v;
    })(),
    international: hreflangPages.length ? pct(hreflangPages.filter((p) => p.hreflang_valid).length, hreflangPages.length) : null,
    performance: pct(html.filter((p) => (p.response_ms ?? 0) <= 1000 && (p.size_bytes ?? 0) <= 2_000_000 && p.has_viewport).length, html.length),
    linking: pct(html.filter((p) => !has(p, "broken_internal_link") && !has(p, "orphan_page") && !has(p, "deep_page")).length, html.length),
    markup: pct(html.filter((p) => p.schema_types.length > 0 && p.schema_errors === 0).length, html.length),
    cwv: cwv.length ? pct(cwv.filter((c) => c.pass).length, cwv.length) : null,
  };

  // Issue counts: one per affected page, plus site-wide issues.
  const all = [...issueMap.values()].flat().concat(siteCodes);
  const counts = {
    errors: all.filter((c) => sev(c) === "error").length,
    warnings: all.filter((c) => sev(c) === "warning").length,
    notices: all.filter((c) => sev(c) === "notice").length,
  };

  // Pages per issue, kept per run for trends.
  const issueCounts: Record<string, number> = {};
  for (const c of all) issueCounts[c] = (issueCounts[c] ?? 0) + 1;

  await db().from("audit_runs").update({
    status: "completed", finished_at: new Date().toISOString(),
    pages_crawled: pages.filter((p) => p.status_code !== null && !(p.status_code >= 300 && p.status_code < 400)).length,
    scores, counts, issue_counts: issueCounts,
  }).eq("id", runId);
  clearCache();
}
