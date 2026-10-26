-- The public demo (DEMO_MODE=true): testers' notes from the Feedback button,
-- with the page, role and salon they sent it from. Not salon data, so no
-- business_id and no links to salon tables: the demo's nightly reset empties
-- every other table and keeps this one. Only the service role reads or
-- writes it (the app's server, and the Supabase dashboard's table editor).
create table public.demo_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  note text not null check (char_length(note) between 1 and 2000),
  name text check (char_length(name) <= 80),
  page text not null check (char_length(page) <= 300),
  role text not null check (char_length(role) <= 40),
  salon text check (char_length(salon) <= 120)
);

alter table public.demo_feedback enable row level security;
revoke all on public.demo_feedback from anon, authenticated;

-- Tables in public without Row Level Security (there should be none), for
-- the tests and the demo's safety check. Names only.
create function public.tables_without_rls()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  order by 1
$$;

revoke all on function public.tables_without_rls() from public, anon, authenticated;
grant execute on function public.tables_without_rls() to service_role;
