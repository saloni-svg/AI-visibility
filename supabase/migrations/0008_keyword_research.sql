-- Keyword research (Keyword Overview): one saved result per keyword, country and device (reused for 7 days).
create table if not exists keyword_research (
  id          uuid primary key default gen_random_uuid(),
  keyword     text not null,
  country     text not null,
  device      text not null default 'desktop',
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  unique (keyword, country, device)
);
alter table keyword_research enable row level security;
