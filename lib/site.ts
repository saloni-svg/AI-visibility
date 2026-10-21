import { matchesDomain } from "./data";

// Reading the brand's own website: sitemap, pages, and sections by heading.

export async function getText(url: string, timeoutMs = 12_000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AIVisibilityAgent/1.0)" },
    redirect: "follow",
  });
  return { ok: res.ok, status: res.status, text: (await res.text()).slice(0, 800_000), url: res.url };
}

// Full URL on the brand's domain, or null for anything else.
export function onSite(url: string, domain: string) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${domain}${url.startsWith("/") ? "" : "/"}${url}`);
    return matchesDomain(u.hostname, domain) ? u.toString() : null;
  } catch {
    return null;
  }
}

// Pages that are rarely useful to index or quote.
const SKIP = /\/(tag|tags|category|author|feed|wp-json|wp-admin|cart|checkout|login|my-account|page\/\d+)(\/|$)|\.(png|jpe?g|gif|svg|webp|css|js|pdf|ico|xml|zip)(\?|$)/i;

export async function listSitePages(domain: string, limit = 150): Promise<string[]> {
  const urls = new Set<string>();
  const fromXml = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\s\]]+)/gi)].map((m) => m[1]);
  try {
    const main = await getText(`https://${domain}/sitemap.xml`);
    if (main.ok) {
      const locs = fromXml(main.text);
      for (const u of locs.filter((u) => !u.endsWith(".xml"))) urls.add(u);
      for (const child of locs.filter((u) => u.endsWith(".xml")).slice(0, 6)) {
        try {
          const c = await getText(child);
          if (c.ok) for (const u of fromXml(c.text)) urls.add(u);
        } catch { /* skip a broken child sitemap */ }
      }
    }
  } catch { /* fall back to homepage links */ }
  if (!urls.size) {
    const home = await getText(`https://${domain}`);
    urls.add(`https://${domain}/`);
    for (const m of home.text.matchAll(/href=["']([^"'#]+)["']/gi)) {
      const u = onSite(m[1], domain);
      if (u) urls.add(u);
    }
  }
  return [...urls].map((u) => onSite(u, domain)).filter((u): u is string => !!u && !SKIP.test(u)).slice(0, limit);
}

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8217;/g, "’").replace(/&#8211;/g, "–").replace(/&#\d+;/g, " ");

// Splits a page into sections, each under its nearest heading. Only real content
// is kept: paragraphs, list items, quotes and table cells. Buttons, badges,
// menus, author boxes and link-only items are dropped, so fixes are never anchored
// to "Get your free audit →" or "★★★★★ Rated 5.0".
const BLOCK = /<(h[1-4]|p|li|blockquote|td|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const words = (t: string) => t.split(" ").filter((w) => /[a-z]{2,}/i.test(w)).length;

function isContent(innerHtml: string, text: string) {
  if (text.length < 40 || words(text) < 7) return false; // labels, buttons, "Read more"
  if (/[★☆]|→|»/.test(text) && text.length < 160) return false; // ratings, CTA arrows
  // Mostly link text (menus, tag lists, "Book a call" links): skip.
  const withoutLinks = textOf(innerHtml.replace(/<a\b[\s\S]*?<\/a>/gi, " "));
  if (withoutLinks.length < text.length * 0.3) return false;
  return true;
}

export function pageSections(html: string): { title: string; sections: { heading: string; text: string }[] } {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const body = html.replace(/<(script|style|noscript|svg|nav|footer|form|iframe|aside|button|select)\b[\s\S]*?<\/\1>/gi, " ");

  const sections: { heading: string; text: string }[] = [];
  const seen = new Set<string>();
  let heading = title;
  let current: string[] = [];
  const flush = () => {
    if (current.length) sections.push({ heading, text: current.join("\n") });
    current = [];
  };
  for (const m of body.matchAll(BLOCK)) {
    const tag = m[1].toLowerCase();
    const text = textOf(m[2]);
    if (!text) continue;
    if (tag.startsWith("h")) {
      flush();
      heading = text;
    } else if (isContent(m[2], text) && !seen.has(text)) {
      seen.add(text);
      current.push(text);
    }
  }
  flush();
  if (sections.length >= 2) return { title, sections };

  // Fallback for sites that put text in plain <div>s: older, looser splitting.
  const loose = body
    .replace(/<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => `\n§§H:${inner.replace(/<[^>]+>/g, " ")}§§\n`)
    .replace(/<\/(p|li|div|section|article|tr|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const out: { heading: string; text: string }[] = [];
  heading = title;
  for (const part of decode(loose).split(/§§/)) {
    const isHeading = part.startsWith("H:");
    const lines = (isHeading ? part.slice(2) : part).split("\n").map((l) => l.replace(/\s+/g, " ").trim());
    if (isHeading) { heading = lines.filter(Boolean).join(" "); continue; }
    const kept = lines.filter((l) => l.length >= 40 && words(l) >= 7 && !(/[★☆]|→/.test(l) && l.length < 160));
    if (kept.length) out.push({ heading, text: kept.join("\n") });
  }
  return { title, sections: out };
}

// Sections → chunks of about 900 characters, split on sentence ends.
export function chunk(sections: { heading: string; text: string }[], max = 900): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  for (const s of sections) {
    let buf = "";
    for (const sentence of s.text.split(/(?<=[.!?])\s+|\n/)) {
      if ((buf + " " + sentence).length > max && buf.length > 200) {
        out.push({ heading: s.heading, text: buf.trim() });
        buf = "";
      }
      buf += (buf ? " " : "") + sentence;
    }
    if (buf.trim().length >= 80) out.push({ heading: s.heading, text: buf.trim() });
  }
  // Drop text repeated on many pages, e.g. the same contact block.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.text) ? false : (seen.add(c.text), true))).slice(0, 40);
}
