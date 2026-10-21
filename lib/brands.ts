import { config, requireEnv } from "./env";
import { postJson } from "./http";
import { domainRoot } from "./domain";
import { db } from "./supabase";

import { COUNTRY_CODES } from "./countries";

export type BrandSummary = { id: string; name: string; domain: string | null; countries: string[]; tracking_locations?: Record<string, unknown> };

export async function findBrand(domain: string): Promise<BrandSummary | null> {
  const { data, error } = await db().from("brands").select("id, name, domain, countries, tracking_locations").eq("domain", domain).maybeSingle();
  if (error) throw error;
  return data;
}

export async function setCountries(brandId: string, countries: string[]) {
  const valid = [...new Set(countries.filter((c) => COUNTRY_CODES.includes(c as never)))];
  if (!valid.length) throw new Error("Pick at least one country.");
  const { error } = await db().from("brands").update({ countries: valid }).eq("id", brandId);
  if (error) throw error;
}

export async function listBrands(): Promise<BrandSummary[]> {
  const { data, error } = await db().from("brands").select("id, name, domain, countries").order("created_at");
  if (error) throw error;
  return data ?? [];
}

// Reads the homepage so the prompt writer knows what the business does.
async function readHomepage(domain: string): Promise<string> {
  try {
    const res = await fetch(`https://${domain}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AIVisibilityTracker/1.0)" },
    });
    const html = (await res.text()).slice(0, 400_000);
    const pick = (re: RegExp) => html.match(re)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() ?? "";
    const text = html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 2500);
    return [
      `Title: ${pick(/<title[^>]*>([\s\S]*?)<\/title>/i)}`,
      `Description: ${pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)}`,
      `H1: ${pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i)}`,
      `Page text: ${text}`,
    ].join("\n");
  } catch {
    return "The website could not be read. Work from the domain name only.";
  }
}

type Plan = {
  brand_name: string;
  home_country: string;
  aliases: string[];
  prompts: { text: string; type: "branded" | "unbranded" }[];
};

const planSchema = {
  name: "brand_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["brand_name", "home_country", "aliases", "prompts"],
    properties: {
      brand_name: { type: "string" },
      home_country: { type: "string", enum: COUNTRY_CODES as string[] },
      aliases: { type: "array", items: { type: "string" } },
      prompts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "type"],
          properties: { text: { type: "string" }, type: { type: "string", enum: ["branded", "unbranded"] } },
        },
      },
    },
  },
};

const PLAN_INSTRUCTIONS = [
  "You set up AI-visibility tracking for a business, from its website.",
  "brand_name: the business name as customers write it.",
  "home_country: the country code of its main market (US if unclear).",
  "aliases: other ways people write that name (spaced, joined, short form). No generic words.",
  "prompts: exactly 10 unbranded and 5 branded questions.",
  "- unbranded: questions a real potential customer would ask ChatGPT when looking for this kind of business, WITHOUT naming it.",
  "  Mix: 'best X in <location>', 'how to choose X', 'affordable X for Y', 'top X companies for Z'. Include the location if the business serves a local area.",
  "- branded: questions that name the business: reviews, pricing, is it trustworthy, alternatives, comparison with competitors.",
  "Short, natural questions.",
].join("\n");

// Finds the brand for a domain. On first use, creates it and writes its prompts.
export async function ensureBrand(domain: string): Promise<BrandSummary> {
  let brand = await findBrand(domain);
  if (brand) {
    const { count } = await db().from("prompts").select("id", { count: "exact", head: true }).eq("brand_id", brand.id);
    if ((count ?? 0) > 0) return brand;
  }

  const homepage = await readHomepage(domain);
  const raw = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
    {
      model: config.models.parser,
      messages: [
        { role: "system", content: PLAN_INSTRUCTIONS },
        { role: "user", content: `Domain: ${domain}\n${homepage}` },
      ],
      response_format: { type: "json_schema", json_schema: planSchema },
    },
  );
  const plan = JSON.parse(raw.choices[0].message.content) as Plan;
  const name = plan.brand_name.trim() || domainRoot(domain);
  const aliases = [...new Set([...plan.aliases, domainRoot(domain)].map((a) => a.trim()).filter(Boolean))];

  const countries = [COUNTRY_CODES.includes(plan.home_country as never) ? plan.home_country : "US"];
  if (brand && brand.name === domain) {
    // Created by the site audit with only a domain: give it its real name now.
    await db().from("brands").update({ name, aliases, countries }).eq("id", brand.id);
    brand = { ...brand, name, countries };
  }
  if (!brand) {
    let insert = await db().from("brands").insert({ name, domain, aliases, countries }).select("id, name, domain, countries").single();
    // brands.name is unique: another domain may already use this name.
    if (insert.error?.code === "23505") {
      insert = await db().from("brands").insert({ name: `${name} (${domain})`, domain, aliases, countries }).select("id, name, domain, countries").single();
    }
    if (insert.error) throw insert.error;
    brand = insert.data;
  }

  const seen = new Set<string>();
  const rows = plan.prompts
    .map((p) => ({ brand_id: brand!.id, text: p.text.trim(), type: p.type, active: true }))
    .filter((p) => p.text && !seen.has(p.text) && seen.add(p.text));
  if (!rows.length) throw new Error("Could not write questions for this website.");
  const { error } = await db().from("prompts").insert(rows);
  if (error) throw error;
  return brand;
}

// A brand with only a domain (for the site audit). The Analyze button adds
// questions and the rest later, if needed.
export async function ensureBasicBrand(domain: string): Promise<BrandSummary> {
  const found = await findBrand(domain);
  if (found) return found;
  let insert = await db().from("brands").insert({ name: domain, domain, aliases: [domainRoot(domain)] }).select("id, name, domain, countries").single();
  if (insert.error?.code === "23505") {
    insert = await db().from("brands").insert({ name: `${domain} (site)`, domain, aliases: [domainRoot(domain)] }).select("id, name, domain, countries").single();
  }
  if (insert.error) throw insert.error;
  return insert.data;
}
