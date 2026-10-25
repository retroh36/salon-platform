-- Stylists and assistants see no salon money (CLAUDE.md, Roles), but a few
-- columns let them read it straight from the API:
--   * products.cost_cents and stock_movements.unit_cost_cents: what the
--     salon pays for stock;
--   * an event's money (totals, fees, deposit, the main client's part and
--     the card on file) and each party member's price, on events they're
--     on, though event money is the front of house's;
--   * every client's package history and package uses, not just clients
--     in their own book.
--
-- Row security can't hide a column from some staff and not others, so
-- those columns are no longer readable by signed-in staff at all, and the
-- front of house reads them through functions that check who's asking
-- (product_costs, event_money, event_member_prices). Stock history is the
-- front of house's (stylists still see what's on hand), and package
-- history and uses follow the client's (private.sees_client).
--
-- Columns added to these tables later need a grant of their own:
--   grant select (<column>) on public.<table> to authenticated;
-- and an embedded count (products(count)) needs the whole table, so count
-- ids instead.

revoke select on public.products from anon, authenticated;
grant select (id, business_id, supplier_id, brand, line, name, sku, barcode, type, unit, size, price_cents, shelf, is_active, created_at, updated_at)
  on public.products to authenticated;

revoke select on public.events from anon, authenticated;
grant select (id, business_id, location_id, client_id, title, status, lost_reason, event_date, ready_by, venue_name, venue_address, on_location,
  travel_miles, travel_minutes, notes, source, billing, inquiry_party_size, inquiry_services, created_by, created_at, updated_at,
  status_changed_at, booked_at, look_notes, sale_id)
  on public.events to authenticated;

revoke select on public.event_members from anon, authenticated;
grant select (id, business_id, event_id, position, name, party_role, package_id, package_name, hair_minutes, makeup_minutes, pays_own, email, phone, created_at)
  on public.event_members to authenticated;

-- What each product costs the salon, for the front of house.
create function public.product_costs()
returns table (product_id uuid, cost_cents integer)
language sql
stable
security definer
set search_path to ''
as $$
  select p.id, p.cost_cents from public.products p where private.front_of_house(p.business_id);
$$;

-- An event's money, for the front of house.
create function public.event_money(p_event_ids uuid[])
returns table (event_id uuid, subtotal_cents integer, travel_fee_cents integer, early_fee_cents integer, service_charge_cents integer,
  tax_cents integer, total_cents integer, main_cents integer, deposit_cents integer)
language sql
stable
security definer
set search_path to ''
as $$
  select e.id, e.subtotal_cents, e.travel_fee_cents, e.early_fee_cents, e.service_charge_cents, e.tax_cents, e.total_cents, e.main_cents, e.deposit_cents
  from public.events e
  where e.id = any (p_event_ids) and private.front_of_house(e.business_id);
$$;

-- Each party member's package price, for the front of house.
create function public.event_member_prices(p_event_ids uuid[])
returns table (member_id uuid, event_id uuid, price_cents integer)
language sql
stable
security definer
set search_path to ''
as $$
  select m.id, m.event_id, m.price_cents
  from public.event_members m
  where m.event_id = any (p_event_ids) and private.front_of_house(m.business_id);
$$;

revoke all on function public.product_costs() from public, anon;
revoke all on function public.event_money(uuid[]) from public, anon;
revoke all on function public.event_member_prices(uuid[]) from public, anon;
grant execute on function public.product_costs() to authenticated;
grant execute on function public.event_money(uuid[]) to authenticated;
grant execute on function public.event_member_prices(uuid[]) to authenticated;

-- Stock history: the front of house.
drop policy "Members can view stock movements" on public.stock_movements;
create policy "Front of house can view stock movements" on public.stock_movements for select to authenticated
  using ((select private.front_of_house(business_id)));

-- Package history and uses: the clients they see.
drop policy "Members can view package history" on public.package_events;
create policy "Members can view package history for clients they see" on public.package_events for select to authenticated
  using (exists (select 1 from public.client_packages cp where cp.id = package_events.client_package_id and private.sees_client(cp.business_id, cp.client_id)));
drop policy "Members can view client package uses" on public.client_package_items;
create policy "Members can view package uses for clients they see" on public.client_package_items for select to authenticated
  using (exists (select 1 from public.client_packages cp where cp.id = client_package_items.client_package_id and private.sees_client(cp.business_id, cp.client_id)));
