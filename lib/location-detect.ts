import { clearCache } from "./cache";
import { COUNTRIES, COUNTRY_CODES, isCountry, type CountryCode } from "./countries";
import { hasDataForSeo, searchLocations } from "./dataforseo";
import { config, requireEnv } from "./env";
import { postJson } from "./http";
import { db } from "./supabase";

// Finds where a business is based from its own website, so position tracking
// can check from that city without anyone typing it in.
//   1. Address in structured data (JSON-LD PostalAddress) on the homepage or contact page
//   2. Otherwise GPT reads the address from the footer and contact page text
//   3. The city is matched to DataForSEO's location list and saved on the brand

type Found = { city: string; region: string; country: string; source: "structured data" | "page text" };

const UA = { "User-Agent": "Mozilla/5.0 (compatible; AIVisibilityBot/1.0)" };
const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(COUNTRY_CODES.map((c) => [COUNTRIES[c].name.toLowerCase(), c]));
const ALIASES: Record<string, string> = { uk: "GB", "great britain": "GB", england: "GB", wales: "GB", scotland: "GB", "northern ireland": "GB", usa: "US", "united states of america": "US", uae: "AE" };

function toCountryCode(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase() === "UK" ? "GB" : s.toUpperCase();
  const l = s.toLowerCase();
  return COUNTRY_NAMES[l] ?? ALIASES[l] ?? null;
}

async function page(url: string) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000), redirect: "follow" });
    return r.ok ? (await r.text()).slice(0, 600_000) : "";
  } catch {
    return "";
  }
}

// PostalAddress inside any JSON-LD block.
export function fromJsonLd(html: string): Found | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const v = stack.pop() as any;
      if (Array.isArray(v)) { stack.push(...v); continue; }
      if (!v || typeof v !== "object") continue;
      const a = v.address ?? (String(v["@type"]).includes("PostalAddress") ? v : null);
      const addr = Array.isArray(a) ? a[0] : a;
      if (addr && typeof addr === "object" && addr.addressLocality) {
        const country = toCountryCode(typeof addr.addressCountry === "object" ? addr.addressCountry?.name : addr.addressCountry);
        return { city: String(addr.addressLocality), region: String(addr.addressRegion ?? ""), country: country ?? "", source: "structured data" };
      }
      stack.push(...Object.values(v));
    }
  }
  return null;
}

const textOf = (html: string) =>
  html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;/g, " ").replace(/\s+/g, " ").trim();

async function fromText(home: string, contact: string, domain: string): Promise<Found | null> {
  const h = textOf(home);
  const sample = [`Homepage start: ${h.slice(0, 1200)}`, `Homepage end (footer): ${h.slice(-2500)}`, `Contact page: ${textOf(contact).slice(0, 3000)}`].join("\n\n");
  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.parser,
      messages: [
        {
          role: "system",
          content: "From this business website text, find where the business is based (its office, shop or service base). Use only what the text says; return empty strings if unclear. country: ISO 3166 alpha-2 code.",
        },
        { role: "user", content: `Website: ${domain}\n\n${sample}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "location", strict: true,
          schema: { type: "object", additionalProperties: false, required: ["city", "region", "country"],
            properties: { city: { type: "string" }, region: { type: "string" }, country: { type: "string" } } },
        },
      },
    },
  );
  const out = JSON.parse(raw.choices[0].message.content) as { city: string; region: string; country: string };
  return out.city ? { city: out.city, region: out.region, country: toCountryCode(out.country) ?? "", source: "page text" } : null;
}

// Country from the domain ending when the site doesn't say (.co.uk → GB).
function countryFromDomain(domain: string): string | null {
  const tld = domain.split(".").pop()!;
  const map: Record<string, string> = { uk: "GB", in: "IN", au: "AU", ca: "CA", ae: "AE", sg: "SG", de: "DE", fr: "FR" };
  return map[tld] ?? null;
}

export async function detectLocation(brandId: string, domain: string) {
  const home = await page(`https://${domain}/`);
  const contactPath = home.match(/href=["']([^"']*contact[^"']*)["']/i)?.[1];
  const contactUrl = contactPath ? new URL(contactPath, `https://${domain}/`).toString() : `https://${domain}/contact`;
  const contact = await page(contactUrl);

  let found = fromJsonLd(home) ?? fromJsonLd(contact);
  if (!found) found = await fromText(home, contact, domain).catch(() => null);

  const { data: brand } = await db().from("brands").select("countries, tracking_locations").eq("id", brandId).single();
  const locations = { ...((brand?.tracking_locations ?? {}) as Record<string, any>) };
  const result: Record<string, unknown> = { checked_at: new Date().toISOString(), found: null };

  const country = (found?.country && isCountry(found.country) ? found.country : null) ?? countryFromDomain(domain);
  if (found && country && isCountry(country) && hasDataForSeo()) {
    const options = await searchLocations(country as CountryCode, found.city);
    const city = found.city.toLowerCase();
    const region = found.region.toLowerCase();
    const best =
      options.find((l) => l.name.split(",")[0].toLowerCase() === city && (!region || l.name.toLowerCase().includes(region))) ??
      options.find((l) => l.name.split(",")[0].toLowerCase() === city) ??
      options[0];
    if (best) {
      if (!locations[country]) locations[country] = { code: best.code, name: best.name, auto: true, source: found.source };
      result.found = { country, name: best.name, source: found.source };
    }
  }
  locations._auto = result;

  // Make sure the detected country is one the brand is tracked in.
  const countries: string[] = brand?.countries ?? [];
  const update: Record<string, unknown> = { tracking_locations: locations };
  if (country && isCountry(country) && !countries.includes(country)) update.countries = [...countries, country];
  await db().from("brands").update(update).eq("id", brandId);
  clearCache();
  return result;
}

// Runs detection once per brand (call again with force to retry).
export async function ensureLocation(brandId: string, domain: string, force = false) {
  const { data } = await db().from("brands").select("tracking_locations").eq("id", brandId).single();
  if (!force && (data?.tracking_locations as any)?._auto) return;
  await detectLocation(brandId, domain);
}
