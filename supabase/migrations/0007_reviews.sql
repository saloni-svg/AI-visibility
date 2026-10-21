-- Review management: the business's Google listing, and its reviews.

create table if not exists review_sources (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  platform        text not null default 'google',
  place_id        text,
  cid             text,                 -- Google's business id
  title           text not null,
  address         text,
  rating          real,
  reviews_count   integer,
  url             text,                 -- the listing on Google Maps
  location_code   integer,
  task_id         text,                 -- DataForSEO reviews task being fetched
  status          text not null default 'idle' check (status in ('idle', 'fetching', 'ready', 'failed')),
  error           text,
  fetched_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (brand_id, platform)
);

create table if not exists reviews (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null references review_sources(id) on delete cascade,
  brand_id        uuid not null references brands(id) on delete cascade,
  review_id       text not null,
  author          text,
  author_url      text,
  author_image    text,
  local_guide     boolean not null default false,
  rating          integer,
  text            text,
  published_at    timestamptz,
  time_ago        text,
  owner_reply     text,
  owner_reply_at  timestamptz,
  review_url      text,
  photos          integer,
  ai_reply        text,                 -- reply drafted by AI, to copy to Google
  created_at      timestamptz not null default now(),
  unique (source_id, review_id)
);
create index if not exists reviews_brand_idx on reviews (brand_id, published_at desc);

alter table review_sources enable row level security;
alter table reviews enable row level security;
