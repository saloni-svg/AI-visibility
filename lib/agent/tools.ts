import { loadOverview } from "../overview";
import { matchesDomain } from "../data";
import { db } from "../supabase";
import { isIndexed, searchSite } from "../rag/search";

// The tools the content agent can call. Each returns plain text/JSON for the
// model. Website reading is limited to the brand's own domain.

type Ctx = { brandId: string; domain: string; runId: string };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

async function getText(url: string, timeoutMs = 12_000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AIVisibilityAgent/1.0)" },
    redirect: "follow",
  });
  return { ok: res.ok, status: res.status, text: (await res.text()).slice(0, 600_000), url: res.url };
}

const strip = (html: string) =>
  html
    .replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function onSite(url: string, domain: string) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${domain}${url.startsWith("/") ? "" : "/"}${url}`);
    return matchesDomain(u.hostname, domain) ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---- Tool definitions (OpenAI function calling) ----
export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "get_visibility_gaps",
      description: "The brand's latest AI visibility results: score, questions where AI doesn't name the brand, missing topics with AI search volume, competitors named instead, websites AI cites without the brand, and the brand's pages AI already cites.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_site_pages",
      description: "Lists pages of the brand's website from its sitemap (or homepage links).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description: "Reads one page of the brand's own website: title, meta description, headings, structured data types, FAQ presence, word count and main text.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Full URL or path on the brand's domain" } },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_site",
      description: "Searches the brand's whole website by meaning and returns the closest sections (URL, heading, exact text). Use it to find exactly where on the site a question is or isn't answered, and to quote current text in page_update drafts.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "A question or topic" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_ai_access",
      description: "Checks robots.txt for AI crawlers (GPTBot, OAI-SearchBot, Google-Extended, PerplexityBot, ClaudeBot, Bingbot) and whether /llms.txt exists.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_ai_answers",
      description: "What each AI assistant answered to one tracked question in the latest check: answer text, brands named and sources cited. Use it to see why competitors win.",
      parameters: {
        type: "object",
        properties: { question: { type: "string", description: "The question text, or a distinctive part of it" } },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_draft",
      description: "Saves one ready-to-use piece of content for the brand to publish.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["new_page", "page_update", "faq", "schema", "ai_access", "listing_pitch"] },
          title: { type: "string", description: "Short name of the draft, e.g. 'New page: SEO services in Ahmedabad'" },
          target_url: { type: "string", description: "Existing page to change, or the suggested URL for a new page" },
          target_questions: { type: "array", items: { type: "string" }, description: "Tracked questions this should help win" },
          reason: { type: "string", description: "1-2 sentences: the gap this fixes, with evidence from the data" },
          content: { type: "string", description: "The full content in Markdown, or code (JSON-LD, robots.txt, llms.txt)" },
        },
        required: ["kind", "title", "reason", "content"],
        additionalProperties: false,
      },
    },
  },
] as const;

// ---- Tool implementations ----
async function getVisibilityGaps(ctx: Ctx) {
  const o = await loadOverview({ domain: ctx.domain, country: "all", platform: "all" });
  if (o.state !== "ok") return { error: "No completed visibility check for this domain yet." };
  const allTopics = [...o.performingTopics, ...o.topicOpportunities];
  const missingQuestions = allTopics.flatMap((t) =>
    t.prompts
      .filter((p) => p.type === "unbranded" && p.answers.length && p.answers.every((a) => !a.mentioned))
      .map((p) => ({ question: p.text, topic: t.name, intent: p.intent })),
  );
  return {
    brand: o.brand.name,
    domain: o.brand.domain,
    visibility_score: o.score,
    note: o.scoreNote,
    by_ai_source: o.distribution.filter((d) => d.available).map((d) => ({ source: d.label, answers: d.answers, mentions: d.mentions })),
    questions_where_brand_is_missing: missingQuestions.slice(0, 15),
    missing_topics: o.topicOpportunities.slice(0, 8).map((t) => ({
      topic: t.name, ai_search_volume: t.volume?.volume ?? null, brands_named_instead: t.topBrands,
    })),
    performing_topics: o.performingTopics.slice(0, 6).map((t) => ({ topic: t.name, visibility: t.visibility })),
    sites_citing_others_not_brand: o.sourceOpportunities.slice(0, 10),
    brand_pages_ai_cites: o.citedPages.slice(0, 10).map((p) => ({ url: p.url, times: p.count })),
  };
}

async function listSitePages(ctx: Ctx) {
  const urls = new Set<string>();
  const fromXml = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  try {
    const main = await getText(`https://${ctx.domain}/sitemap.xml`);
    if (main.ok) {
      const locs = fromXml(main.text);
      const children = locs.filter((u) => u.endsWith(".xml")).slice(0, 4);
      for (const u of locs.filter((u) => !u.endsWith(".xml"))) urls.add(u);
      for (const child of children) {
        try {
          const c = await getText(child);
          if (c.ok) for (const u of fromXml(c.text)) urls.add(u);
        } catch { /* skip a broken child sitemap */ }
      }
    }
  } catch { /* fall back to homepage links */ }
  if (!urls.size) {
    const home = await getText(`https://${ctx.domain}`);
    for (const m of home.text.matchAll(/href=["']([^"'#]+)["']/gi)) {
      const u = onSite(m[1], ctx.domain);
      if (u && !/\.(png|jpe?g|gif|svg|webp|css|js|pdf|ico)(\?|$)/i.test(u)) urls.add(u.replace(/\/$/, ""));
    }
  }
  const list = [...urls].filter((u) => onSite(u, ctx.domain));
  return { pages: list.slice(0, 80), total_found: list.length };
}

