-- Checkout: sales, what was sold on them, tips and payments.
--
-- A sale is the record of a checkout: services from the visit (at the
-- price booked, or changed with a reason), retail products (taken out of
-- stock), a discount (with a reason, by the roles the salon allows), tax
-- by the salon's rates, tips per stylist, and payments that add up to the
-- total (split across tenders). Card payments are recorded as taken on the
-- salon's own terminal for now; `processor` / `processor_reference` are
-- for Stripe later. Card numbers are never stored.
--
-- Sales are written only through complete_sale, and changed only through
-- void_sale and refund_sale (owners and managers, with a reason). Every
-- step is logged in sale_events. The front of house sees sales; stylists
-- don't (no sales totals for them).

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

alter table public.businesses
  -- Tax in basis points (825 = 8.25%), added on top of prices.
  add column tax_rate_services_bp integer not null default 0 check (tax_rate_services_bp between 0 and 2500),
  add column tax_rate_retail_bp integer not null default 0 check (tax_rate_retail_bp between 0 and 2500),
  -- Who may give discounts, and the most (in percent) anyone other than
  -- owners and managers may give.
  add column discount_roles public.staff_role[] not null default array['owner', 'manager', 'front_desk']::public.staff_role[],
  add column discount_max_percent integer not null default 100 check (discount_max_percent between 0 and 100),
  add column receipt_footer text check (length(receipt_footer) <= 500),
  add column receipt_show_stylists boolean not null default true,
  add column next_sale_number integer not null default 1001;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create type public.sale_status as enum ('completed', 'partly_refunded', 'refunded', 'voided');
create type public.sale_item_kind as enum ('service', 'product');
create type public.payment_method as enum ('cash', 'card', 'gift_card', 'package');

create table public.sales (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  location_id      uuid not null,
  -- The receipt number, per salon.
  number           integer not null,
  client_id        uuid,
  appointment_id   uuid,
  status           public.sale_status not null default 'completed',
  subtotal_cents   integer not null check (subtotal_cents >= 0),
  discount_cents   integer not null default 0 check (discount_cents >= 0),
  discount_reason  text check (length(discount_reason) <= 300),
  tax_cents        integer not null default 0 check (tax_cents >= 0),
  tip_cents        integer not null default 0 check (tip_cents >= 0),
  total_cents      integer not null check (total_cents >= 0),
  refunded_cents   integer not null default 0 check (refunded_cents >= 0),
  note             text check (length(note) <= 500),
  receipt_email    text check (length(receipt_email) <= 254),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  voided_by        uuid,
  voided_at        timestamptz,
  void_reason      text check (length(void_reason) <= 300),
  unique (id, business_id),
  unique (business_id, number),
  check (refunded_cents <= total_cents),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (client_id) references public.clients (id) on delete set null,
  foreign key (appointment_id) references public.appointments (id) on delete set null,
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by),
  foreign key (voided_by, business_id) references public.staff (id, business_id) on delete set null (voided_by)
);

-- One live sale per visit.
create unique index sales_appointment_key on public.sales (appointment_id) where appointment_id is not null and status <> 'voided';
create index sales_location_created_idx on public.sales (location_id, created_at desc);
create index sales_client_idx on public.sales (client_id) where client_id is not null;

