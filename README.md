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
