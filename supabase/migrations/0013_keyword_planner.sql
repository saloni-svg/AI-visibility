-- Google Keyword Planner (Google Ads API) for search volume and CPC.
-- One app-wide Google sign-in (a Google account with access to the Google Ads account set in
-- GOOGLE_ADS_CUSTOMER_ID). Readable only with the service role key (row-level security, no policies).

create table if not exists google_ads_auth (
  id             integer primary key default 1 check (id = 1),   -- a single row
  google_email   text,
  refresh_token  text not null,
  created_at     timestamptz not null default now()
);
alter table google_ads_auth enable row level security;

-- Where a tracked keyword's search volume and CPC came from ('keyword_planner' or 'dataforseo'),
-- so DataForSEO figures are replaced as soon as Keyword Planner is connected.
alter table tracked_keywords add column if not exists volume_source text;
