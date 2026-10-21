# AI Visibility Tracker

This project tracks how often AI assistants (ChatGPT/OpenAI, Gemini, Perplexity) mention your brand and your competitors, and which websites they cite.

- **Step 1:** the database and a data collection script.
- **Step 2:** a dashboard showing the results (`npm run dev`, then open http://localhost:3000).

## How it works

1. You save **prompts** (questions) in the database, for example "What is the best tool for a team wiki?"
2. `npm run track` asks every prompt to OpenAI, Gemini and Perplexity **3 times each**, because AI answers vary from one call to the next. Each raw answer goes into the `answers` table.
3. A cheap model (`gpt-4.1-mini` by default) reads each answer and returns JSON listing:
   - every brand mentioned, and its **position** (1 = mentioned first)
   - every URL cited in the text
4. Brands are matched against your brand and competitors and saved to `mentions`. Cited URLs go to `sources`.

## The tables

| Table | What it holds |
|---|---|
| `brands` | Your brand: name, domain and other spellings (aliases) |
| `competitors` | Rival brands, linked to your brand |
| `prompts` | Questions to ask. `type` is `branded` (names your brand) or `unbranded` (doesn't) |
| `runs` | One row each time you run the script |
| `answers` | One raw AI reply: which prompt, which provider, which attempt (1–3), the text and the full API response |
| `mentions` | Brands found in an answer, with their position. `brand_id` or `competitor_id` is filled in when the name matches yours or a known competitor |
| `sources` | URLs cited in an answer. `origin` is `api` when the provider listed the URL as a source, or `text` when it was written in the answer itself |

The full API response is kept in `answers.raw_response`, so you can improve the parser later and re-run it on old answers without paying for new AI calls.

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the database

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste in `supabase/migrations/0001_init.sql` and run it.
3. Optional: run `supabase/seed.sql` to add an example brand, competitors and prompts. Edit it first to use your own.

If you use the Supabase CLI instead: `supabase db push`.

### 3. Add your API keys

```bash
cp .env.example .env
```

Then fill in `.env`:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: in Supabase, under **Project Settings → API**
- `OPENAI_API_KEY`: from platform.openai.com. It's used for both answering and parsing.
- `GEMINI_API_KEY`: from aistudio.google.com
- `PERPLEXITY_API_KEY`: from the API Console at console.perplexity.ai. Check it works with `npm run smoke:perplexity`, which sends one small request and prints only the status and response shape.

`.env` is in `.gitignore`, so your keys are never committed. If a provider's key is missing, the script skips that provider.

### 4. Run it

```bash
npm run track                               # ask all prompts, save answers, parse them
npm run track -- --providers=openai,gemini  # only some providers
npm run track -- --skip-parse               # collect now, parse later
npm run parse                               # parse any answers not parsed yet
npm run parse -- --run=<run id> --force     # re-parse one run
```

**Cost:** each run makes `prompts × providers × 3` AI calls, plus one parser call per answer. For example, 10 prompts give 90 answer calls and 90 parser calls.

## The dashboard

```bash
npm run dev
```

Open http://localhost:3000. It reads straight from Supabase, so reload after each `npm run track`.

**Accounts.** The dashboard needs a login. Create one at http://localhost:3000/signup, then sign in at `/login`. The side panel on the left jumps to each section and has a **Log out** button at the bottom.

- Add `SUPABASE_PUBLISHABLE_KEY` to `.env` (Supabase → Project Settings → API Keys → Publishable key).
- Supabase emails a confirmation link after sign-up. In Supabase → Authentication → URL Configuration, make sure **Site URL** is `http://localhost:3000` and add `http://localhost:3000/**` under **Redirect URLs**. To skip the email while testing, turn off **Confirm email** under Authentication → Sign In / Providers → Email.
- Anyone who can open the dashboard can sign up. Once your team has accounts, you can turn off **Allow new users to sign up** in the same settings.

- **Filters:** pick a run, and show all questions, only unbranded or only branded ones. Everything on the page follows the filters.
- **Summary:** how often you're mentioned (with the change since the previous run), your average position, how often your own website is cited, and how many answers were analysed.
- **You vs competitors:** mention rate per AI tool for you and each competitor.
- **Over time:** your mention rate per AI tool across runs (needs 2+ runs).
- **Who AI recommends:** every brand named in the answers, including ones you aren't tracking yet.
- **Most-cited websites:** the sources the AIs rely on.
- **Question by question:** for each prompt and AI tool, how many tries mentioned you and your best position.

The dashboard uses the service role key on the server only; it is never sent to the browser.

## Settings (optional, in `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4.1-mini` | Model that answers prompts (with web search) |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model that answers prompts (with Google Search) |
| `PERPLEXITY_PRESET` | `fast` | Perplexity Agent API preset: `fast`, `low`, `medium`, `high`, `xhigh` (deeper = slower and pricier) |
| `PERPLEXITY_MODEL` | (unset) | Use this model (e.g. `openai/gpt-5.6-sol`) with web search instead of the preset |
| `PARSER_MODEL` | `gpt-4.1-mini` | Cheap OpenAI model that extracts the JSON |
| `ATTEMPTS_PER_PROMPT` | `3` | How many times each provider is asked each prompt |
| `CONCURRENCY` | `4` | How many API calls run at the same time |

## Code map

```
supabase/migrations/0001_init.sql   database tables
supabase/seed.sql                   example data
lib/providers/                      one file per AI provider (call + read the answer)
lib/parser.ts                       cheap-model JSON extraction, brand matching, saving
lib/env.ts                          loads .env and the settings above
scripts/track.ts                    main script: ask, save, parse
scripts/parse.ts                    re-run the parser on saved answers
lib/dashboard.ts                    loads and summarises the data for the dashboard
app/(dashboard)/                    dashboard page and the layout with the side panel
app/(auth)/                         sign-in and sign-up pages, and the login/logout actions
app/auth/callback/                  handles the link in the sign-up confirmation email
app/components/                     dashboard view, side panel, auth form, tooltips, charts
lib/auth.ts                         Supabase Auth helpers
proxy.ts                            sends signed-out visitors to the sign-in page
```

## Notes

- Perplexity answers come from the [Agent API](https://docs.perplexity.ai/docs/agent-api/quickstart) (`POST /v1/agent`) through the official `@perplexity-ai/perplexity_ai` SDK. Sources are the URLs the answer cites inline, followed by every page its web search returned.
- Gemini returns redirect links (`vertexaisearch.cloud.google.com/...`) as sources. The real website domain is in the title, so that's what goes in `sources.domain`.
- Row-level security is on for every table with no policies, so only the service role key (used by the scripts) can read or write. Read policies will be added with the dashboard.

## Analyze any website (dashboard)

1. Open http://localhost:3000 and log in.
2. Enter a domain and press **Analyze**. For a new domain the app reads the homepage, writes 10 unbranded + 5 branded questions, saves the brand and prompts, then asks every AI tool with a key in `.env`. A progress bar shows each step.
3. If the domain was checked in the last 7 days, the saved results open straight away. **Run new check** forces fresh answers.
4. **Visibility overview** (`/?domain=example.com`) shows the dashboard for that domain only.
5. **Competitor research** (`/competitors?domain=example.com`): type up to four competitor domains or names and press **Compare**. Past mentions are re-linked to the new competitors, so the overview's "You vs competitors" chart updates too. It shows mentions and share per brand, the trend, questions where you're Missing / Weak / Shared / Strong / Unique, cited websites, and sites that cite competitors but not you. "AI also recommends" lists brands you could add with one click.

Competitor research uses unbranded questions only, so your own brand name in a question doesn't skew the comparison.

`npm run track -- --domain=example.com` now runs one brand only. Without `--domain` it still runs every active prompt.

### New and changed files

| File | What changed |
|---|---|
| `lib/brands.ts` | New: finds or creates a brand from a domain and writes its questions |
| `lib/analyze.ts` | New: runs a website check in small steps |
| `lib/collect.ts` | New: asks one provider one question and saves the answer (shared with `track`) |
| `lib/competitors.ts` | New: saves competitors, re-links mentions, builds the comparison |
| `lib/domain.ts` | New: cleans domains like `https://www.x.com/` to `x.com` |
| `lib/dashboard.ts` | Loads one brand by domain; only shows runs that include that brand |
| `lib/parser.ts` | `matches` and `normalize` exported for re-linking |
| `lib/env.ts` | New settings for website checks |
| `app/(dashboard)/page.tsx` | Start page with the domain box; overview when `?domain=` is set |
| `app/(dashboard)/analyze/page.tsx` | New: progress page |
| `app/(dashboard)/competitors/page.tsx` | New: competitor research |
| `app/(dashboard)/actions.ts` | New: server actions for analyze and competitors |
| `app/components/*` | Domain form, progress, competitor form, sidebar page links |
| `scripts/track.ts` | Uses the shared collector; new `--domain=` option |

## Step 1: Visibility Overview

Before first use, run `supabase/migrations/0002_visibility_overview.sql` in the Supabase SQL editor (adds countries, topics, AI volume and recommendations; existing data is kept and marked as US).

Add `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` to `.env`.

What the overview shows, per domain, with filters for country, AI source and check date:

| Section | How it's calculated |
|---|---|
| AI visibility score | 0–100. Average over answers to unbranded questions: 100 if you're named first, less for lower positions, 0 if not named. Low < 30, Medium < 60, High ≥ 60 |
| Mentions / Citations / Cited pages | Answers naming you / links to your domain / different pages of your domain linked. Change vs the previous check, and a trend line |
| Distribution by AI source | Share of your mentions (or cited pages) from ChatGPT, Google AI Overview, Gemini and Perplexity. n/a = no answers from that source |
| Mentions by country | Your mentions in each country you check from. Add countries with **+ Countries** |
| What's next? | 3 recommendations written by GPT after each check, from the data below |
| Topics & sources | Questions grouped into topics with intent and AI volume. Tabs: performing topics, topic opportunities, cited sources, source opportunities, cited pages. Open a topic to see each AI's answer |

Sources:
- **Google AI Overview**: DataForSEO SERP API (`lib/providers/aiOverview.ts`). Searches without an AI Overview count as "no overview", not as errors.
- **AI volume**: DataForSEO AI keyword search volume for each topic's keyword, refreshed every 30 days (`lib/topics.ts`). If that endpoint isn't on your plan, Google search volume is used instead and the page says so.
- **Countries**: ChatGPT and AI Overview use their own location setting; Gemini and Perplexity get "I'm based in <country>" added to the question.

Cost per check ≈ questions × AI sources × countries. 15 questions × 4 sources × 1 country = 60 calls.

## Content agent

Sidebar → **Content agent**. Press **Run agent** (optionally type a focus). The agent is a tool-calling loop on `AGENT_MODEL` (default `gpt-4.1`):

1. Reads your visibility gaps (questions and topics where AI names competitors, not you)
2. Checks robots.txt for AI crawlers and whether `/llms.txt` exists
3. Lists your pages (sitemap) and reads the relevant ones
4. Reads what each AI answered to the most valuable missing questions
5. Writes 3–5 drafts: new pages, page updates, FAQ blocks, JSON-LD, robots.txt / llms.txt fixes, listing pitches
6. Writes a short report

Every step shows live. Drafts can be viewed, copied, downloaded, marked published or dismissed.
Rules it follows: only facts from your site or data, `[ADD: …]` placeholders for anything unknown, reads only your own domain, ignores instructions found inside web pages.

Files: `lib/agent/tools.ts` (tools), `lib/agent/run.ts` (loop), `app/(dashboard)/agent/page.tsx`.
Tables: `agent_runs`, `content_drafts` (`supabase/migrations/0003_content_agent.sql`).
Settings: `AGENT_MODEL` (default gpt-4.1), `AGENT_MAX_STEPS` (default 14). A run costs roughly $0.05–0.25.

## Page fixes (RAG over your website)

Sidebar → **Page fixes**.

1. **Index site**: reads every page in the sitemap, splits each into sections under their headings (~900 characters), and stores an embedding per section (`text-embedding-3-small`) in Supabase pgvector (`page_chunks`). Unchanged pages are skipped on re-index (content hash).
2. **Find exact fixes**: for each question where AI doesn't name you, embeds the question, retrieves your 4 closest sections (`match_page_chunks`, cosine similarity), and has `AGENT_MODEL` rewrite or extend exactly those sections. Each fix shows today's text next to the new text; the quoted text is checked against the page.
3. **Search your site by meaning**: test retrieval with any question.

The Content agent gets a `search_site` tool, and "What's next?" cards include your closest sections, so both point at real pages.

Tables: `site_pages`, `page_chunks`, `page_fixes` (`supabase/migrations/0004_site_rag.sql`). Indexing ~70 pages costs about $0.01.

## Position tracking

Sidebar → **Position tracking**. Add keywords (or **Suggest keywords with AI**), pick a country, press **Check positions**.

For each keyword, DataForSEO's live Google results (top 100) give: your position and ranking page, competitors' positions (domains from Competitor research), SERP features, and whether Google's **AI Overview** appears and cites you. Search volume comes from DataForSEO (Google Ads data), refreshed monthly.

Shown: Visibility % (click-share curve by position), estimated traffic (volume × click share), average position (not ranking = 100), Top 3/10/20/100, AI Overview citations, trends per check, position change since the last check, and the Google top 10 per keyword. If you don't rank, **Best match** shows your page that fits the keyword best (vector search over your indexed site).

Tables: `tracked_keywords`, `position_runs`, `keyword_checks` (`supabase/migrations/0005_position_tracking.sql`). Cost ≈ $0.002 per keyword per check.

## Site audit

Sidebar → **Site audit** lists every website (project). **Set up** / **Create project** starts an audit; **Re-run audit** repeats it.

The crawler (`lib/audit/crawl.ts`) starts at the homepage plus sitemap URLs, follows internal links (up to `AUDIT_PAGE_LIMIT`, default 100), and records each page: status, redirects, response time, size, title, meta description, H1s, word count, canonical, noindex, hreflang, JSON-LD types and errors, images without alt, internal links, mixed content and viewport. Site-wide: robots.txt, sitemap, HTTP→HTTPS redirect, AI crawlers blocked in robots.txt, llms.txt. Then cross-page checks: broken internal links, duplicate titles/descriptions, orphan pages, link depth, links that redirect. Core Web Vitals come from Google PageSpeed Insights for the homepage and the 2 most-linked pages (add `PAGESPEED_API_KEY` for reliable results).

Scores: **Site Health** (share of pages without errors/warnings, minus site-wide problems), **AI Search Health** (indexable, enough text without JavaScript, title, description, H1, valid structured data; minus blocked AI crawlers and missing llms.txt), and Crawlability, HTTPS, International SEO, Site performance, Internal linking, Markups, Core Web Vitals (% of pages passing). All checks and fixes: `lib/audit/issues.ts`.

Tables: `audit_runs`, `audit_pages` (`supabase/migrations/0006_site_audit.sql`). No paid API needed.

### Rank per platform (position tracking)

Each check can also look up the keyword on **Google Maps** (DataForSEO Maps, top 20) and ask **ChatGPT, Gemini and Perplexity** "I'm looking for <keyword>. Which specific businesses or brands do you recommend?". The answer is parsed (GPT-4.1 mini, structured output) into the brands named in order; your position = where your brand is first named, plus 🔗 if the answer links to your site. AI Overview shows "Cited #N" = your position among its sources. Choose platforms with the checkboxes before **Check positions** (AI platforms add ~$0.015 per keyword and ~1 minute per 10 keywords).

### Location detected from the website

On Analyze (and the first visit to Position tracking) the app finds where the business is based: first from the address in the site's structured data (JSON-LD PostalAddress on the homepage or contact page), otherwise GPT reads the address from the footer and contact page. The city is matched to DataForSEO's location list and saved per country (the country is added to the brand if needed; the domain ending is used when the site doesn't say). A location you choose yourself is never overwritten. Code: `lib/location-detect.ts`.

## Review management

Sidebar → **Review management**. **Connect to Google** searches Google Maps (DataForSEO) for the business by name/domain (in its detected city), shows matching listings ("Matches your website" first) and you confirm yours. Reviews are then fetched with DataForSEO's Google Reviews API (a task; the page checks every 5 seconds, usually 1–3 minutes), newest first, up to `REVIEWS_DEPTH` (default 500). Shows rating, star distribution, replied %, reviews needing a reply, filters, search and sort. **Draft reply with AI** writes a reply to copy into Google (**Reply on Google** opens the review). Posting replies directly would need Google Business Profile API access (Google approval + owner login).

Tables: `review_sources`, `reviews` (`supabase/migrations/0007_reviews.sql`). Cost ≈ $0.01 per 100 reviews.

## Keyword research (Keyword Overview)

Sidebar → **Keyword research → Keyword overview**. Enter a keyword, country and device:
- **Volume, CPC, Competitive density, 12-month trend**: DataForSEO Google Ads data
- **Global volume by country**: DataForSEO clickstream global search volume
- **Keyword difficulty, Intent**: DataForSEO Labs
- **Keyword variations and Questions** (up to 1,000, with volume, KD, CPC, intent; full list with filter and CSV export): Labs keyword suggestions
- **Keyword strategy**: GPT groups the top variations into subpages under one pillar page
- **SERP analysis**: live top 100 (pages of 10), results count, SERP features, search traffic and URL keywords (Labs traffic estimation). Page AS, referring domains and backlinks come from the DataForSEO Backlinks API when your account has it
- **PLA copies, Ad copies**: shopping and ad results from the same search
- **Enter domain for personalized data**: shows where that site ranks and highlights it

Results are saved for 7 days (`keyword_research` table, `supabase/migrations/0008_keyword_research.sql`); **Update metrics** refreshes. About $0.10–0.15 per new keyword.

## Change explainer

Sidebar → **AI Analysis → Change explainer**. Pick two checks (before → after) and click **Explain changes**:
- **What changed**: share of answers naming you, overall, unbranded, per AI and per country, with a two-proportion z-test ("Real change" when p < 0.05). Only question × AI × country pairs asked in both checks are compared.
- **Questions that changed**: now named / dropped, with the before and after answers side by side.
- **Brands and cited sources** that appeared, disappeared or moved; your own cited pages.
- **Did the website change?** Key pages are saved after every check (`page_snapshots`); the two moments are compared (title, word count, added/removed sentences, status).
- **Re-test changed questions**: asks each changed question 3 more times now and says if the change is confirmed.
- **Explanation**: GPT-4.1 gets only numbered evidence (E1, E2…), must cite it for every finding, and claims citing nothing real are removed.

Tables: `page_snapshots`, `visibility_explanations` (`supabase/migrations/0009_change_explainer.sql`).
