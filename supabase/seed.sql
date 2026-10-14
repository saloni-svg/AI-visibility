-- Example data. Replace the names and prompts with your own, then run this in
-- the Supabase SQL editor after the migration.

with b as (
  insert into brands (name, domain, aliases)
  values ('Notion', 'notion.so', '{"Notion.so","Notion AI"}')
  returning id
),
c as (
  insert into competitors (brand_id, name, domain, aliases)
  select b.id, x.name, x.domain, x.aliases
  from b, (values
    ('Confluence', 'atlassian.com', '{"Atlassian Confluence"}'::text[]),
    ('Coda',       'coda.io',       '{}'::text[]),
    ('Obsidian',   'obsidian.md',   '{}'::text[])
  ) as x(name, domain, aliases)
)
insert into prompts (brand_id, text, type)
select b.id, x.text, x.type
from b, (values
  ('What is the best tool for a team wiki?',                 'unbranded'),
  ('Which note-taking apps do startups use most?',           'unbranded'),
  ('Is Notion a good choice for project management?',        'branded'),
  ('Notion vs Confluence: which should a 20-person team use?', 'branded')
) as x(text, type);