async function readPage(ctx: Ctx, url: string) {
  const target = onSite(url, ctx.domain);
  if (!target) return { error: `Only pages on ${ctx.domain} can be read.` };
  const page = await getText(target);
  if (!page.ok) return { url: target, error: `HTTP ${page.status}` };
  const html = page.text;
  const pick = (re: RegExp) => html.match(re)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() ?? "";
  const headings = [...html.matchAll(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => `${m[1].toUpperCase()}: ${m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}`)
    .filter((h) => h.length > 4)
    .slice(0, 30);
  const schemaTypes = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const text = strip(html);
  return {
    url: page.url,
    title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
    meta_description: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    headings,
    structured_data_types: [...new Set(schemaTypes)],
    has_faq: /faq/i.test(html) || schemaTypes.includes("FAQPage"),
    word_count: text.split(" ").length,
    text: clip(text, 5000),
  };
}

const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "Google-Extended", "PerplexityBot", "ClaudeBot", "Bingbot"];

async function checkAiAccess(ctx: Ctx) {
  let robots = "";
  try {
    const r = await getText(`https://${ctx.domain}/robots.txt`);
    robots = r.ok ? r.text : "";
  } catch { /* no robots.txt */ }
  // Group rules by user-agent, then see whether "/" is disallowed for each bot.
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) {
      if (!current || current.disallow.length) groups.push((current = { agents: [], disallow: [] }));
      current.agents.push(v.toLowerCase());
    } else if (/^disallow$/i.test(k) && current) current.disallow.push(v);
  }
  const blocked = (bot: string) => {
    const g = groups.find((x) => x.agents.includes(bot.toLowerCase())) ?? groups.find((x) => x.agents.includes("*"));
    return !!g?.disallow.some((d) => d === "/");
  };
  let llms = false;
  try {
    llms = (await getText(`https://${ctx.domain}/llms.txt`, 8000)).ok;
  } catch { /* missing */ }
  return {
    robots_txt_found: !!robots,
    crawlers: AI_BOTS.map((b) => ({ bot: b, blocked: blocked(b) })),
    llms_txt_found: llms,
    robots_txt: clip(robots, 1500),
  };
}

