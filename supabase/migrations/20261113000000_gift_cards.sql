-- Gift cards: sold at checkout (any amount or the salon's presets),
-- physical (a code entered or scanned) or digital (an emailed code),
-- redeemed as a payment (partly, with the balance left shown), reloaded,
-- adjusted and voided. Promotional cards ("$20 off for referrals") are
-- issued by managers, tracked apart from purchased ones, can expire and
-- have no cash value. Balances imported from Phorest land here too.
--
-- Every change to a balance is a row in gift_card_events, with who, why
-- and the balance after; balances change only through the functions below.
-- Lookups are logged and rate-limited per staff member.

alter type public.sale_item_kind add value 'gift_card';
alter type public.sale_item_kind add value 'gift_card_reload';

alter table public.businesses
  -- Preset amounts offered at the front desk.
  add column gift_card_presets_cents integer[] not null default array[2500, 5000, 10000, 15000],
  -- Months a purchased card lasts; null: no expiry (the default).
  add column gift_card_expiry_months integer check (gift_card_expiry_months between 1 and 120),
  -- Days a promotional card lasts by default.
  add column promo_card_expiry_days integer not null default 90 check (promo_card_expiry_days between 1 and 3650);

create type public.gift_card_kind as enum ('purchased', 'promotional');
create type public.gift_card_status as enum ('active', 'voided');

create table public.gift_cards (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  -- Letters and digits only, upper case (shown in groups of four).
  code             text not null check (code ~ '^[A-Z0-9]{8,32}$'),
  kind             public.gift_card_kind not null,
  status           public.gift_card_status not null default 'active',
  initial_cents    integer not null check (initial_cents >= 0),
  balance_cents    integer not null check (balance_cents >= 0),
  expires_at       timestamptz,
  -- Who it's for, or who bought it.
  client_id        uuid references public.clients (id) on delete set null,
  recipient_name   text check (length(recipient_name) <= 120),
  recipient_email  text check (length(recipient_email) <= 254),
  physical         boolean not null default false,
  sale_id          uuid references public.sales (id) on delete set null,
  note             text check (length(note) <= 300),
  imported         boolean not null default false,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, code),
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index gift_cards_client_idx on public.gift_cards (client_id) where client_id is not null;
create index gift_cards_business_created_idx on public.gift_cards (business_id, created_at desc);

create table public.gift_card_events (
  id             uuid primary key default gen_random_uuid(),
  card_id        uuid not null,
  business_id    uuid not null,
  kind           text not null check (kind in ('sold', 'issued', 'imported', 'redeemed', 'reloaded', 'refunded', 'adjusted', 'voided')),
  -- Signed: money onto the card is positive.
  amount_cents   integer not null,
  balance_after  integer not null check (balance_after >= 0),
  sale_id        uuid references public.sales (id) on delete set null,
  reason         text check (length(reason) <= 300),
  staff_id       uuid,
  created_at     timestamptz not null default now(),
  foreign key (card_id, business_id) references public.gift_cards (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete set null (staff_id)
);

create index gift_card_events_card_idx on public.gift_card_events (card_id, created_at);
create index gift_card_events_business_created_idx on public.gift_card_events (business_id, created_at);

-- Balance lookups: who, when, the code's last four, and whether it matched.
create table public.gift_card_lookups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  staff_id     uuid,
  code_hint    text,
  found        boolean not null,
  created_at   timestamptz not null default now()
);

create index gift_card_lookups_staff_idx on public.gift_card_lookups (staff_id, created_at desc);

alter table public.sale_items add column gift_card_id uuid references public.gift_cards (id) on delete set null;
alter table public.payments add column gift_card_id uuid references public.gift_cards (id) on delete set null;

alter table public.gift_cards enable row level security;
alter table public.gift_card_events enable row level security;
alter table public.gift_card_lookups enable row level security;

create policy "Front of house can view gift cards" on public.gift_cards for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can view gift card history" on public.gift_card_events for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Owners and managers can view gift card lookups" on public.gift_card_lookups for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

-- ---------------------------------------------------------------------------
-- Codes
-- ---------------------------------------------------------------------------

-- "k7qm 3xrp-9twd fh2c" -> "K7QM3XRP9TWDFH2C".
create function private.gift_code(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$ select upper(regexp_replace(coalesce(p_text, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- A new code: 16 characters from 31 that can't be mixed up read aloud or
-- written down (no 0/O, 1/I/L), about 79 bits: not guessable.
create function private.new_gift_code(p_business_id uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(16);
    v_code := '';
    for i in 0 .. 15 loop
      -- 248 is the largest multiple of 31 under 256: reject above it so
      -- every character is equally likely.
      while get_byte(v_bytes, i) >= 248 loop
        v_bytes := overlay(v_bytes placing extensions.gen_random_bytes(1) from i + 1 for 1);
      end loop;
      v_code := v_code || substr(v_alphabet, get_byte(v_bytes, i) % 31 + 1, 1);
    end loop;
    exit when not exists (select 1 from public.gift_cards where business_id = p_business_id and code = v_code);
  end loop;
  return v_code;
end;
$$;

-- A card that can be used now, locked for the change: active, not expired.
create function private.usable_card(p_business_id uuid, p_code text)
returns public.gift_cards
language plpgsql
set search_path = ''
as $$
declare
  v_card public.gift_cards;
begin
  select * into v_card from public.gift_cards where business_id = p_business_id and code = private.gift_code(p_code) for update;
  if v_card.id is null then
    raise exception 'No gift card has that code' using errcode = 'P0002';
  end if;
  if v_card.status = 'voided' then
    raise exception 'That gift card was voided' using errcode = '55000';
  end if;
  if v_card.expires_at is not null and v_card.expires_at <= now() then
    raise exception 'That gift card has expired' using errcode = '55000';
  end if;
  return v_card;
end;
$$;

-- A change to a card's balance, recorded.
create function private.move_gift_card(p_card public.gift_cards, p_kind text, p_amount integer, p_sale_id uuid, p_reason text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_after integer;
begin
  if (select balance_cents from public.gift_cards where id = p_card.id) + p_amount < 0 then
    raise exception 'Not enough on the gift card' using errcode = '22023';
  end if;
  update public.gift_cards set balance_cents = balance_cents + p_amount where id = p_card.id returning balance_cents into v_after;
  insert into public.gift_card_events (card_id, business_id, kind, amount_cents, balance_after, sale_id, reason, staff_id)
  values (p_card.id, p_card.business_id, p_kind, p_amount, v_after, p_sale_id, nullif(trim(p_reason), ''), private.current_staff_id(p_card.business_id));
  return v_after;
end;
$$;

revoke all on function private.gift_code(text) from public;
revoke all on function private.new_gift_code(uuid) from public;
revoke all on function private.usable_card(uuid, text) from public;
revoke all on function private.move_gift_card(public.gift_cards, text, integer, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Lookups (front of house): the balance and status for a code. At most 30
-- a staff member per 10 minutes; every lookup is logged.
-- ---------------------------------------------------------------------------

create function public.lookup_gift_card(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_me uuid;
  v_card public.gift_cards;
  v_code text := private.gift_code(p_code);
begin
  select s.business_id, s.id into v_business_id, v_me from public.staff s
  where s.user_id = auth.uid() and s.is_active and s.role in ('owner', 'manager', 'front_desk') limit 1;
  if v_business_id is null then
    raise exception 'Not allowed to look up gift cards' using errcode = '42501';
  end if;
  if (select count(*) from public.gift_card_lookups where staff_id = v_me and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Too many gift card lookups. Wait a few minutes.' using errcode = '54000';
  end if;
  select * into v_card from public.gift_cards where business_id = v_business_id and code = v_code;
  insert into public.gift_card_lookups (business_id, staff_id, code_hint, found)
  values (v_business_id, v_me, right(v_code, 4), v_card.id is not null);
  if v_card.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_card.id, 'code', v_card.code, 'kind', v_card.kind, 'status', v_card.status,
    'balance_cents', v_card.balance_cents, 'initial_cents', v_card.initial_cents, 'expires_at', v_card.expires_at,
    'expired', v_card.expires_at is not null and v_card.expires_at <= now());
end;
$$;

-- ---------------------------------------------------------------------------
-- Managers and owners: promotional cards, adjustments and voids.
-- ---------------------------------------------------------------------------

create function public.issue_promo_card(p_amount_cents integer, p_reason text, p_expires_in_days integer, p_client_id uuid, p_recipient_name text, p_recipient_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_card public.gift_cards;
begin
  select b.* into v_business from public.businesses b join public.staff s on s.business_id = b.id
  where s.user_id = auth.uid() and s.is_active and s.role in ('owner', 'manager') limit 1;
  if v_business.id is null then
    raise exception 'Only managers and owners can issue promotional cards' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents < 100 or p_amount_cents > 50000 then
    raise exception 'Enter an amount from $1 to $500' using errcode = '22023';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say what it''s for' using errcode = '22023';
  end if;
  if p_client_id is not null and not exists (select 1 from public.clients where id = p_client_id and business_id = v_business.id) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  insert into public.gift_cards (business_id, code, kind, initial_cents, balance_cents, expires_at, client_id, recipient_name, recipient_email, note, created_by)
  values (v_business.id, private.new_gift_code(v_business.id), 'promotional', p_amount_cents, 0,
          now() + make_interval(days => coalesce(p_expires_in_days, v_business.promo_card_expiry_days)),
          p_client_id, nullif(trim(p_recipient_name), ''), nullif(trim(p_recipient_email), ''), trim(p_reason), private.current_staff_id(v_business.id))
  returning * into v_card;
  perform private.move_gift_card(v_card, 'issued', p_amount_cents, null, trim(p_reason));
  return v_card.id;
end;
$$;

create function public.adjust_gift_card(p_card_id uuid, p_change_cents integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.gift_cards;
begin
  select * into v_card from public.gift_cards where id = p_card_id for update;
  if v_card.id is null or not private.has_business_role(v_card.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only managers and owners can adjust gift cards' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v_card.status = 'voided' then
    raise exception 'That gift card was voided' using errcode = '55000';
  end if;
  if coalesce(p_change_cents, 0) = 0 then
    raise exception 'Enter the change' using errcode = '22023';
  end if;
  return private.move_gift_card(v_card, 'adjusted', p_change_cents, null, p_reason);
end;
$$;

create function public.void_gift_card(p_card_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.gift_cards;
begin
  select * into v_card from public.gift_cards where id = p_card_id for update;
  if v_card.id is null or not private.has_business_role(v_card.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only managers and owners can void gift cards' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v_card.status = 'voided' then
    raise exception 'That gift card was already voided' using errcode = '55000';
  end if;
  perform private.move_gift_card(v_card, 'voided', -v_card.balance_cents, null, p_reason);
  update public.gift_cards set status = 'voided' where id = p_card_id;
end;
$$;

create function public.set_gift_card_settings(p_business_id uuid, p_presets integer[], p_expiry_months integer, p_promo_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can change gift card settings' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_presets) v where v < 500 or v > 100000) or coalesce(array_length(p_presets, 1), 0) > 8 then
    raise exception 'Presets are $5 to $1,000, up to eight' using errcode = '22023';
  end if;
  update public.businesses set
    gift_card_presets_cents = coalesce((select array_agg(distinct v order by v) from unnest(p_presets) v), '{}'),
    gift_card_expiry_months = p_expiry_months,
    promo_card_expiry_days = coalesce(p_promo_days, promo_card_expiry_days)
  where id = p_business_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_sale, as before, plus:
--   lines {kind: 'gift_card', amount_cents, code (physical cards: the
--          card's own code), recipient_name, recipient_email}
--         {kind: 'gift_card_reload', code, amount_cents}
--   payments {method: 'gift_card', amount_cents, code}
-- Gift card lines aren't taxed or discounted, and can't be paid for with a
-- gift card.
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

    insert into public.sale_items (
      sale_id, business_id, position, kind, service_id, appointment_item_id, product_id, staff_id, description,
      quantity, unit_price_cents, booked_price_cents, price_reason, discount_cents, tax_cents, total_cents, gift_card_id
    ) values (
      v_sale_id, v_business.id, i + 1, (v_rows -> i ->> 'kind')::public.sale_item_kind,
      (v_rows -> i ->> 'service_id')::uuid, (v_rows -> i ->> 'appointment_item_id')::uuid, (v_rows -> i ->> 'product_id')::uuid,
      (v_rows -> i ->> 'staff_id')::uuid, v_rows -> i ->> 'description', (v_rows -> i ->> 'quantity')::int, (v_rows -> i ->> 'unit')::int,
      (v_rows -> i ->> 'booked')::int, v_rows -> i ->> 'reason',
      (v_priced -> i ->> 'discount')::int, (v_priced -> i ->> 'tax')::int, (v_priced -> i ->> 'total')::int, v_card.id
    ) returning id into v_sale_item_id;
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
-- void_sale, as before, plus: gift card payments go back on their cards;
-- cards sold on the sale are voided (if they haven't been used), and
-- reloads come off again.
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
-- refund_sale, as before, plus refunds onto a gift card ({method:
-- 'gift_card', code}): the money goes back on the card. Promotional
-- credit is never given back as cash or card.
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
  -- Promotional credit has no cash value.
  select coalesce(sum(p.amount_cents), 0) into v_promo_paid from public.payments p join public.gift_cards g on g.id = p.gift_card_id
  where p.sale_id = p_sale_id and g.kind = 'promotional';
  if v_cash_like > 0 and v_sale.refunded_cents + v_cash_like > v_sale.total_cents - v_promo_paid then
    raise exception 'Promotional credit can''t be refunded as cash or card' using errcode = '22023';
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

-- Imported balances (Phorest vouchers), by the import with the service role.
-- The card keeps its code when it's usable (8 to 32 letters and digits, not
-- already taken); otherwise it gets a new one.
create function public.import_gift_card(p_business_id uuid, p_code text, p_initial_cents integer, p_balance_cents integer, p_issued_at timestamptz, p_expires_at timestamptz, p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.gift_cards;
  v_code text := private.gift_code(p_code);
begin
  if v_code !~ '^[A-Z0-9]{8,32}$' or exists (select 1 from public.gift_cards where business_id = p_business_id and code = v_code) then
    v_code := private.new_gift_code(p_business_id);
  end if;
  insert into public.gift_cards (business_id, code, kind, initial_cents, balance_cents, expires_at, client_id, imported, created_at)
  values (p_business_id, v_code, 'purchased', greatest(p_initial_cents, p_balance_cents), 0, p_expires_at, p_client_id, true, coalesce(p_issued_at, now()))
  returning * into v_card;
  if p_balance_cents > 0 then
    perform private.move_gift_card(v_card, 'imported', p_balance_cents, null, 'Balance carried over from Phorest');
  end if;
  return v_card.id;
end;
$$;

revoke all on function public.lookup_gift_card(text) from public, anon;
revoke all on function public.issue_promo_card(integer, text, integer, uuid, text, text) from public, anon;
revoke all on function public.adjust_gift_card(uuid, integer, text) from public, anon;
revoke all on function public.void_gift_card(uuid, text) from public, anon;
revoke all on function public.set_gift_card_settings(uuid, integer[], integer, integer) from public, anon;
revoke all on function public.import_gift_card(uuid, text, integer, integer, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.lookup_gift_card(text) to authenticated;
grant execute on function public.issue_promo_card(integer, text, integer, uuid, text, text) to authenticated;
grant execute on function public.adjust_gift_card(uuid, integer, text) to authenticated;
grant execute on function public.void_gift_card(uuid, text) to authenticated;
grant execute on function public.set_gift_card_settings(uuid, integer[], integer, integer) to authenticated;
grant execute on function public.import_gift_card(uuid, text, integer, integer, timestamptz, timestamptz, uuid) to service_role;
