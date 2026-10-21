-- Step 1: Visibility Overview (countries, Google AI Overview, topics, AI volume, recommendations)
-- Safe to run on an existing database: only adds columns/tables. Existing answers become country 'US'.

-- Countries each brand is checked in (ISO codes, e.g. {US,IN}).
alter table brands add column if not exists countries text[] not null default '{US}';

-- Topic and search intent for each question.
alter table prompts add column if not exists topic text;
alter table prompts add column if not exists intent text
  check (intent is null or intent in ('informational', 'commercial', 'transactional', 'navigational'));

-- Which country an answer was asked from, and Google AI Overview as a 4th source.
alter table answers add column if not exists country text not null default 'US';
alter table answers drop constraint if exists answers_provider_check;
alter table answers add constraint answers_provider_check
  check (provider in ('openai', 'gemini', 'perplexity', 'ai_overview'));
alter table answers drop constraint if exists answers_run_id_prompt_id_provider_attempt_key;
alter table answers drop constraint if exists answers_run_prompt_provider_attempt_country_key;
alter table answers add constraint answers_run_prompt_provider_attempt_country_key
  unique (run_id, prompt_id, provider, attempt, country);

-- Topics: a short keyword per topic, used to look up AI search volume.
create table if not exists topics (
  brand_id    uuid not null references brands(id) on delete cascade,
  name        text not null,
  keyword     text not null,
  created_at  timestamptz not null default now(),
  primary key (brand_id, name)
);

-- Monthly AI search volume per topic and country (from DataForSEO).
create table if not exists topic_volumes (
  brand_id    uuid not null references brands(id) on delete cascade,
  topic       text not null,
  country     text not null,
  volume      integer,
  monthly     jsonb,                 -- [{ "month": "2026-09", "volume": 120 }, ...]
  source      text,                  -- 'ai' (AI search volume) or 'google' (fallback)
  updated_at  timestamptz not null default now(),
  primary key (brand_id, topic, country)
);

-- "What's next?" recommendations written after each run.
create table if not exists brand_insights (
  brand_id    uuid not null references brands(id) on delete cascade,
  run_id      uuid not null references runs(id) on delete cascade,
  insights    jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (brand_id, run_id)
);

alter table topics enable row level security;
alter table topic_volumes enable row level security;
alter table brand_insights enable row level security;
