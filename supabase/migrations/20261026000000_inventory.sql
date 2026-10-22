-- Inventory: suppliers, products, stock levels and stock movements.
--
-- Amounts are in the product's unit: grams or ml for things used by weight
-- or volume (color, developer, lightener, back-bar treatments), so partly
-- used tubes and bottles count exactly, or units for things sold or used
-- whole (retail). `size` is how much one container holds: a 60 g tube, a
-- 1000 ml bottle, 1 unit.
--
-- On hand is kept per location in stock_levels and only ever changes
-- through a stock movement, which records the change, why (service use,
-- sale, count, order received, adjustment) and the amount after it. Both
-- are written only through the functions below, so they can't drift apart.

create type public.product_type as enum ('retail', 'back_bar');
create type public.product_unit as enum ('g', 'ml', 'unit');
create type public.stock_reason as enum ('service_use', 'sale', 'count', 'order_received', 'adjustment');

create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  name            text not null check (length(trim(name)) > 0 and length(name) <= 200),
  email           text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone           text check (length(phone) <= 50),
  account_number  text check (length(account_number) <= 100),
  -- Days from ordering to delivery, for planning reorders.
  lead_time_days  smallint not null default 3 check (lead_time_days between 0 and 60),
  notes           text check (length(notes) <= 2000),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, business_id)
);

create unique index suppliers_business_name_key on public.suppliers (business_id, lower(trim(name)));

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  supplier_id  uuid,
  brand        text not null check (length(trim(brand)) > 0 and length(brand) <= 100),
  -- e.g. "Shades EQ", "Topchic"; null when the brand has no lines.
  line         text check (length(line) <= 100),
  -- The shade or product name: "7N", "20 Volume Developer", "All Soft Shampoo".
  name         text not null check (length(trim(name)) > 0 and length(name) <= 200),
  sku          text check (length(trim(sku)) > 0 and length(sku) <= 100),
  barcode      text check (barcode ~ '^[0-9]{6,14}$'),
  type         public.product_type not null,
  unit         public.product_unit not null,
  -- How much one container holds, in `unit` (1 for units).
  size         numeric(10, 2) not null check (size > 0),
  -- Per container.
  cost_cents   integer not null default 0 check (cost_cents >= 0),
  -- Retail price per container; only for retail products.
  price_cents  integer check (price_cents >= 0),
  -- Where it lives, for counting shelf by shelf.
  shelf        text check (length(shelf) <= 100),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, business_id),
  check (unit <> 'unit' or size = 1),
  check (type = 'retail' or price_cents is null),
  check (type = 'back_bar' or price_cents is not null),
  foreign key (supplier_id, business_id) references public.suppliers (id, business_id) on delete set null (supplier_id)
);

create unique index products_business_sku_key on public.products (business_id, lower(sku)) where sku is not null;
create unique index products_business_barcode_key on public.products (business_id, barcode) where barcode is not null;
create index products_business_brand_idx on public.products (business_id, brand, line, name);
create index products_supplier_id_idx on public.products (supplier_id) where supplier_id is not null;

create table public.stock_levels (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  location_id       uuid not null,
  product_id        uuid not null,
  -- In the product's unit. Can go below zero when more is used than was
  -- recorded; a count puts it right.
  on_hand           numeric(12, 2) not null default 0,
  -- Below this, it's low stock (in the product's unit).
  reorder_point     numeric(12, 2) not null default 0 check (reorder_point >= 0),
  -- How many containers to order at a time.
  reorder_quantity  integer not null default 1 check (reorder_quantity between 1 and 1000),
  updated_at        timestamptz not null default now(),
  unique (location_id, product_id),
  unique (id, business_id),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (product_id, business_id) references public.products (id, business_id) on delete cascade
);

create index stock_levels_business_id_idx on public.stock_levels (business_id);
create index stock_levels_product_id_idx on public.stock_levels (product_id);

create table public.stock_movements (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  location_id          uuid not null,
  product_id           uuid not null,
  -- In the product's unit: negative when stock goes out.
  change               numeric(12, 2) not null check (change <> 0),
  on_hand_after        numeric(12, 2) not null,
  reason               public.stock_reason not null,
  note                 text check (length(note) <= 500),
  -- What it was for, depending on the reason.
  appointment_id       uuid,
  appointment_item_id  uuid,
  -- Cost per container, for orders received.
  unit_cost_cents      integer check (unit_cost_cents >= 0),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (product_id, business_id) references public.products (id, business_id) on delete cascade,
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by),
  foreign key (appointment_id) references public.appointments (id) on delete set null,
  foreign key (appointment_item_id) references public.appointment_items (id) on delete set null
);

create index stock_movements_product_created_idx on public.stock_movements (product_id, location_id, created_at desc);
create index stock_movements_business_id_idx on public.stock_movements (business_id);
create index stock_movements_appointment_item_idx on public.stock_movements (appointment_item_id) where appointment_item_id is not null;
create index stock_movements_appointment_idx on public.stock_movements (appointment_id) where appointment_id is not null;

