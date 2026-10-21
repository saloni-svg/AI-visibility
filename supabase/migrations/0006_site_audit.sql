-- Position tracking fixes: local pack detection and result counts.
alter table keyword_checks add column if not exists in_local_pack boolean not null default false;
alter table keyword_checks add column if not exists results_count integer;

-- Site audit: one run per audit; one row per crawled page.
create table if not exists audit_runs (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id) on delete cascade,
  status         text not null default 'running' check (status in ('running', 'completed', 'failed')),
  page_limit     integer not null default 100,
  pages_crawled  integer not null default 0,
  site_checks    jsonb not null default '{}',   -- robots.txt, sitemap, https redirect, AI crawlers, llms.txt
  scores         jsonb,                         -- site health, AI search health and category scores
  counts         jsonb,                         -- errors, warnings, notices
  error          text,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists audit_runs_brand_idx on audit_runs (brand_id, created_at desc);

create table if not exists audit_pages (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references audit_runs(id) on delete cascade,
  url               text not null,
  depth             integer not null default 0,   -- clicks from the homepage (99 = only in sitemap)
  in_sitemap        boolean not null default false,
  state             text not null default 'queued' check (state in ('queued', 'done')),
  status_code       integer,
  redirect_to       text,
  response_ms       integer,
  size_bytes        integer,
  title             text,
  meta_description  text,
  h1_count          integer,
  word_count        integer,
  canonical         text,
  noindex           boolean,
  hreflang_count    integer,
  hreflang_valid    boolean,
  schema_types      text[] not null default '{}',
  schema_errors     integer not null default 0,
  images_total      integer,
  images_no_alt     integer,
  internal_links    text[] not null default '{}',
  mixed_content     integer,
  has_viewport      boolean,
  issues            text[] not null default '{}',
  cwv               jsonb,
  error             text,
  unique (run_id, url)
);
create index if not exists audit_pages_run_idx on audit_pages (run_id, state, depth);

alter table audit_runs enable row level security;
alter table audit_pages enable row level security;

-- v2: more page facts and per-issue counts per run (for trends and "new issues").
alter table audit_pages add column if not exists h1 text;
alter table audit_pages add column if not exists text_ratio real;
alter table audit_pages add column if not exists empty_anchor_links integer;
alter table audit_runs add column if not exists issue_counts jsonb;

-- v3: simple yes/no findings detected while crawling a page (doctype, charset, meta refresh, ...).
alter table audit_pages add column if not exists flags text[] not null default '{}';
