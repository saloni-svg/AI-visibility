-- AI Visibility Tracker: initial schema
--
-- How the tables fit together:
--   brands       the company you are tracking
--   competitors  rival companies, linked to a brand
--   prompts      questions you ask the AI tools (branded or unbranded)
--   runs         one execution of the tracking script
--   answers      one raw reply from one AI provider to one prompt
--   mentions     brands found inside an answer, with their position
--   sources      URLs cited inside an answer

create extension if not exists pgcrypto;

create table brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  domain      text,                              -- e.g. acme.com
  aliases     text[] not null default '{}',      -- other spellings, e.g. {'Acme Inc','ACME'}
  created_at  timestamptz not null default now()
);

create table competitors (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  name        text not null,
  domain      text,
  aliases     text[] not null default '{}',
  created_at  timestamptz not null default now(),
  unique (brand_id, name)
);

create table prompts (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  text        text not null,
  -- branded:   mentions your brand ("Is Acme good for invoicing?")
  -- unbranded: does not ("What is the best invoicing tool?")
  type        text not null check (type in ('branded', 'unbranded')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (brand_id, text)
);

create table runs (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'running'
               check (status in ('running', 'completed', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  notes        text
);

create table answers (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references runs(id) on delete cascade,
  prompt_id     uuid not null references prompts(id) on delete cascade,
  provider      text not null check (provider in ('openai', 'gemini', 'perplexity')),
  model         text not null,
  attempt       smallint not null check (attempt >= 1),
  answer_text   text,                 -- null if the call failed
  raw_response  jsonb,                -- full API response, kept for re-parsing later
  error         text,
  latency_ms    integer,
  parsed_at     timestamptz,          -- set once mentions/sources are extracted
  created_at    timestamptz not null default now(),
  unique (run_id, prompt_id, provider, attempt)
);

create table mentions (
  id             uuid primary key default gen_random_uuid(),
  answer_id      uuid not null references answers(id) on delete cascade,
  name           text not null,       -- brand name exactly as the parser found it
  position       smallint not null,   -- 1 = first brand mentioned in the answer
  brand_id       uuid references brands(id) on delete set null,       -- set if it is your brand
  competitor_id  uuid references competitors(id) on delete set null,  -- set if it is a known competitor
  created_at     timestamptz not null default now()
);

create table sources (
  id          uuid primary key default gen_random_uuid(),
  answer_id   uuid not null references answers(id) on delete cascade,
  url         text not null,
  domain      text,
  title       text,
  position    smallint,               -- order the source appeared in
  origin      text not null check (origin in ('api', 'text')),  -- api = provider citation list, text = found in answer text
  created_at  timestamptz not null default now(),
  unique (answer_id, url)
);

create index on competitors (brand_id);
create index on prompts (brand_id);
create index on answers (run_id);
create index on answers (prompt_id);
create index on answers (parsed_at) where parsed_at is null;
create index on mentions (answer_id);
create index on mentions (brand_id);
create index on mentions (competitor_id);
create index on sources (answer_id);
create index on sources (domain);

-- Lock every table down. The scripts use the service role key, which bypasses
-- RLS. When the dashboard is built we will add read policies for it.
alter table brands      enable row level security;
alter table competitors enable row level security;
alter table prompts     enable row level security;
alter table runs        enable row level security;
alter table answers     enable row level security;
alter table mentions    enable row level security;
alter table sources     enable row level security;
