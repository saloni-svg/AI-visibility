-- SEO agent: one row per run. It gathers Search Console and GA4 data (through Windsor.ai), the
-- app's own rankings, site audit and AI visibility, finds opportunities, and writes a 30/60/90-day
-- SEO plan. The browser advances it one stage at a time (stage 0..4).

create table if not exists seo_plans (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  status       text not null default 'running' check (status in ('running', 'completed', 'failed')),
  stage        integer not null default 0,
  focus        text,                         -- optional instruction from the user
  sources      jsonb,                        -- Windsor.ai accounts used: {gsc, ga4}
  data         jsonb not null default '{}',  -- gathered data and the opportunities found
  plan         jsonb,                        -- the written plan (summary, actions with status)
  log          jsonb not null default '[]',  -- steps shown in the app
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists seo_plans_brand_idx on seo_plans (brand_id, created_at desc);
alter table seo_plans enable row level security;

-- The Windsor.ai accounts chosen for each brand (matched automatically on the first run).
alter table brands add column if not exists seo_sources jsonb;
