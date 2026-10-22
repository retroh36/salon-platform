-- Stocktakes: counting what's on the shelves and putting stock right.
--
-- A stocktake is started, then products are counted shelf by shelf. Each
-- count records what was expected at that moment (on hand when it was
-- counted), so anything sold or used after a shelf is counted doesn't
-- count against it. Finishing applies the differences as 'count' stock
-- movements; products not counted are left as they are. One stocktake at a
-- time per location. Owners and managers run stocktakes.

create type public.stocktake_status as enum ('in_progress', 'completed', 'canceled');

create table public.stocktakes (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  location_id   uuid not null,
  status        public.stocktake_status not null default 'in_progress',
  started_by    uuid,
  started_at    timestamptz not null default now(),
  finished_by   uuid,
  finished_at   timestamptz,
  unique (id, business_id),
  check ((status = 'in_progress') = (finished_at is null)),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (started_by, business_id) references public.staff (id, business_id) on delete set null (started_by),
  foreign key (finished_by, business_id) references public.staff (id, business_id) on delete set null (finished_by)
);

create unique index stocktakes_one_open_per_location on public.stocktakes (location_id) where status = 'in_progress';
create index stocktakes_location_started_idx on public.stocktakes (location_id, started_at desc);
create index stocktakes_business_id_idx on public.stocktakes (business_id);

create table public.stocktake_counts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  stocktake_id  uuid not null,
  product_id    uuid not null,
  -- In the product's unit, partly used tubes included.
  counted       numeric(12, 2) not null check (counted >= 0),
  -- On hand when it was counted.
  expected      numeric(12, 2) not null,
  counted_by    uuid,
  counted_at    timestamptz not null default now(),
  unique (stocktake_id, product_id),
  foreign key (stocktake_id, business_id) references public.stocktakes (id, business_id) on delete cascade,
  foreign key (product_id, business_id) references public.products (id, business_id) on delete cascade,
  foreign key (counted_by, business_id) references public.staff (id, business_id) on delete set null (counted_by)
);

create index stocktake_counts_product_id_idx on public.stocktake_counts (product_id);
create index stocktake_counts_business_id_idx on public.stocktake_counts (business_id);

alter table public.stock_movements add column stocktake_id uuid references public.stocktakes (id) on delete set null;
create index stock_movements_stocktake_idx on public.stock_movements (stocktake_id) where stocktake_id is not null;

alter table public.stocktakes enable row level security;
alter table public.stocktake_counts enable row level security;

create policy "Owners and managers can view stocktakes"
  on public.stocktakes for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));
create policy "Owners and managers can view counts"
  on public.stocktake_counts for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

-- The open stocktake (locked), checked against the caller.
create function private.open_stocktake(p_stocktake_id uuid)
returns public.stocktakes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stocktake public.stocktakes;
begin
  select * into v_stocktake from public.stocktakes where id = p_stocktake_id for update;
  perform private.require_inventory_manager(v_stocktake.business_id);
  if v_stocktake.status <> 'in_progress' then
    raise exception 'This stocktake is finished' using errcode = '55000';
  end if;
  return v_stocktake;
end;
$$;

-- Starts a stocktake at the location, or returns the one under way.
create function public.start_stocktake(p_location_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_id uuid;
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  perform private.require_inventory_manager(v_business_id);
  select id into v_id from public.stocktakes where location_id = p_location_id and status = 'in_progress';
  if v_id is null then
    insert into public.stocktakes (business_id, location_id, started_by)
    values (v_business_id, p_location_id, private.current_staff_id(v_business_id))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Records (or corrects) a product's count; returns what was expected.
create function public.record_count(p_stocktake_id uuid, p_product_id uuid, p_counted numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stocktake public.stocktakes;
  v_expected numeric;
begin
  v_stocktake := private.open_stocktake(p_stocktake_id);
  if p_counted is null or p_counted < 0 or p_counted > 1000000 then
    raise exception 'Enter what''s on the shelf' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and business_id = v_stocktake.business_id) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  select coalesce((select on_hand from public.stock_levels where location_id = v_stocktake.location_id and product_id = p_product_id), 0)
  into v_expected;

  insert into public.stocktake_counts (business_id, stocktake_id, product_id, counted, expected, counted_by)
  values (v_stocktake.business_id, p_stocktake_id, p_product_id, p_counted, v_expected, private.current_staff_id(v_stocktake.business_id))
  on conflict (stocktake_id, product_id) do update
  set counted = excluded.counted, expected = excluded.expected, counted_by = excluded.counted_by, counted_at = now();
  return v_expected;
end;
$$;

create function public.clear_count(p_stocktake_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.open_stocktake(p_stocktake_id);
  delete from public.stocktake_counts where stocktake_id = p_stocktake_id and product_id = p_product_id;
end;
$$;

-- Applies the differences and closes the stocktake.
create function public.finish_stocktake(p_stocktake_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stocktake public.stocktakes;
  v_count record;
  v_movement uuid;
  v_changed integer := 0;
begin
  v_stocktake := private.open_stocktake(p_stocktake_id);
  for v_count in select * from public.stocktake_counts where stocktake_id = p_stocktake_id loop
    continue when v_count.counted = v_count.expected;
    v_movement := private.move_stock(v_stocktake.location_id, v_count.product_id, v_count.counted - v_count.expected, 'count', 'Stocktake');
    update public.stock_movements set stocktake_id = p_stocktake_id where id = v_movement;
    v_changed := v_changed + 1;
  end loop;
  update public.stocktakes set status = 'completed', finished_at = now(), finished_by = private.current_staff_id(business_id)
  where id = p_stocktake_id;
  return v_changed;
end;
$$;

create function public.cancel_stocktake(p_stocktake_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.open_stocktake(p_stocktake_id);
  update public.stocktakes set status = 'canceled', finished_at = now(), finished_by = private.current_staff_id(business_id)
  where id = p_stocktake_id;
end;
$$;

revoke all on function private.open_stocktake(uuid) from public;
revoke all on function public.start_stocktake(uuid) from public, anon;
revoke all on function public.record_count(uuid, uuid, numeric) from public, anon;
revoke all on function public.clear_count(uuid, uuid) from public, anon;
revoke all on function public.finish_stocktake(uuid) from public, anon;
revoke all on function public.cancel_stocktake(uuid) from public, anon;
grant execute on function public.start_stocktake(uuid) to authenticated;
grant execute on function public.record_count(uuid, uuid, numeric) to authenticated;
grant execute on function public.clear_count(uuid, uuid) to authenticated;
grant execute on function public.finish_stocktake(uuid) to authenticated;
grant execute on function public.cancel_stocktake(uuid) to authenticated;
