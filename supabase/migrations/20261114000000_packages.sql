-- Packages: a set of services with counts ("5 blowouts", "3 glosses + 3
-- treatments") at one price, optionally for certain stylist levels and
-- with an expiry. Owners make them; the front desk sells them to a client
-- at checkout and redeems uses at checkout (a use pays for the service,
-- recorded as a "package" payment); managers cancel them with a
-- pro-rated refund and a reason. Every sale, use, restore, cancellation
-- and refund is in package_events.

alter type public.sale_item_kind add value 'package';

create table public.package_templates (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  name           text not null check (length(trim(name)) > 0 and length(name) <= 120),
  price_cents    integer not null check (price_cents between 100 and 1000000),
  -- Months it lasts from the sale; null: no expiry.
  expiry_months  integer check (expiry_months between 1 and 60),
  -- The stylist levels it covers; null: any stylist.
  levels         public.staff_level[],
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, business_id)
);

create table public.package_template_items (
  template_id  uuid not null,
  business_id  uuid not null,
  service_id   uuid not null,
  quantity     integer not null check (quantity between 1 and 100),
  primary key (template_id, service_id),
  foreign key (template_id, business_id) references public.package_templates (id, business_id) on delete cascade,
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);

create type public.client_package_status as enum ('active', 'canceled', 'refunded');

create table public.client_packages (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  client_id       uuid not null references public.clients (id) on delete cascade,
  template_id     uuid references public.package_templates (id) on delete set null,
  name            text not null,
  -- What was paid for it (after any discount, before tax).
  price_cents     integer not null check (price_cents >= 0),
  levels          public.staff_level[],
  expires_at      timestamptz,
  status          public.client_package_status not null default 'active',
  sale_id         uuid references public.sales (id) on delete set null,
  refunded_cents  integer not null default 0 check (refunded_cents >= 0),
  canceled_at     timestamptz,
  canceled_by     uuid,
  cancel_reason   text check (length(cancel_reason) <= 300),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (id, business_id),
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by),
  foreign key (canceled_by, business_id) references public.staff (id, business_id) on delete set null (canceled_by)
);

create index client_packages_client_idx on public.client_packages (client_id);

create table public.client_package_items (
  id                 uuid primary key default gen_random_uuid(),
  client_package_id  uuid not null,
  business_id        uuid not null,
  service_id         uuid not null references public.services (id) on delete cascade,
  total              integer not null check (total > 0),
  used               integer not null default 0,
  -- What one use is worth, for pro-rated refunds and reports: the
  -- package's price shared by the services' menu prices.
  use_value_cents    integer not null check (use_value_cents >= 0),
  check (used between 0 and total),
  unique (client_package_id, service_id),
  foreign key (client_package_id, business_id) references public.client_packages (id, business_id) on delete cascade
);