create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger stock_levels_set_updated_at before update on public.stock_levels
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Everyone at the salon sees products, suppliers and stock (stylists check
-- what's in). Owners and managers add and edit products and suppliers.
-- Stock levels and movements change only through the functions below.
-- ---------------------------------------------------------------------------

alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.stock_levels enable row level security;
alter table public.stock_movements enable row level security;

create policy "Members can view suppliers"
  on public.suppliers for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners and managers can add suppliers"
  on public.suppliers for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));
create policy "Owners and managers can change suppliers"
  on public.suppliers for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Members can view products"
  on public.products for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners and managers can add products"
  on public.products for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));
create policy "Owners and managers can change products"
  on public.products for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Members can view stock levels"
  on public.stock_levels for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Members can view stock movements"
  on public.stock_movements for select to authenticated
  using ((select private.is_business_member(business_id)));

-- ---------------------------------------------------------------------------
-- private.move_stock: the one place on hand changes. Adds the change to the
-- product's stock at the location (creating its stock level if needed) and
-- records the movement. Callers check permissions.
-- ---------------------------------------------------------------------------

create function private.move_stock(
  p_location_id uuid,
  p_product_id uuid,
  p_change numeric,
  p_reason public.stock_reason,
  p_note text default null,
  p_appointment_id uuid default null,
  p_appointment_item_id uuid default null,
  p_unit_cost_cents integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_after numeric;
  v_id uuid;
begin
  select p.business_id into v_business_id
  from public.products p join public.locations l on l.business_id = p.business_id
  where p.id = p_product_id and l.id = p_location_id;
  if v_business_id is null then
    raise exception 'Product not found at this location' using errcode = 'P0002';
  end if;
  if p_change is null or p_change = 0 then
    return null;
  end if;

  insert into public.stock_levels (business_id, location_id, product_id, on_hand)
  values (v_business_id, p_location_id, p_product_id, p_change)
  on conflict (location_id, product_id) do update set on_hand = public.stock_levels.on_hand + excluded.on_hand
  returning on_hand into v_after;

  insert into public.stock_movements (
    business_id, location_id, product_id, change, on_hand_after, reason, note,
    appointment_id, appointment_item_id, unit_cost_cents, created_by
  ) values (
    v_business_id, p_location_id, p_product_id, p_change, v_after, p_reason, nullif(trim(p_note), ''),
    p_appointment_id, p_appointment_item_id, p_unit_cost_cents, private.current_staff_id(v_business_id)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.move_stock(uuid, uuid, numeric, public.stock_reason, text, uuid, uuid, integer) from public;

-- ---------------------------------------------------------------------------
-- adjust_stock: a retail sale (front of house; the change is negative) or
-- a manual adjustment (owners and managers, with a note). Service use,
-- counts and deliveries have their own flows.
-- ---------------------------------------------------------------------------

create function public.adjust_stock(p_location_id uuid, p_product_id uuid, p_change numeric, p_reason public.stock_reason, p_note text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_after numeric;
begin
  select p.* into v_product
  from public.products p join public.locations l on l.business_id = p.business_id
  where p.id = p_product_id and l.id = p_location_id;
  if v_product.id is null then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  if p_reason = 'sale' then
    if not private.has_business_role(v_product.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
      raise exception 'Not allowed to sell' using errcode = '42501';
    end if;
    if v_product.type <> 'retail' or p_change >= 0 or p_change <> trunc(p_change) then
      raise exception 'A sale takes whole retail units out of stock' using errcode = '22023';
    end if;
  elsif p_reason = 'adjustment' then
    if not private.has_business_role(v_product.business_id, array['owner', 'manager']::public.staff_role[]) then
      raise exception 'Not allowed to adjust stock' using errcode = '42501';
    end if;
    if nullif(trim(p_note), '') is null then
      raise exception 'Say why' using errcode = '22023';
    end if;
  else
    raise exception 'Use the flow for this kind of change' using errcode = '22023';
  end if;
  if p_change is null or p_change = 0 then
    raise exception 'Enter an amount' using errcode = '22023';
  end if;

  perform private.move_stock(p_location_id, p_product_id, p_change, p_reason, p_note);
  select on_hand into v_after from public.stock_levels where location_id = p_location_id and product_id = p_product_id;
  return v_after;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_stock_settings: reorder point and quantity (owners and managers).
-- ---------------------------------------------------------------------------

create function public.set_stock_settings(p_location_id uuid, p_product_id uuid, p_reorder_point numeric, p_reorder_quantity integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select p.business_id into v_business_id
  from public.products p join public.locations l on l.business_id = p.business_id
  where p.id = p_product_id and l.id = p_location_id;
  if v_business_id is null or not private.has_business_role(v_business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.stock_levels (business_id, location_id, product_id, reorder_point, reorder_quantity)
  values (v_business_id, p_location_id, p_product_id, p_reorder_point, p_reorder_quantity)
  on conflict (location_id, product_id) do update
  set reorder_point = excluded.reorder_point, reorder_quantity = excluded.reorder_quantity;
end;
$$;

revoke all on function public.adjust_stock(uuid, uuid, numeric, public.stock_reason, text) from public, anon;
revoke all on function public.set_stock_settings(uuid, uuid, numeric, integer) from public, anon;
grant execute on function public.adjust_stock(uuid, uuid, numeric, public.stock_reason, text) to authenticated;
grant execute on function public.set_stock_settings(uuid, uuid, numeric, integer) to authenticated;
