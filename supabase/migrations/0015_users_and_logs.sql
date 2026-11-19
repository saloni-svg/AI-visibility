-- Users and roles, plus activity and query logs.
-- Roles: owner (manages users and roles, sees everyone's logs), admin (can edit their own
-- details), user (view only). Email can't be changed from the app.
-- The owner is set from the OWNER_EMAIL setting (default salonidigitalryze@gmail.com) the first
-- time they open the app. Read and written only with the service role key (RLS on, no policies).

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  phone       text,
  company     text,
  job_title   text,
  role        text not null default 'user' check (role in ('owner', 'admin', 'user')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_seen_at timestamptz
);
create unique index if not exists profiles_email_idx on profiles (lower(email));
alter table profiles enable row level security;

-- One row per thing a user did. kind = 'activity' (sign-ins, changes) or 'query' (searches,
-- analyses, agent runs: what they asked the app for, and whether it worked).
create table if not exists activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  email       text,                -- kept even if the user is removed later
  kind        text not null check (kind in ('activity', 'query')),
  action      text not null,       -- e.g. researchKeyword, signIn
  label       text not null,       -- e.g. "Keyword research"
  detail      jsonb,               -- the inputs (keyword, domain, country …)
  summary     text,                -- the inputs as one readable, searchable line
  status      text not null default 'ok' check (status in ('ok', 'error')),
  error       text,
  duration_ms integer,
  created_at  timestamptz not null default now()
);
create index if not exists activity_logs_user_idx on activity_logs (user_id, created_at desc);
create index if not exists activity_logs_kind_idx on activity_logs (kind, created_at desc);
alter table activity_logs enable row level security;
