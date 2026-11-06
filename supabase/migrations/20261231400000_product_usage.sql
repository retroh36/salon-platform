-- What each product used in services and sold over a period of local dates
-- at a location, summed (the usage report, lib/usage-report.ts): a year of
-- movements is more rows than one read returns. Security invoker, so stock
-- history's RLS decides who sees it (the front of house).

create function public.product_usage(p_location_id uuid, p_from date, p_to date)
returns table (product_id uuid, reason public.stock_reason, change numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.product_id, m.reason, sum(m.change)
  from public.stock_movements m
  join public.locations l on l.id = m.location_id
  where m.location_id = p_location_id
    and m.reason in ('service_use', 'sale')
    and m.created_at >= (p_from::timestamp at time zone l.timezone)
    and m.created_at < ((p_to + 1)::timestamp at time zone l.timezone)
  group by m.product_id, m.reason
$$;

revoke all on function public.product_usage(uuid, date, date) from public, anon;
grant execute on function public.product_usage(uuid, date, date) to authenticated;
