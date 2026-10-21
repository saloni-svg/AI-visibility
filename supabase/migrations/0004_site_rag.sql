-- Real RAG over the brand's website: pages split into sections, each with an
-- embedding, searched by meaning; and the exact page fixes written from them.
create extension if not exists vector;

create table if not exists site_pages (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  url           text not null,
  title         text,
  content_hash  text,                 -- skip re-embedding pages that didn't change
  word_count    integer,
  needs_index   boolean not null default true,
  error         text,
  indexed_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (brand_id, url)
);

create table if not exists page_chunks (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  page_id      uuid not null references site_pages(id) on delete cascade,
  url          text not null,
  heading      text,                  -- the section heading the text sits under
  chunk_index  integer not null,
  content      text not null,
  embedding    vector(1536) not null, -- OpenAI text-embedding-3-small
  created_at   timestamptz not null default now()
);
create index if not exists page_chunks_brand_idx on page_chunks (brand_id);
create index if not exists page_chunks_embedding_idx on page_chunks using hnsw (embedding vector_cosine_ops);

create table if not exists page_fixes (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  chunk_id        uuid references page_chunks(id) on delete set null,
  url             text not null,
  heading         text,
  question        text not null,      -- the AI question this fix helps win
  kind            text not null check (kind in ('rewrite', 'add_after')),
  current_text    text not null,      -- exact text on the page today
  suggested_text  text not null,
  reason          text,
  similarity      real,
  status          text not null default 'todo' check (status in ('todo', 'done', 'dismissed')),
  created_at      timestamptz not null default now()
);
create index if not exists page_fixes_brand_idx on page_fixes (brand_id, created_at desc);

-- Closest sections of one brand's site to a query embedding (cosine similarity).
create or replace function match_page_chunks(p_brand_id uuid, p_embedding vector(1536), p_count int default 5)
returns table (id uuid, url text, heading text, content text, similarity float)
language sql stable
set search_path = public
as $$
  select c.id, c.url, c.heading, c.content, 1 - (c.embedding <=> p_embedding) as similarity
  from page_chunks c
  where c.brand_id = p_brand_id
  order by c.embedding <=> p_embedding
  limit p_count;
$$;

alter table site_pages enable row level security;
alter table page_chunks enable row level security;
alter table page_fixes enable row level security;

-- One fix can answer several questions that point to the same section.
alter table page_fixes add column if not exists questions text[] not null default '{}';
