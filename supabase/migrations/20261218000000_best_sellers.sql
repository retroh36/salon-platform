-- Best sellers for the checkout's quick-add tiles. The front desk only
-- reads today's sales (private.sees_sale), so working them out from the
-- sales it can read left the tiles to today alone, and empty on a quiet
-- day. This gives the front of house what sold at the location in the
-- period, by product and the stylist credited, and nothing else: no
-- prices, clients or sales.

create function public.best_sellers(p_location_id uuid, p_since timestamptz)
returns table (product_id uuid, staff_id uuid, quantity numeric)
language sql
stable
security definer
set search_path to ''
as $$
  select i.product_id, i.staff_id, sum(i.quantity)
  from public.sale_items i
  join public.sales s on s.id = i.sale_id
  join public.locations l on l.id = s.location_id
  where s.location_id = p_location_id
    and private.front_of_house(l.business_id)
    and i.kind = 'product'
    and i.product_id is not null
    and s.status <> 'voided'
    and s.created_at >= p_since
  group by i.product_id, i.staff_id;
$$;

revoke all on function public.best_sellers(uuid, timestamptz) from public, anon;
grant execute on function public.best_sellers(uuid, timestamptz) to authenticated;
