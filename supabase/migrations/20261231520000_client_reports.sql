-- Client reports (lib/client-reports.ts): a list of clients picked by fixed
-- filters, the same columns every time, built by Denise from a question or
-- by hand, and saved to run again.
--
-- client_report runs as the person asking (security invoker), through
-- client_overview, so RLS decides what they see: a stylist or assistant
-- gets the clients and visits of their own book and no spend. Dates come
-- already worked out by our code, as the start of the salon's local days.

create function public.client_report(
  p_business_id uuid,
  p_categories text[],
  p_service_ids uuid[],
  p_staff_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_min integer,
  p_max integer,
  p_no_visit_since timestamptz,
  p_visited_since timestamptz,
  p_next text,
  p_min_spend bigint,
  p_sort text,
  p_limit integer
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  phone text,
  visits integer,
  last_visit_at timestamptz,
  next_visit_at timestamptz,
  usual_staff_name text,
  spend_cents bigint,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with counted as (
    select a.client_id, count(distinct a.id)::integer as n
    from public.appointments a
    join public.appointment_items i on i.appointment_id = a.id
    join public.services s on s.id = i.service_id
    where a.business_id = p_business_id
      and a.status = 'completed'
      and a.client_id is not null
      and (p_from is null or a.starts_at >= p_from)
      and (p_to is null or a.starts_at < p_to)
      and (
        (coalesce(cardinality(p_categories), 0) = 0 and coalesce(cardinality(p_service_ids), 0) = 0)
        or i.service_id = any (coalesce(p_service_ids, '{}'))
        or lower(s.category) = any (select lower(c) from unnest(coalesce(p_categories, '{}')) c)
      )
      and (coalesce(cardinality(p_staff_ids), 0) = 0 or i.staff_id = any (p_staff_ids))
    group by a.client_id
  ),
  picked as (
    select o.id, o.first_name, o.last_name, o.phone, coalesce(c.n, 0) as visits, o.last_visit_at, o.next_visit_at, o.usual_staff_name, o.spend_cents
    from public.client_overview() o
    left join counted c on c.client_id = o.id
    where o.business_id = p_business_id
      and coalesce(c.n, 0) >= coalesce(p_min, 0)
      and (p_max is null or coalesce(c.n, 0) <= p_max)
      and (p_no_visit_since is null or o.last_visit_at is null or o.last_visit_at < p_no_visit_since)
      and (p_visited_since is null or o.last_visit_at >= p_visited_since)
      and (p_next is null or (p_next = 'booked') = (o.next_visit_at is not null))
      and (p_min_spend is null or o.spend_cents >= p_min_spend)
  )
  select p.*, count(*) over () as total
  from picked p
  order by
    case when p_sort = 'name' then lower(p.first_name || ' ' || p.last_name) end,
    case when p_sort = 'visits' then p.visits end desc,
    case when p_sort = 'next_visit' then p.next_visit_at end asc nulls last,
    case when p_sort = 'spend' then p.spend_cents end desc nulls last,
    p.last_visit_at desc nulls last,
    lower(p.first_name || ' ' || p.last_name)
  limit least(greatest(coalesce(p_limit, 2000), 1), 5000)
$$;

revoke execute on function public.client_report(uuid, text[], uuid[], uuid[], timestamptz, timestamptz, integer, integer, timestamptz, timestamptz, text, bigint, text, integer) from public, anon;
grant execute on function public.client_report(uuid, text[], uuid[], uuid[], timestamptz, timestamptz, integer, integer, timestamptz, timestamptz, text, bigint, text, integer) to authenticated;

-- Saved reports: a name and the definition (dates kept as words, so "since
-- the start of this year" stays this year's). Each person's own; shared
-- with the salon by those with reports, and run by each person under
-- their own access.
create table public.saved_reports (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  staff_id    uuid not null references public.staff (id) on delete cascade,
  kind        text not null default 'clients' check (kind in ('clients')),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  definition  jsonb not null check (jsonb_typeof(definition) = 'object' and pg_column_size(definition) < 8000),
  shared      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, staff_id, name)
);

create index saved_reports_business_idx on public.saved_reports (business_id, name);

alter table public.saved_reports enable row level security;

create policy "Staff see their own reports and the salon's shared ones"
  on public.saved_reports for select to authenticated
  using (
    staff_id = (select private.current_staff_id(business_id))
    or (shared and business_id in (select private.member_businesses()))
  );

create policy "Staff save their own reports"
  on public.saved_reports for insert to authenticated
  with check (
    staff_id = (select private.current_staff_id(business_id))
    and (not shared or (select private.can(business_id, 'reports')))
  );

create policy "Staff change their own reports"
  on public.saved_reports for update to authenticated
  using (staff_id = (select private.current_staff_id(business_id)))
  with check (
    staff_id = (select private.current_staff_id(business_id))
    and (not shared or (select private.can(business_id, 'reports')))
  );

create policy "Staff remove their own reports, and those with reports shared ones"
  on public.saved_reports for delete to authenticated
  using (
    staff_id = (select private.current_staff_id(business_id))
    or (shared and (select private.can(business_id, 'reports')))
  );

create trigger saved_reports_touch before update on public.saved_reports
  for each row execute function public.set_updated_at();
