-- Visibility change explainer: page snapshots over time, and saved explanations per pair of checks.
create table if not exists page_snapshots (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  url           text not null,
  status_code   integer,
  title         text,
  word_count    integer,
  content_hash  text,                 -- hash of the page's main text
  text          text,                 -- main text (first 20,000 characters) to show what changed
  captured_at   timestamptz not null default now()
);
create index if not exists page_snapshots_brand_idx on page_snapshots (brand_id, url, captured_at desc);

create table if not exists visibility_explanations (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  run_id        uuid not null references runs(id) on delete cascade,
  prev_run_id   uuid not null references runs(id) on delete cascade,
  report        jsonb not null,
  created_at    timestamptz not null default now(),
  unique (run_id, prev_run_id)
);
alter table page_snapshots enable row level security;
alter table visibility_explanations enable row level security;
