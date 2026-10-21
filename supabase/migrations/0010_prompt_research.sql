-- Prompt research: one saved result per topic, country and AI platform (reused for 7 days).
create table if not exists prompt_research (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null,
  country     text not null,
  platform    text not null default 'all',
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  unique (topic, country, platform)
);
alter table prompt_research enable row level security;
