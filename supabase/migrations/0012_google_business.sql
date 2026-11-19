-- Google Business Profile connection: lets the app post review replies to Google.
-- One connection per brand (the Google account that owns or manages the listing, and the
-- Business Profile location chosen for this brand). Tokens are only readable with the
-- service role key (row-level security on, no policies).

create table if not exists google_business_connections (
  brand_id         uuid primary key references brands(id) on delete cascade,
  google_email     text,
  refresh_token    text not null,
  access_token     text,
  expires_at       timestamptz,
  account          text,               -- accounts/123
  location         text,               -- locations/456
  location_title   text,
  location_address text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table google_business_connections enable row level security;

-- The review's id in the Business Profile API (accounts/…/locations/…/reviews/…), found the
-- first time a reply is posted, and when the reply was posted from the app.
alter table reviews add column if not exists gbp_review_name text;
alter table reviews add column if not exists reply_posted_at timestamptz;