create table public.package_events (
  id                   uuid primary key default gen_random_uuid(),
  client_package_id    uuid not null,
  business_id          uuid not null,
  kind                 text not null check (kind in ('sold', 'used', 'restored', 'canceled', 'refunded')),
  service_id           uuid references public.services (id) on delete set null,
  quantity             integer,
  amount_cents         integer,
  sale_id              uuid references public.sales (id) on delete set null,
  appointment_item_id  uuid references public.appointment_items (id) on delete set null,
  reason               text check (length(reason) <= 300),
  staff_id             uuid,
  created_at           timestamptz not null default now(),
  foreign key (client_package_id, business_id) references public.client_packages (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete set null (staff_id)
);

create index package_events_package_idx on public.package_events (client_package_id, created_at);

alter table public.sale_items
  add column client_package_id uuid references public.client_packages (id) on delete set null,
  add column package_item_id uuid references public.client_package_items (id) on delete set null;
alter table public.payments add column package_item_id uuid references public.client_package_items (id) on delete set null;

create trigger package_templates_set_updated_at before update on public.package_templates
  for each row execute function public.set_updated_at();

-- RLS: everyone at the salon sees the packages on offer and what clients
-- have left (stylists too: "Ava has 3 blowouts left"); owners write
-- templates; everything else changes only through the functions below.
alter table public.package_templates enable row level security;
alter table public.package_template_items enable row level security;
alter table public.client_packages enable row level security;
alter table public.client_package_items enable row level security;
alter table public.package_events enable row level security;

create policy "Members can view packages" on public.package_templates for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners can add packages" on public.package_templates for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));
create policy "Owners can change packages" on public.package_templates for update to authenticated
  using ((select private.has_business_role(business_id, array['owner']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));
create policy "Members can view package services" on public.package_template_items for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners can set package services" on public.package_template_items for all to authenticated
  using ((select private.has_business_role(business_id, array['owner']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));
create policy "Members can view client packages" on public.client_packages for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Members can view client package uses" on public.client_package_items for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Members can view package history" on public.package_events for select to authenticated
  using ((select private.is_business_member(business_id)));

-- ---------------------------------------------------------------------------
-- Selling and using packages (called by complete_sale and void_sale).
-- ---------------------------------------------------------------------------

-- A client's own copy of a package: its services and counts, and what each
-- use is worth (the price paid, shared by menu prices; the last service
-- takes the rounding).
create function private.sell_package(p_template_id uuid, p_client_id uuid, p_sale_id uuid, p_paid_cents integer)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_template public.package_templates;
  v_id uuid;
  v_weight bigint;
  v_given integer := 0;
  v_item record;
  v_n integer := 0;
  v_count integer;
  v_value integer;
begin
  select * into v_template from public.package_templates where id = p_template_id;
  insert into public.client_packages (business_id, client_id, template_id, name, price_cents, levels, expires_at, sale_id, created_by)
  values (v_template.business_id, p_client_id, v_template.id, v_template.name, p_paid_cents, v_template.levels,
          case when v_template.expiry_months is not null then now() + make_interval(months => v_template.expiry_months) end,
          p_sale_id, private.current_staff_id(v_template.business_id))
  returning id into v_id;

  select sum(s.price_cents::bigint * t.quantity), count(*) into v_weight, v_count
  from public.package_template_items t join public.services s on s.id = t.service_id where t.template_id = p_template_id;
  for v_item in
    select t.service_id, t.quantity, s.price_cents from public.package_template_items t join public.services s on s.id = t.service_id
    where t.template_id = p_template_id order by s.price_cents, t.service_id
  loop
    v_n := v_n + 1;
    if v_n = v_count then
      v_value := (p_paid_cents - v_given) / v_item.quantity;
    elsif v_weight > 0 then
      v_value := floor(p_paid_cents::numeric * v_item.price_cents / v_weight)::int;
    else
      v_value := floor(p_paid_cents::numeric / v_count / v_item.quantity)::int;
    end if;
    v_given := v_given + v_value * v_item.quantity;
    insert into public.client_package_items (client_package_id, business_id, service_id, total, use_value_cents)
    values (v_id, v_template.business_id, v_item.service_id, v_item.quantity, greatest(v_value, 0));
  end loop;

  insert into public.package_events (client_package_id, business_id, kind, amount_cents, sale_id, staff_id)
  values (v_id, v_template.business_id, 'sold', p_paid_cents, p_sale_id, private.current_staff_id(v_template.business_id));
  return v_id;
end;
$$;

create function private.use_package(p_item_id uuid, p_sale_id uuid, p_appointment_item_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item public.client_package_items;
begin
  update public.client_package_items set used = used + 1 where id = p_item_id returning * into v_item;
  insert into public.package_events (client_package_id, business_id, kind, service_id, quantity, amount_cents, sale_id, appointment_item_id, staff_id)
  values (v_item.client_package_id, v_item.business_id, 'used', v_item.service_id, 1, v_item.use_value_cents, p_sale_id, p_appointment_item_id, private.current_staff_id(v_item.business_id));
end;
$$;

create function private.restore_package_use(p_item_id uuid, p_sale_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item public.client_package_items;
begin
  update public.client_package_items set used = greatest(used - 1, 0) where id = p_item_id returning * into v_item;
  insert into public.package_events (client_package_id, business_id, kind, service_id, quantity, sale_id, reason, staff_id)
  values (v_item.client_package_id, v_item.business_id, 'restored', v_item.service_id, 1, p_sale_id, p_reason, private.current_staff_id(v_item.business_id));
end;
$$;

revoke all on function private.sell_package(uuid, uuid, uuid, integer) from public;
revoke all on function private.use_package(uuid, uuid, uuid) from public;
revoke all on function private.restore_package_use(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Owners: a package's services (replacing them all).
-- ---------------------------------------------------------------------------

create function public.save_package_template(p_template_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_id uuid := p_template_id;
begin
  select s.business_id into v_business_id from public.staff s where s.user_id = auth.uid() and s.is_active and s.role = 'owner' limit 1;
  if v_business_id is null then
    raise exception 'Only owners can set up packages' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_input -> 'items', '[]')) = 0 then
    raise exception 'Add at least one service' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_input -> 'items') x
    where not exists (select 1 from public.services s where s.id = (x ->> 'service_id')::uuid and s.business_id = v_business_id)
       or coalesce((x ->> 'quantity')::int, 0) not between 1 and 100
  ) then
    raise exception 'Choose services and how many of each (1 to 100)' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.package_templates (business_id, name, price_cents, expiry_months, levels, is_active)
    values (v_business_id, trim(p_input ->> 'name'), (p_input ->> 'price_cents')::int, nullif(p_input ->> 'expiry_months', '')::int,
            (select array_agg(l::public.staff_level) from jsonb_array_elements_text(case when jsonb_typeof(p_input -> 'levels') = 'array' then p_input -> 'levels' else '[]' end) l), coalesce((p_input ->> 'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.package_templates set
      name = trim(p_input ->> 'name'),
      price_cents = (p_input ->> 'price_cents')::int,
      expiry_months = nullif(p_input ->> 'expiry_months', '')::int,
      levels = (select array_agg(l::public.staff_level) from jsonb_array_elements_text(case when jsonb_typeof(p_input -> 'levels') = 'array' then p_input -> 'levels' else '[]' end) l),
      is_active = coalesce((p_input ->> 'is_active')::boolean, is_active)
    where id = v_id and business_id = v_business_id;
    if not found then
      raise exception 'Package not found' using errcode = 'P0002';
    end if;
    delete from public.package_template_items where template_id = v_id;
  end if;
  insert into public.package_template_items (template_id, business_id, service_id, quantity)
  select v_id, v_business_id, (x ->> 'service_id')::uuid, sum((x ->> 'quantity')::int)
  from jsonb_array_elements(p_input -> 'items') x group by (x ->> 'service_id')::uuid;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Managers and owners: cancel a client's package with a reason, refunding
-- the unused part pro-rated (what the remaining uses are worth) by cash or
-- card, or nothing. The refund is recorded on the sale that sold it.
-- ---------------------------------------------------------------------------

create function public.cancel_package(p_client_package_id uuid, p_reason text, p_refund_method text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package public.client_packages;
  v_me uuid;
  v_refund integer;
  v_sale public.sales;
begin
  select * into v_package from public.client_packages where id = p_client_package_id for update;
  if v_package.id is null or not private.has_business_role(v_package.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only managers and owners can cancel packages' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v_package.status <> 'active' then
    raise exception 'That package was already canceled' using errcode = '55000';
  end if;
  if p_refund_method not in ('cash', 'card', 'none') then
    raise exception 'Choose how the refund is given' using errcode = '22023';
  end if;
  v_me := private.current_staff_id(v_package.business_id);
  v_refund := least(
    (select coalesce(sum((total - used) * use_value_cents), 0) from public.client_package_items where client_package_id = v_package.id)::int,
    v_package.price_cents - v_package.refunded_cents);

  if p_refund_method <> 'none' and v_refund > 0 then
    select * into v_sale from public.sales where id = v_package.sale_id for update;
    if v_sale.id is null then
      raise exception 'There''s no sale to refund this against; cancel without a refund' using errcode = '22023';
    end if;
    insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reason, created_by)
    values (v_sale.id, v_sale.business_id, v_sale.location_id, p_refund_method::public.payment_method, -v_refund, 'Package canceled: ' || trim(p_reason), v_me);
    update public.sales set
      refunded_cents = least(total_cents, refunded_cents + v_refund),
      status = case when least(total_cents, refunded_cents + v_refund) >= total_cents then 'refunded' else 'partly_refunded' end::public.sale_status
    where id = v_sale.id and status <> 'voided';
    insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id)
    values (v_sale.id, v_sale.business_id, 'refunded', v_refund, 'Package canceled: ' || trim(p_reason), v_me);
  else
    v_refund := 0;
  end if;

  update public.client_packages set
    status = case when v_refund > 0 then 'refunded' else 'canceled' end::public.client_package_status,
    refunded_cents = refunded_cents + v_refund, canceled_at = now(), canceled_by = v_me, cancel_reason = trim(p_reason)
  where id = v_package.id;
  insert into public.package_events (client_package_id, business_id, kind, amount_cents, reason, staff_id)
  values (v_package.id, v_package.business_id, case when v_refund > 0 then 'refunded' else 'canceled' end, v_refund, trim(p_reason), v_me);
  return v_refund;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_sale, as before, plus:
--   lines {kind: 'package', template_id}: sells a package to the sale's
--         client (taxed like services);
--   service lines with package_item_id: a use of the client's package pays
--         for the service; the database adds the "package" payment, so
--         staff's payments cover the rest.
-- ---------------------------------------------------------------------------

create or replace function public.complete_sale(p_location_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_me uuid;
  v_appointment public.appointments;
  v_client_id uuid := nullif(p_input ->> 'client_id', '')::uuid;
  v_line jsonb;
  v_item record;
  v_product public.products;
  v_card public.gift_cards;
  v_lines jsonb := '[]';
  v_priced jsonb;
  v_rows jsonb := '[]';
  v_subtotal integer := 0;
  v_discountable integer := 0;
  v_discount integer := 0;
  v_discount_reason text;
  v_tax integer := 0;
  v_tips integer := 0;
  v_total integer;
  v_paid integer := 0;
  v_pay jsonb;
  v_amount integer;
  v_number integer;
  v_sale_id uuid;
  v_payment_id uuid;
  v_sale_item_id uuid;
  v_seen uuid[] := '{}';
  v_codes text[] := '{}';
  v_price integer;
  v_has_cards boolean := false;
  v_code text;
  v_template public.package_templates;
  v_pitem record;
  v_package_id uuid;
  v_covered integer := 0;
  v_level public.staff_level;
  i integer;
begin
  select b.* into v_business from public.businesses b join public.locations l on l.business_id = b.id where l.id = p_location_id;
  if v_business.id is null or not private.has_business_role(v_business.id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to take payments' using errcode = '42501';
  end if;
  v_me := private.current_staff_id(v_business.id);

  if nullif(p_input ->> 'appointment_id', '') is not null then
    select * into v_appointment from public.appointments
    where id = (p_input ->> 'appointment_id')::uuid and location_id = p_location_id for update;
    if v_appointment.id is null then
      raise exception 'Appointment not found' using errcode = 'P0002';
    end if;
    if v_appointment.status not in ('booked', 'confirmed', 'checked_in') then
      raise exception 'This visit is already checked out or canceled' using errcode = '55000';
    end if;
    v_client_id := v_appointment.client_id;
  end if;
  if v_client_id is not null and not exists (select 1 from public.clients where id = v_client_id and business_id = v_business.id) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  -- Lines, priced from our tables.
  for v_line in select * from jsonb_array_elements(coalesce(p_input -> 'lines', '[]')) loop
    if v_line ->> 'kind' = 'service' then
      select i.id, i.service_id, i.staff_id, i.price_cents, s.name into v_item
      from public.appointment_items i join public.services s on s.id = i.service_id
      where i.id = (v_line ->> 'appointment_item_id')::uuid and i.appointment_id = v_appointment.id;
      if v_item.id is null or v_item.id = any (v_seen) then
        raise exception 'That service isn''t on this visit' using errcode = '22023';
      end if;
      v_seen := v_seen || v_item.id;
      v_price := coalesce((v_line ->> 'unit_price_cents')::int, v_item.price_cents);
      if v_price < 0 or v_price > 10000000 then
        raise exception 'Enter a price' using errcode = '22023';
      end if;
      if v_price <> v_item.price_cents and nullif(trim(v_line ->> 'price_reason'), '') is null then
        raise exception 'Say why the price changed' using errcode = '22023';
      end if;
      -- Paid for with a package the client has: a use of it covers the
      -- line (not taxed or discounted again).
      -- No package unless one is given (a record with empty fields).
      select null::uuid as id, null::int as total, null::int as used, null::uuid as package_id, null::public.staff_level[] as levels,
             null::timestamptz as expires_at, null::public.client_package_status as status, null::uuid as client_id, null::text as name
        into v_pitem;
      if nullif(v_line ->> 'package_item_id', '') is not null then
        select pi.id, pi.total, pi.used, p.id as package_id, p.levels, p.expires_at, p.status, p.client_id, p.name into v_pitem
        from public.client_package_items pi join public.client_packages p on p.id = pi.client_package_id
        where pi.id = (v_line ->> 'package_item_id')::uuid and pi.service_id = v_item.service_id and p.business_id = v_business.id
        for update of pi;
        if v_pitem.id is null or v_pitem.client_id is distinct from v_client_id then
          raise exception 'That package doesn''t cover this service for this client' using errcode = '22023';
        end if;
        if v_pitem.status <> 'active' or (v_pitem.expires_at is not null and v_pitem.expires_at <= now()) then
          raise exception 'That package has expired or was canceled' using errcode = '55000';
        end if;
        if v_pitem.used + (select count(*) from jsonb_array_elements(v_rows) r where r ->> 'package_item_id' = v_pitem.id::text) >= v_pitem.total then
          raise exception 'No uses left on that package for this service' using errcode = '22023';
        end if;
        select level into v_level from public.staff where id = v_item.staff_id;
        if v_pitem.levels is not null and (v_level is null or not (v_level = any (v_pitem.levels))) then
          raise exception 'That package doesn''t cover this stylist''s level' using errcode = '22023';
        end if;
        v_covered := v_covered + v_price;
      end if;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'service', 'service_id', v_item.service_id, 'appointment_item_id', v_item.id, 'staff_id', v_item.staff_id,
        'description', v_item.name, 'quantity', 1, 'unit', v_price,
        'booked', case when v_price <> v_item.price_cents then v_item.price_cents end,
        'reason', case when v_price <> v_item.price_cents then trim(v_line ->> 'price_reason') end,
        'package_item_id', v_pitem.id, 'package_name', v_pitem.name);
      v_lines := v_lines || jsonb_build_object('gross', v_price, 'taxable_bp', case when v_pitem.id is null then v_business.tax_rate_services_bp else 0 end, 'discountable', v_pitem.id is null);
    elsif v_line ->> 'kind' = 'product' then
      select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid and business_id = v_business.id;
      if v_product.id is null or v_product.type <> 'retail' or not v_product.is_active then
        raise exception 'That product can''t be sold' using errcode = '22023';
      end if;
      if coalesce((v_line ->> 'quantity')::int, 0) not between 1 and 100 then
        raise exception 'Enter how many' using errcode = '22023';
      end if;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'product', 'product_id', v_product.id, 'staff_id', null,
        'description', concat_ws(' ', v_product.brand, v_product.line, v_product.name), 'quantity', (v_line ->> 'quantity')::int, 'unit', v_product.price_cents);
      v_lines := v_lines || jsonb_build_object('gross', v_product.price_cents * (v_line ->> 'quantity')::int, 'taxable_bp', v_business.tax_rate_retail_bp, 'discountable', true);
    elsif v_line ->> 'kind' = 'gift_card' then
      v_amount := coalesce((v_line ->> 'amount_cents')::int, 0);
      if v_amount < 500 or v_amount > 100000 then
        raise exception 'A gift card is $5 to $1,000' using errcode = '22023';
      end if;
      v_code := nullif(private.gift_code(v_line ->> 'code'), '');
      if v_code is not null then
        if length(v_code) < 8 or length(v_code) > 32 then
          raise exception 'A card''s code has 8 to 32 letters and numbers' using errcode = '22023';
        end if;
        if v_code = any (v_codes) or exists (select 1 from public.gift_cards where business_id = v_business.id and code = v_code) then
          raise exception 'That gift card code is already in use' using errcode = '22023';
        end if;
        v_codes := v_codes || v_code;
      end if;
      v_has_cards := true;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'gift_card', 'description', case when v_code is null then 'Gift card (digital)' else 'Gift card' end,
        'quantity', 1, 'unit', v_amount, 'code', v_code,
        'recipient_name', nullif(trim(v_line ->> 'recipient_name'), ''), 'recipient_email', nullif(trim(v_line ->> 'recipient_email'), ''));
      v_lines := v_lines || jsonb_build_object('gross', v_amount, 'taxable_bp', 0, 'discountable', false);
    elsif v_line ->> 'kind' = 'gift_card_reload' then
      v_amount := coalesce((v_line ->> 'amount_cents')::int, 0);
      if v_amount < 500 or v_amount > 100000 then
        raise exception 'A reload is $5 to $1,000' using errcode = '22023';
      end if;
      v_card := private.usable_card(v_business.id, v_line ->> 'code');
      if v_card.kind <> 'purchased' then
        raise exception 'Promotional cards can''t be reloaded' using errcode = '22023';
      end if;
      v_has_cards := true;
      v_rows := v_rows || jsonb_build_object('kind', 'gift_card_reload', 'description', 'Gift card reload', 'quantity', 1, 'unit', v_amount, 'gift_card_id', v_card.id);
      v_lines := v_lines || jsonb_build_object('gross', v_amount, 'taxable_bp', 0, 'discountable', false);
    elsif v_line ->> 'kind' = 'package' then
      select * into v_template from public.package_templates where id = (v_line ->> 'template_id')::uuid and business_id = v_business.id and is_active;
      if v_template.id is null then
        raise exception 'That package isn''t for sale' using errcode = '22023';
      end if;
      if v_client_id is null then
        raise exception 'Choose the client the package is for' using errcode = '22023';
      end if;
      v_rows := v_rows || jsonb_build_object('kind', 'package', 'description', v_template.name, 'quantity', 1, 'unit', v_template.price_cents, 'template_id', v_template.id);
      v_lines := v_lines || jsonb_build_object('gross', v_template.price_cents, 'taxable_bp', v_business.tax_rate_services_bp, 'discountable', true);
    else
      raise exception 'Unknown line' using errcode = '22023';
    end if;
  end loop;

  if jsonb_array_length(v_rows) = 0 then
    raise exception 'Add something to the sale' using errcode = '22023';
  end if;
  if v_appointment.id is not null and exists (
    select 1 from public.appointment_items i where i.appointment_id = v_appointment.id and not (i.id = any (v_seen))
  ) then
    raise exception 'Every service on the visit needs to be on the sale' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_subtotal := v_subtotal + (v_line ->> 'gross')::int;
    if (v_line ->> 'discountable')::boolean then v_discountable := v_discountable + (v_line ->> 'gross')::int; end if;
  end loop;

  -- The discount, by who may give it and how much.
  if p_input -> 'discount' is not null and jsonb_typeof(p_input -> 'discount') = 'object' and coalesce((p_input -> 'discount' ->> 'value')::int, 0) > 0 then
    if not private.has_business_role(v_business.id, v_business.discount_roles) then
      raise exception 'You can''t give discounts' using errcode = '42501';
    end if;
    v_discount_reason := nullif(trim(p_input -> 'discount' ->> 'reason'), '');
    if v_discount_reason is null then
      raise exception 'Say why there''s a discount' using errcode = '22023';
    end if;
    if p_input -> 'discount' ->> 'kind' = 'percent' then
      if (p_input -> 'discount' ->> 'value')::int > 100 then
        raise exception 'A discount can''t be more than 100%%' using errcode = '22023';
      end if;
      v_discount := round(v_discountable::numeric * (p_input -> 'discount' ->> 'value')::int / 100)::int;
    else
      v_discount := (p_input -> 'discount' ->> 'value')::int;
    end if;
    if v_discount > v_discountable then
      raise exception 'The discount is more than the sale' using errcode = '22023';
    end if;
    if not private.has_business_role(v_business.id, array['owner', 'manager']::public.staff_role[])
       and v_discount * 100 > v_discountable * v_business.discount_max_percent then
      raise exception 'That''s more discount than you can give' using errcode = '42501';
    end if;
  end if;

  v_priced := private.price_sale(v_lines, v_discount);
  for i in 0 .. jsonb_array_length(v_priced) - 1 loop
    v_tax := v_tax + (v_priced -> i ->> 'tax')::int;
  end loop;

  -- Tips, per stylist on the sale.
  for v_line in select * from jsonb_array_elements(coalesce(p_input -> 'tips', '[]')) loop
    if coalesce((v_line ->> 'amount_cents')::int, 0) < 0 then
      raise exception 'A tip can''t be negative' using errcode = '22023';
    end if;
    if coalesce((v_line ->> 'amount_cents')::int, 0) > 0 and not exists (
      select 1 from public.staff where id = (v_line ->> 'staff_id')::uuid and business_id = v_business.id
    ) then
      raise exception 'Unknown stylist for a tip' using errcode = '22023';
    end if;
    v_tips := v_tips + coalesce((v_line ->> 'amount_cents')::int, 0);
  end loop;

  v_total := v_subtotal - v_discount + v_tax + v_tips;

  -- Payments must cover the total exactly: what packages cover (added
  -- below), and the rest from what staff entered.
  for v_pay in select * from jsonb_array_elements(coalesce(p_input -> 'payments', '[]')) loop
    v_amount := coalesce((v_pay ->> 'amount_cents')::int, 0);
    if v_amount <= 0 then
      raise exception 'Enter each payment''s amount' using errcode = '22023';
    end if;
    if v_pay ->> 'method' not in ('cash', 'card', 'gift_card') then
      raise exception 'That way to pay isn''t available' using errcode = '22023';
    end if;
    if v_pay ->> 'method' = 'gift_card' and v_has_cards then
      raise exception 'Gift cards can''t be paid for with a gift card' using errcode = '22023';
    end if;
    if v_pay ->> 'method' = 'cash' and coalesce((v_pay ->> 'tendered_cents')::int, v_amount) < v_amount then
      raise exception 'The cash handed over is less than the amount' using errcode = '22023';
    end if;
    v_paid := v_paid + v_amount;
  end loop;
  if v_paid + v_covered <> v_total then
    raise exception 'Payments don''t add up to the total' using errcode = '22023';
  end if;

  update public.businesses set next_sale_number = next_sale_number + 1 where id = v_business.id returning next_sale_number - 1 into v_number;

  insert into public.sales (
    business_id, location_id, number, client_id, appointment_id, subtotal_cents, discount_cents, discount_reason,
    tax_cents, tip_cents, total_cents, note, receipt_email, created_by
  ) values (
    v_business.id, p_location_id, v_number, v_client_id, v_appointment.id, v_subtotal, v_discount, v_discount_reason,
    v_tax, v_tips, v_total, nullif(trim(p_input ->> 'note'), ''), nullif(trim(p_input ->> 'receipt_email'), ''), v_me
  ) returning id into v_sale_id;

  for i in 0 .. jsonb_array_length(v_rows) - 1 loop
    -- New gift cards are made first, so their line can point to them.
    v_card := null;
    if v_rows -> i ->> 'kind' = 'gift_card' then
      insert into public.gift_cards (business_id, code, kind, initial_cents, balance_cents, expires_at, client_id, recipient_name, recipient_email, physical, sale_id, created_by)
      values (v_business.id, coalesce(v_rows -> i ->> 'code', private.new_gift_code(v_business.id)), 'purchased', (v_rows -> i ->> 'unit')::int, 0,
              case when v_business.gift_card_expiry_months is not null then now() + make_interval(months => v_business.gift_card_expiry_months) end,
              v_client_id, v_rows -> i ->> 'recipient_name', v_rows -> i ->> 'recipient_email', v_rows -> i ->> 'code' is not null, v_sale_id, v_me)
      returning * into v_card;
      perform private.move_gift_card(v_card, 'sold', (v_rows -> i ->> 'unit')::int, v_sale_id, null);
    elsif v_rows -> i ->> 'kind' = 'gift_card_reload' then
      select * into v_card from public.gift_cards where id = (v_rows -> i ->> 'gift_card_id')::uuid for update;
      perform private.move_gift_card(v_card, 'reloaded', (v_rows -> i ->> 'unit')::int, v_sale_id, null);
    end if;
    v_package_id := null;
    if v_rows -> i ->> 'kind' = 'package' then
      v_package_id := private.sell_package((v_rows -> i ->> 'template_id')::uuid, v_client_id, v_sale_id, (v_priced -> i ->> 'total')::int - (v_priced -> i ->> 'tax')::int);
    end if;

    insert into public.sale_items (
      sale_id, business_id, position, kind, service_id, appointment_item_id, product_id, staff_id, description,
      quantity, unit_price_cents, booked_price_cents, price_reason, discount_cents, tax_cents, total_cents, gift_card_id,
      client_package_id, package_item_id
    ) values (
      v_sale_id, v_business.id, i + 1, (v_rows -> i ->> 'kind')::public.sale_item_kind,
      (v_rows -> i ->> 'service_id')::uuid, (v_rows -> i ->> 'appointment_item_id')::uuid, (v_rows -> i ->> 'product_id')::uuid,
      (v_rows -> i ->> 'staff_id')::uuid, v_rows -> i ->> 'description', (v_rows -> i ->> 'quantity')::int, (v_rows -> i ->> 'unit')::int,
      (v_rows -> i ->> 'booked')::int, v_rows -> i ->> 'reason',
      (v_priced -> i ->> 'discount')::int, (v_priced -> i ->> 'tax')::int, (v_priced -> i ->> 'total')::int, v_card.id,
      v_package_id, (v_rows -> i ->> 'package_item_id')::uuid
    ) returning id into v_sale_item_id;
    if v_rows -> i ->> 'package_item_id' is not null then
      perform private.use_package((v_rows -> i ->> 'package_item_id')::uuid, v_sale_id, (v_rows -> i ->> 'appointment_item_id')::uuid);
      insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, package_item_id, created_by)
      values (v_sale_id, v_business.id, p_location_id, 'package', (v_priced -> i ->> 'total')::int, left(v_rows -> i ->> 'package_name', 40), (v_rows -> i ->> 'package_item_id')::uuid, v_me);
    end if;
    if v_rows -> i ->> 'kind' = 'product' then
      perform private.move_stock(p_location_id, (v_rows -> i ->> 'product_id')::uuid, -(v_rows -> i ->> 'quantity')::int, 'sale', 'Sale #' || v_number, v_appointment.id);
    end if;
  end loop;

  insert into public.sale_tips (sale_id, business_id, staff_id, amount_cents)
  select v_sale_id, v_business.id, (t ->> 'staff_id')::uuid, sum((t ->> 'amount_cents')::int)
  from jsonb_array_elements(coalesce(p_input -> 'tips', '[]')) t
  where coalesce((t ->> 'amount_cents')::int, 0) > 0
  group by (t ->> 'staff_id')::uuid;

  for v_pay in select * from jsonb_array_elements(p_input -> 'payments') loop
    v_card := null;
    if v_pay ->> 'method' = 'gift_card' then
      v_card := private.usable_card(v_business.id, v_pay ->> 'code');
      if v_card.balance_cents < (v_pay ->> 'amount_cents')::int then
        raise exception 'Only % left on that gift card', to_char(v_card.balance_cents / 100.0, 'FM$999,990.00') using errcode = '22023';
      end if;
    end if;
    insert into public.payments (sale_id, business_id, location_id, method, amount_cents, tendered_cents, change_cents, reference, gift_card_id, created_by)
    values (
      v_sale_id, v_business.id, p_location_id, (v_pay ->> 'method')::public.payment_method, (v_pay ->> 'amount_cents')::int,
      case when v_pay ->> 'method' = 'cash' then coalesce((v_pay ->> 'tendered_cents')::int, (v_pay ->> 'amount_cents')::int) end,
      case when v_pay ->> 'method' = 'cash' then coalesce((v_pay ->> 'tendered_cents')::int, (v_pay ->> 'amount_cents')::int) - (v_pay ->> 'amount_cents')::int end,
      case when v_card.id is not null then '…' || right(v_card.code, 4) else nullif(trim(v_pay ->> 'reference'), '') end,
      v_card.id, v_me
    ) returning id into v_payment_id;
    if v_card.id is not null then
      perform private.move_gift_card(v_card, 'redeemed', -(v_pay ->> 'amount_cents')::int, v_sale_id, null);
    end if;
  end loop;

  insert into public.sale_events (sale_id, business_id, kind, amount_cents, staff_id)
  values (v_sale_id, v_business.id, 'completed', v_total, v_me);

  -- The visit is checked out (and its service products deducted).
  if v_appointment.id is not null then
    update public.appointments set
      status = 'completed',
      checked_in_at = coalesce(checked_in_at, now()),
      checked_out_at = now(),
      updated_by = v_me
    where id = v_appointment.id;
    for v_item in select i.id from public.appointment_items i where i.appointment_id = v_appointment.id order by i.starts_at loop
      perform private.deduct_item_stock(v_item.id);
    end loop;
  end if;

  return v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_sale, as before, plus: packages sold on the sale are canceled (if
-- they haven't been used), and package uses are given back.
-- ---------------------------------------------------------------------------

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_me uuid;
  v_item public.sale_items;
  v_card public.gift_cards;
  v_pay public.payments;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if v_sale.id is null or not private.has_business_role(v_sale.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only managers and owners can void a sale' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v_sale.status <> 'completed' then
    raise exception 'This sale was already refunded or voided' using errcode = '55000';
  end if;
  v_me := private.current_staff_id(v_sale.business_id);

  -- Gift cards sold or reloaded on the sale.
  for v_item in select * from public.sale_items where sale_id = p_sale_id and kind in ('gift_card', 'gift_card_reload') loop
    select * into v_card from public.gift_cards where id = v_item.gift_card_id for update;
    if v_item.kind = 'gift_card' then
      if v_card.balance_cents < v_card.initial_cents or exists (select 1 from public.gift_card_events where card_id = v_card.id and kind = 'redeemed') then
        raise exception 'A gift card from this sale has been used, so it can''t be voided. Refund instead.' using errcode = '55000';
      end if;
      perform private.move_gift_card(v_card, 'voided', -v_card.balance_cents, p_sale_id, 'Void: ' || trim(p_reason));
      update public.gift_cards set status = 'voided' where id = v_card.id;
    else
      if v_card.balance_cents < v_item.unit_price_cents then
        raise exception 'The reloaded card has been used, so this can''t be voided. Refund instead.' using errcode = '55000';
      end if;
      perform private.move_gift_card(v_card, 'refunded', -v_item.unit_price_cents, p_sale_id, 'Void: ' || trim(p_reason));
    end if;
  end loop;

  -- Packages sold on the sale (if not used), and uses of packages back.
  for v_item in select * from public.sale_items where sale_id = p_sale_id and kind = 'package' loop
    if exists (select 1 from public.client_package_items where client_package_id = v_item.client_package_id and used > 0) then
      raise exception 'A package from this sale has been used, so it can''t be voided. Cancel the package instead.' using errcode = '55000';
    end if;
    update public.client_packages set status = 'canceled', canceled_at = now(), canceled_by = v_me, cancel_reason = 'Void: ' || trim(p_reason) where id = v_item.client_package_id;
    insert into public.package_events (client_package_id, business_id, kind, sale_id, reason, staff_id)
    values (v_item.client_package_id, v_sale.business_id, 'canceled', p_sale_id, 'Void: ' || trim(p_reason), v_me);
  end loop;
  for v_item in select * from public.sale_items where sale_id = p_sale_id and package_item_id is not null loop
    perform private.restore_package_use(v_item.package_item_id, p_sale_id, 'Void: ' || trim(p_reason));
  end loop;

  -- Gift card payments back on their cards.
  for v_pay in select * from public.payments where sale_id = p_sale_id and method = 'gift_card' and amount_cents > 0 loop
    select * into v_card from public.gift_cards where id = v_pay.gift_card_id for update;
    perform private.move_gift_card(v_card, 'refunded', v_pay.amount_cents, p_sale_id, 'Void: ' || trim(p_reason));
  end loop;

  insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, gift_card_id, reason, created_by)
  select p.sale_id, p.business_id, p.location_id, p.method, -p.amount_cents, p.reference, p.gift_card_id, 'Void: ' || trim(p_reason), v_me
  from public.payments p where p.sale_id = p_sale_id and p.amount_cents > 0;

  for v_item in select * from public.sale_items where sale_id = p_sale_id and kind = 'product' and quantity > returned_quantity loop
    perform private.move_stock(v_sale.location_id, v_item.product_id, v_item.quantity - v_item.returned_quantity, 'sale', 'Void of sale #' || v_sale.number, v_sale.appointment_id);
  end loop;

  update public.sales set status = 'voided', voided_by = v_me, voided_at = now(), void_reason = trim(p_reason) where id = p_sale_id;
  if v_sale.appointment_id is not null then
    update public.appointments set status = 'checked_in', checked_out_at = null, updated_by = v_me
    where id = v_sale.appointment_id and status = 'completed';
  end if;
  insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id)
  values (p_sale_id, v_sale.business_id, 'voided', v_sale.total_cents, trim(p_reason), v_me);
end;
$$;

-- ---------------------------------------------------------------------------
-- refund_sale, as before, but what packages covered can't come back as cash
-- or card either.
-- ---------------------------------------------------------------------------

create or replace function public.refund_sale(p_sale_id uuid, p_input jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_me uuid;
  v_reason text := nullif(trim(p_input ->> 'reason'), '');
  v_pay jsonb;
  v_amount integer := 0;
  v_cash_like integer := 0;
  v_promo_paid integer;
  v_ret jsonb;
  v_item public.sale_items;
  v_card public.gift_cards;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if v_sale.id is null or not private.has_business_role(v_sale.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only managers and owners can refund' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v_sale.status not in ('completed', 'partly_refunded') then
    raise exception 'This sale was already refunded or voided' using errcode = '55000';
  end if;
  v_me := private.current_staff_id(v_sale.business_id);

  for v_pay in select * from jsonb_array_elements(coalesce(p_input -> 'payments', '[]')) loop
    if coalesce((v_pay ->> 'amount_cents')::int, 0) <= 0 or v_pay ->> 'method' not in ('cash', 'card', 'gift_card') then
      raise exception 'Enter each refund''s amount and how it was given' using errcode = '22023';
    end if;
    v_amount := v_amount + (v_pay ->> 'amount_cents')::int;
    if v_pay ->> 'method' <> 'gift_card' then v_cash_like := v_cash_like + (v_pay ->> 'amount_cents')::int; end if;
  end loop;
  if v_amount = 0 then
    raise exception 'Enter how much to refund' using errcode = '22023';
  end if;
  if v_sale.refunded_cents + v_amount > v_sale.total_cents then
    raise exception 'That''s more than was paid' using errcode = '22023';
  end if;
  -- Promotional credit has no cash value, and package uses go back on the
  -- package (cancel it for a refund), not out as money.
  select coalesce(sum(p.amount_cents), 0) into v_promo_paid from public.payments p left join public.gift_cards g on g.id = p.gift_card_id
  where p.sale_id = p_sale_id and p.amount_cents > 0 and (g.kind = 'promotional' or p.method = 'package');
  if v_cash_like > 0 and v_sale.refunded_cents + v_cash_like > v_sale.total_cents - v_promo_paid then
    raise exception 'Promotional credit and package uses can''t be refunded as cash or card' using errcode = '22023';
  end if;

  for v_ret in select * from jsonb_array_elements(coalesce(p_input -> 'returns', '[]')) loop
    select * into v_item from public.sale_items where id = (v_ret ->> 'sale_item_id')::uuid and sale_id = p_sale_id and kind = 'product' for update;
    if v_item.id is null or coalesce((v_ret ->> 'quantity')::int, 0) < 1 or v_item.returned_quantity + (v_ret ->> 'quantity')::int > v_item.quantity then
      raise exception 'Those products weren''t on the sale' using errcode = '22023';
    end if;
    update public.sale_items set returned_quantity = returned_quantity + (v_ret ->> 'quantity')::int where id = v_item.id;
    if coalesce((p_input ->> 'restock')::boolean, true) then
      perform private.move_stock(v_sale.location_id, v_item.product_id, (v_ret ->> 'quantity')::int, 'sale', 'Return on sale #' || v_sale.number, v_sale.appointment_id);
    end if;
  end loop;

  for v_pay in select * from jsonb_array_elements(p_input -> 'payments') loop
    v_card := null;
    if v_pay ->> 'method' = 'gift_card' then
      select * into v_card from public.gift_cards where business_id = v_sale.business_id and code = private.gift_code(v_pay ->> 'code') for update;
      if v_card.id is null or v_card.status = 'voided' then
        raise exception 'No gift card has that code' using errcode = 'P0002';
      end if;
      perform private.move_gift_card(v_card, 'refunded', (v_pay ->> 'amount_cents')::int, p_sale_id, v_reason);
    end if;
    insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, gift_card_id, reason, created_by)
    values (p_sale_id, v_sale.business_id, v_sale.location_id, (v_pay ->> 'method')::public.payment_method, -(v_pay ->> 'amount_cents')::int,
            case when v_card.id is not null then '…' || right(v_card.code, 4) else nullif(trim(v_pay ->> 'reference'), '') end, v_card.id, v_reason, v_me);
  end loop;

  update public.sales set
    refunded_cents = refunded_cents + v_amount,
    status = case when refunded_cents + v_amount >= total_cents then 'refunded' else 'partly_refunded' end::public.sale_status
  where id = p_sale_id;
  insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id)
  values (p_sale_id, v_sale.business_id, 'refunded', v_amount, v_reason, v_me);
end;
$$;

revoke all on function public.save_package_template(uuid, jsonb) from public, anon;
revoke all on function public.cancel_package(uuid, text, text) from public, anon;
grant execute on function public.save_package_template(uuid, jsonb) to authenticated;
grant execute on function public.cancel_package(uuid, text, text) to authenticated;
