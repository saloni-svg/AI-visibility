-- Content agent: one row per agent run, and the content drafts it writes.

create table if not exists agent_runs (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  status       text not null default 'running' check (status in ('running', 'completed', 'failed')),
  focus        text,                       -- optional instruction from the user
  messages     jsonb not null default '[]', -- the agent's conversation (model + tool results)
  log          jsonb not null default '[]', -- human-readable steps shown in the app
  steps        integer not null default 0,
  summary      text,                       -- the agent's final report
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table if not exists content_drafts (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references brands(id) on delete cascade,
  agent_run_id      uuid references agent_runs(id) on delete set null,
  kind              text not null,         -- new_page, page_update, faq, schema, ai_access, listing_pitch
  title             text not null,
  target_url        text,                  -- page to change, or null for a new page
  target_questions  text[] not null default '{}',
  reason            text,
  content           text not null,         -- Markdown (or code for schema / robots.txt / llms.txt)
  status            text not null default 'draft' check (status in ('draft', 'done', 'dismissed')),
  created_at        timestamptz not null default now()
);

create index if not exists content_drafts_brand_idx on content_drafts (brand_id, created_at desc);
create index if not exists agent_runs_brand_idx on agent_runs (brand_id, created_at desc);

alter table agent_runs enable row level security;
alter table content_drafts enable row level security;