async function readAiAnswers(ctx: Ctx, question: string) {
  const { data: prompts } = await db().from("prompts").select("id, text").eq("brand_id", ctx.brandId);
  const q = question.toLowerCase();
  const prompt =
    (prompts ?? []).find((p) => p.text.toLowerCase() === q) ??
    (prompts ?? []).find((p) => p.text.toLowerCase().includes(q) || q.includes(p.text.toLowerCase()));
  if (!prompt) return { error: "No tracked question matches. Use a question from get_visibility_gaps." };
  const { data: answers } = await db()
    .from("answers")
    .select("id, provider, answer_text, created_at")
    .eq("prompt_id", prompt.id)
    .not("answer_text", "is", null)
    .neq("answer_text", "")
    .order("created_at", { ascending: false })
    .limit(8);
  const latest = new Map<string, { id: string; provider: string; answer_text: string }>();
  for (const a of answers ?? []) if (!latest.has(a.provider)) latest.set(a.provider, a);
  const ids = [...latest.values()].map((a) => a.id);
  const [{ data: mentions }, { data: sources }] = await Promise.all([
    db().from("mentions").select("answer_id, name, position").in("answer_id", ids),
    db().from("sources").select("answer_id, url").in("answer_id", ids),
  ]);
  return {
    question: prompt.text,
    answers: [...latest.values()].map((a) => ({
      ai: a.provider,
      answer: clip(a.answer_text, 1800),
      brands_named: (mentions ?? []).filter((m) => m.answer_id === a.id).sort((x, y) => x.position - y.position).map((m) => m.name),
      sources: (sources ?? []).filter((s) => s.answer_id === a.id).slice(0, 8).map((s) => s.url),
    })),
  };
}

async function saveDraft(ctx: Ctx, args: any) {
  const { data, error } = await db()
    .from("content_drafts")
    .insert({
      brand_id: ctx.brandId,
      agent_run_id: ctx.runId,
      kind: String(args.kind ?? "new_page"),
      title: String(args.title ?? "Draft").slice(0, 200),
      target_url: args.target_url ? String(args.target_url) : null,
      target_questions: Array.isArray(args.target_questions) ? args.target_questions.map(String).slice(0, 10) : [],
      reason: args.reason ? String(args.reason) : null,
      content: String(args.content ?? ""),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { saved: true, id: data.id };
}

// Runs one tool call. Returns the result for the model and a short line for the activity log.
export async function runTool(ctx: Ctx, name: string, args: any): Promise<{ result: unknown; log: string }> {
  try {
    switch (name) {
      case "get_visibility_gaps": {
        const r: any = await getVisibilityGaps(ctx);
        return { result: r, log: r.error ? r.error : `Read visibility results: ${r.questions_where_brand_is_missing?.length ?? 0} questions where you're missing, ${r.missing_topics?.length ?? 0} missing topics` };
      }
      case "list_site_pages": {
        const r = await listSitePages(ctx);
        return { result: r, log: `Found ${r.total_found} pages on ${ctx.domain}` };
      }
      case "read_page": {
        const r: any = await readPage(ctx, String(args.url ?? ""));
        return { result: r, log: r.error ? `Couldn't read ${args.url}: ${r.error}` : `Read ${r.url.replace(/^https?:\/\//, "")} (${r.word_count} words)` };
      }
      case "search_site": {
        if (!(await isIndexed(ctx.brandId))) {
          return { result: { error: "The site isn't indexed yet. Use list_site_pages and read_page instead." }, log: "Site not indexed yet: reading pages instead" };
        }
        const matches = await searchSite(ctx.brandId, String(args.query ?? ""), 5);
        return {
          result: matches.map((m) => ({ url: m.url, heading: m.heading, similarity: Math.round(m.similarity * 100) / 100, text: clip(m.content, 900) })),
          log: `Searched your site for "${clip(String(args.query ?? ""), 60)}": ${matches.length} sections`,
        };
      }
      case "check_ai_access": {
        const r = await checkAiAccess(ctx);
        const blocked = r.crawlers.filter((c) => c.blocked).map((c) => c.bot);
        return { result: r, log: `Checked AI crawler access: ${blocked.length ? `blocked: ${blocked.join(", ")}` : "all allowed"}${r.llms_txt_found ? "" : ", no llms.txt"}` };
      }
      case "read_ai_answers": {
        const r: any = await readAiAnswers(ctx, String(args.question ?? ""));
        return { result: r, log: r.error ? r.error : `Read AI answers to "${clip(r.question, 70)}"` };
      }
      case "save_draft": {
        const r = await saveDraft(ctx, args);
        return { result: r, log: "error" in r ? `Couldn't save draft: ${r.error}` : `Drafted: ${args.title}` };
      }
      default:
        return { result: { error: `Unknown tool ${name}` }, log: `Unknown tool ${name}` };
    }
  } catch (err) {
    const message = (err as Error).message;
    return { result: { error: message }, log: `${name} failed: ${clip(message, 120)}` };
  }
}
