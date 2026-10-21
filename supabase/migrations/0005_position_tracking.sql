-- Position tracking: Google rank + AI Overview citation for chosen keywords, over time.

create table if not exists tracked_keywords (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id) on delete cascade,
  keyword        text not null,
  country        text not null,
  search_volume  integer,                 -- monthly Google searches (DataForSEO)
  volume_at      timestamptz,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (brand_id, keyword, country)
);

-- One "Check positions" click = one run (per country).
create table if not exists position_runs (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  country      text not null,
  status       text not null default 'running' check (status in ('running', 'completed', 'failed')),
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table if not exists keyword_checks (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references position_runs(id) on delete cascade,
  keyword_id            uuid not null references tracked_keywords(id) on delete cascade,
  brand_id              uuid not null references brands(id) on delete cascade,
  position              integer,           -- Google organic position, null = not in top 100
  url                   text,              -- the page of yours that ranks
  serp_features         text[] not null default '{}',
  ai_overview_present   boolean not null default false,
  ai_overview_cited     boolean not null default false,
  competitor_positions  jsonb not null default '{}', -- { "competitor.com": 4 }
  top_results           jsonb not null default '[]', -- top 10: position, domain, url, title
  suggested_url         text,              -- best page of yours for the keyword (site search)
  suggested_similarity  real,
  error                 text,
  checked_at            timestamptz not null default now(),
  unique (run_id, keyword_id)
);
create index if not exists keyword_checks_keyword_idx on keyword_checks (keyword_id, checked_at desc);
create index if not exists position_runs_brand_idx on position_runs (brand_id, country, created_at desc);

alter table tracked_keywords enable row level security;
alter table position_runs enable row level security;
alter table keyword_checks enable row level security;

-- Rank per platform: Google Maps, AI Overview source position, and AI assistants.
alter table keyword_checks add column if not exists maps_position integer;
alter table keyword_checks add column if not exists maps_title text;
alter table keyword_checks add column if not exists aio_position integer;
alter table keyword_checks add column if not exists platforms jsonb not null default '{}'; -- { "openai": { position, cited, top } }
alter table position_runs add column if not exists options jsonb not null default '{}';  -- { maps, ai }

-- City (or region) to track from, per country: { "GB": { "code": 1006886, "name": "Swansea,Wales,United Kingdom" } }
alter table brands add column if not exists tracking_locations jsonb not null default '{}';

-- Keyword metrics (DataForSEO): cost per click, keyword difficulty, search intent.
alter table tracked_keywords add column if not exists cpc numeric;
alter table tracked_keywords add column if not exists keyword_difficulty integer;
alter table tracked_keywords add column if not exists intent text;
alter table tracked_keywords add column if not exists intent_secondary text[] not null default '{}';
alter table tracked_keywords add column if not exists metrics_at timestamptz;

-- Where the brand appears anywhere on the results page (video, featured snippet, local pack…), not just regular results.
alter table keyword_checks add column if not exists any_position integer;
alter table keyword_checks add column if not exists any_type text;
