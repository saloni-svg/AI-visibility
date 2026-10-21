-- Prompt tracking: campaigns that ask AI assistants a fixed set of prompts and record, on every
-- check, whether the answer names the brand (and where), whether the site is cited, and who else appears.

create table if not exists pt_campaigns (
  id           uuid primary key default gen_random_uuid(),
  domain       text not null,
  brand_name   text not null,
  aliases      text[] not null default '{}',
  engines      text[] not null default '{}',          -- openai | gemini | perplexity | ai_overview
  country      text not null,
  location     jsonb,                                  -- { code, name } city or region, null = whole country
  language     text not null default 'en',
  device       text not null default 'desktop',        -- Google AI Overview only
  competitors  text[] not null default '{}',           -- names or domains to follow
  last_run_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists pt_prompts (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references pt_campaigns(id) on delete cascade,
  prompt       text not null,
  tags         text[] not null default '{}',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (campaign_id, prompt)
);

-- One "check" of every prompt on every engine.
create table if not exists pt_runs (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references pt_campaigns(id) on delete cascade,
  status       text not null default 'running' check (status in ('running', 'completed', 'failed')),
  total        integer not null default 0,
  done         integer not null default 0,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table if not exists pt_checks (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references pt_runs(id) on delete cascade,
  campaign_id      uuid not null references pt_campaigns(id) on delete cascade,
  prompt_id        uuid not null references pt_prompts(id) on delete cascade,
  engine           text not null,
  answered         boolean not null default true,      -- false: e.g. Google showed no AI Overview
  mentioned        boolean not null default false,     -- the answer names the brand
  position         integer,                            -- 1 = first brand named
  cited            boolean not null default false,     -- the site is linked as a source
  cited_urls       text[] not null default '{}',
  brands           jsonb not null default '[]',        -- [{ name, position }]
  sources          jsonb not null default '[]',        -- [{ domain, url, title }]
  organic_position integer,                            -- Google AI Overview campaigns: regular Google rank
  answer           text,
  error            text,
  checked_at       timestamptz not null default now(),
  unique (run_id, prompt_id, engine)
);

create index if not exists pt_prompts_campaign_idx on pt_prompts (campaign_id);
create index if not exists pt_runs_campaign_idx on pt_runs (campaign_id, created_at desc);
create index if not exists pt_checks_run_idx on pt_checks (run_id);
create index if not exists pt_checks_campaign_idx on pt_checks (campaign_id, checked_at desc);

alter table pt_campaigns enable row level security;
alter table pt_prompts enable row level security;
alter table pt_runs enable row level security;
alter table pt_checks enable row level security;