create table public.sale_items (
  id                   uuid primary key default gen_random_uuid(),
  sale_id              uuid not null,
  business_id          uuid not null,
  position             smallint not null,
  kind                 public.sale_item_kind not null,
  service_id           uuid references public.services (id) on delete set null,
  appointment_item_id  uuid references public.appointment_items (id) on delete set null,
  product_id           uuid references public.products (id) on delete set null,
  -- Who did the service.
  staff_id             uuid,
  description          text not null check (length(description) <= 300),
  quantity             integer not null default 1 check (quantity > 0),
  unit_price_cents     integer not null check (unit_price_cents >= 0),
  -- The price it was booked at, when the price was changed at checkout.
  booked_price_cents   integer check (booked_price_cents >= 0),
  price_reason         text check (length(price_reason) <= 300),
  -- This line's share of the sale's discount, its tax, and what it came to.
  discount_cents       integer not null default 0 check (discount_cents >= 0),
  tax_cents            integer not null default 0 check (tax_cents >= 0),
  total_cents          integer not null check (total_cents >= 0),
  -- Products returned on a refund.
  returned_quantity    integer not null default 0 check (returned_quantity >= 0 and returned_quantity <= quantity),
  unique (sale_id, position),
  foreign key (sale_id, business_id) references public.sales (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete set null (staff_id)
);

create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_appointment_item_idx on public.sale_items (appointment_item_id) where appointment_item_id is not null;

create table public.sale_tips (
  sale_id       uuid not null,
  business_id   uuid not null,
  staff_id      uuid not null,
  amount_cents  integer not null check (amount_cents > 0),
  primary key (sale_id, staff_id),
  foreign key (sale_id, business_id) references public.sales (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);

create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  sale_id              uuid not null,
  business_id          uuid not null,
  location_id          uuid not null,
  method               public.payment_method not null,
  -- Negative for refunds and voids.
  amount_cents         integer not null check (amount_cents <> 0),
  -- Cash: what the client handed over, and the change given.
  tendered_cents       integer check (tendered_cents >= 0),
  change_cents         integer check (change_cents >= 0),
  -- Card: e.g. the last four digits or the terminal's approval code (never
  -- the card number).
  reference            text check (length(reference) <= 40),
  -- For a payment processor (Stripe) later.
  processor            text check (length(processor) <= 40),
  processor_reference  text check (length(processor_reference) <= 200),
  reason               text check (length(reason) <= 300),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  foreign key (sale_id, business_id) references public.sales (id, business_id) on delete cascade,
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index payments_sale_idx on public.payments (sale_id);
create index payments_location_created_idx on public.payments (location_id, created_at);

-- Everything that happened to a sale, with who and why.
create table public.sale_events (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null,
  business_id   uuid not null,
  kind          text not null check (kind in ('completed', 'voided', 'refunded', 'receipt_emailed')),
  amount_cents  integer,
  detail        text check (length(detail) <= 500),
  staff_id      uuid,
  created_at    timestamptz not null default now(),
  foreign key (sale_id, business_id) references public.sales (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete set null (staff_id)
);

create index sale_events_sale_idx on public.sale_events (sale_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security: the front of house reads; nobody writes directly.
-- ---------------------------------------------------------------------------

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_tips enable row level security;
alter table public.payments enable row level security;
alter table public.sale_events enable row level security;

create policy "Front of house can view sales" on public.sales for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can view sale items" on public.sale_items for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can view tips" on public.sale_tips for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can view payments" on public.payments for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can view sale events" on public.sale_events for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- ---------------------------------------------------------------------------
-- private.price_sale: the sale's lines with their share of the discount,
-- their tax and their totals, from gross line amounts. Discounts are shared
-- in proportion to each discountable line (rounded down, the cents left
-- over going to the first lines); tax is rounded per line. The app does the
-- same in lib/checkout.ts (computeSale), and the tests check they agree.
--
-- p_lines: [{gross, taxable_bp, discountable}] in order.
-- Returns [{discount, tax, total}] in the same order.
-- ---------------------------------------------------------------------------

create function private.price_sale(p_lines jsonb, p_discount integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pool bigint := 0;
  v_given bigint := 0;
  v_left integer;
  v_out jsonb := '[]';
  v_shares integer[] := '{}';
  v_line jsonb;
  v_share integer;
  v_net integer;
  v_tax integer;
  i integer;
begin
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ->> 'discountable')::boolean then v_pool := v_pool + (v_line ->> 'gross')::int; end if;
  end loop;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_share := case when (v_line ->> 'discountable')::boolean and v_pool > 0 then floor(p_discount::bigint * (v_line ->> 'gross')::int / v_pool)::int else 0 end;
    v_shares := v_shares || v_share;
    v_given := v_given + v_share;
  end loop;
  v_left := p_discount - v_given;
  i := 0;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if v_left > 0 and (v_line ->> 'discountable')::boolean and (v_line ->> 'gross')::int > v_shares[i] then
      v_shares[i] := v_shares[i] + 1;
      v_left := v_left - 1;
    end if;
    v_net := (v_line ->> 'gross')::int - v_shares[i];
    v_tax := round(v_net::numeric * (v_line ->> 'taxable_bp')::int / 10000)::int;
    v_out := v_out || jsonb_build_object('discount', v_shares[i], 'tax', v_tax, 'total', v_net + v_tax);
  end loop;
  return v_out;
end;
$$;

revoke all on function private.price_sale(jsonb, integer) from public;

-- ---------------------------------------------------------------------------
-- complete_sale: checks out a visit (or sells retail on its own) in one
-- go. p_input:
--   appointment_id, client_id (both optional; a visit's client is used),
--   lines: [{kind: 'service', appointment_item_id, unit_price_cents,
--            price_reason} | {kind: 'product', product_id, quantity}],
--   discount: {kind: 'amount' | 'percent', value, reason} or null,
--   tips: [{staff_id, amount_cents}],
--   payments: [{method, amount_cents, tendered_cents, reference}],
--   receipt_email, note.
-- Every service on the visit must be on the sale. Payments must add up to
-- the total exactly. Retail comes out of stock; the visit is checked out
-- (its service products deducted, as before).
-- ---------------------------------------------------------------------------

create function public.complete_sale(p_location_id uuid, p_input jsonb)
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
  v_seen uuid[] := '{}';
  v_price integer;
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
      v_rows := v_rows || jsonb_build_object(
        'kind', 'service', 'service_id', v_item.service_id, 'appointment_item_id', v_item.id, 'staff_id', v_item.staff_id,
        'description', v_item.name, 'quantity', 1, 'unit', v_price,
        'booked', case when v_price <> v_item.price_cents then v_item.price_cents end,
        'reason', case when v_price <> v_item.price_cents then trim(v_line ->> 'price_reason') end);
      v_lines := v_lines || jsonb_build_object('gross', v_price, 'taxable_bp', v_business.tax_rate_services_bp, 'discountable', true);
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

  -- Payments must cover the total exactly.
  for v_pay in select * from jsonb_array_elements(coalesce(p_input -> 'payments', '[]')) loop
    v_amount := coalesce((v_pay ->> 'amount_cents')::int, 0);
    if v_amount <= 0 then
      raise exception 'Enter each payment''s amount' using errcode = '22023';
    end if;
    if v_pay ->> 'method' not in ('cash', 'card') then
      raise exception 'That way to pay isn''t available yet' using errcode = '22023';
    end if;
    if v_pay ->> 'method' = 'cash' and coalesce((v_pay ->> 'tendered_cents')::int, v_amount) < v_amount then
      raise exception 'The cash handed over is less than the amount' using errcode = '22023';
    end if;
    v_paid := v_paid + v_amount;
  end loop;
  if v_paid <> v_total then
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
    insert into public.sale_items (
      sale_id, business_id, position, kind, service_id, appointment_item_id, product_id, staff_id, description,
      quantity, unit_price_cents, booked_price_cents, price_reason, discount_cents, tax_cents, total_cents
    ) values (
      v_sale_id, v_business.id, i + 1, (v_rows -> i ->> 'kind')::public.sale_item_kind,
      (v_rows -> i ->> 'service_id')::uuid, (v_rows -> i ->> 'appointment_item_id')::uuid, (v_rows -> i ->> 'product_id')::uuid,
      (v_rows -> i ->> 'staff_id')::uuid, v_rows -> i ->> 'description', (v_rows -> i ->> 'quantity')::int, (v_rows -> i ->> 'unit')::int,
      (v_rows -> i ->> 'booked')::int, v_rows -> i ->> 'reason',
      (v_priced -> i ->> 'discount')::int, (v_priced -> i ->> 'tax')::int, (v_priced -> i ->> 'total')::int
    );
    if v_rows -> i ->> 'kind' = 'product' then
      perform private.move_stock(p_location_id, (v_rows -> i ->> 'product_id')::uuid, -(v_rows -> i ->> 'quantity')::int, 'sale', 'Sale #' || v_number, v_appointment.id);
    end if;
  end loop;

  insert into public.sale_tips (sale_id, business_id, staff_id, amount_cents)
  select v_sale_id, v_business.id, (t ->> 'staff_id')::uuid, sum((t ->> 'amount_cents')::int)
  from jsonb_array_elements(coalesce(p_input -> 'tips', '[]')) t
  where coalesce((t ->> 'amount_cents')::int, 0) > 0
  group by (t ->> 'staff_id')::uuid;

  insert into public.payments (sale_id, business_id, location_id, method, amount_cents, tendered_cents, change_cents, reference, created_by)
  select v_sale_id, v_business.id, p_location_id, (p ->> 'method')::public.payment_method, (p ->> 'amount_cents')::int,
         case when p ->> 'method' = 'cash' then coalesce((p ->> 'tendered_cents')::int, (p ->> 'amount_cents')::int) end,
         case when p ->> 'method' = 'cash' then coalesce((p ->> 'tendered_cents')::int, (p ->> 'amount_cents')::int) - (p ->> 'amount_cents')::int end,
         nullif(trim(p ->> 'reference'), ''), v_me
  from jsonb_array_elements(p_input -> 'payments') p;

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
-- void_sale: undoes a sale entirely (owners and managers, with a reason):
-- every payment is reversed, retail goes back into stock, and the visit is
-- open again to check out.
-- ---------------------------------------------------------------------------

create function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_me uuid;
  v_item public.sale_items;
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

  insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, reason, created_by)
  select p.sale_id, p.business_id, p.location_id, p.method, -p.amount_cents, p.reference, 'Void: ' || trim(p_reason), v_me
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
-- refund_sale: gives money back (owners and managers, with a reason).
-- p_input: {reason, payments: [{method, amount_cents, reference}],
--           returns: [{sale_item_id, quantity}], restock}.
-- Refunds never add up to more than was paid; returned products can go
-- back into stock.
-- ---------------------------------------------------------------------------

create function public.refund_sale(p_sale_id uuid, p_input jsonb)
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
  v_ret jsonb;
  v_item public.sale_items;
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
    if coalesce((v_pay ->> 'amount_cents')::int, 0) <= 0 or v_pay ->> 'method' not in ('cash', 'card') then
      raise exception 'Enter each refund''s amount and how it was given' using errcode = '22023';
    end if;
    v_amount := v_amount + (v_pay ->> 'amount_cents')::int;
  end loop;
  if v_amount = 0 then
    raise exception 'Enter how much to refund' using errcode = '22023';
  end if;
  if v_sale.refunded_cents + v_amount > v_sale.total_cents then
    raise exception 'That''s more than was paid' using errcode = '22023';
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

  insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, reason, created_by)
  select p_sale_id, v_sale.business_id, v_sale.location_id, (p ->> 'method')::public.payment_method, -(p ->> 'amount_cents')::int,
         nullif(trim(p ->> 'reference'), ''), v_reason, v_me
  from jsonb_array_elements(p_input -> 'payments') p;

  update public.sales set
    refunded_cents = refunded_cents + v_amount,
    status = case when refunded_cents + v_amount >= total_cents then 'refunded' else 'partly_refunded' end::public.sale_status
  where id = p_sale_id;
  insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id)
  values (p_sale_id, v_sale.business_id, 'refunded', v_amount, v_reason, v_me);
end;
$$;

-- A receipt emailed (the message itself goes through the outbox).
create function public.log_receipt_email(p_sale_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null or not private.has_business_role(v_sale.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.sales set receipt_email = trim(p_email) where id = p_sale_id;
  insert into public.sale_events (sale_id, business_id, kind, detail, staff_id)
  values (p_sale_id, v_sale.business_id, 'receipt_emailed', trim(p_email), private.current_staff_id(v_sale.business_id));
end;
$$;

-- Tax, discounts and receipts (owners).
create function public.set_checkout_settings(p_business_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can change checkout settings' using errcode = '42501';
  end if;
  update public.businesses set
    tax_rate_services_bp = coalesce((p_settings ->> 'tax_rate_services_bp')::int, tax_rate_services_bp),
    tax_rate_retail_bp = coalesce((p_settings ->> 'tax_rate_retail_bp')::int, tax_rate_retail_bp),
    discount_roles = coalesce((select array_agg(r::public.staff_role) from jsonb_array_elements_text(p_settings -> 'discount_roles') r), discount_roles),
    discount_max_percent = coalesce((p_settings ->> 'discount_max_percent')::int, discount_max_percent),
    receipt_footer = case when p_settings ? 'receipt_footer' then nullif(trim(p_settings ->> 'receipt_footer'), '') else receipt_footer end,
    receipt_show_stylists = coalesce((p_settings ->> 'receipt_show_stylists')::boolean, receipt_show_stylists)
  where id = p_business_id;
end;
$$;

-- Outbox emails can carry an HTML version (receipts, gift cards).
alter table public.outbox_messages add column html text;

revoke all on function public.complete_sale(uuid, jsonb) from public, anon;
revoke all on function public.void_sale(uuid, text) from public, anon;
revoke all on function public.refund_sale(uuid, jsonb) from public, anon;
revoke all on function public.log_receipt_email(uuid, text) from public, anon;
revoke all on function public.set_checkout_settings(uuid, jsonb) from public, anon;
grant execute on function public.complete_sale(uuid, jsonb) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.refund_sale(uuid, jsonb) to authenticated;
grant execute on function public.log_receipt_email(uuid, text) to authenticated;
grant execute on function public.set_checkout_settings(uuid, jsonb) to authenticated;
