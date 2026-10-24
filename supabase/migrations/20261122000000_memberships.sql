-- Memberships: owners create plans ("Blowout Club: $89/month, 2 blowouts
-- plus 10% off retail"), sold at checkout, with member benefits applied
-- there automatically, and recurring billing through a payment provider
-- (lib/payments: a test provider for now, Stripe later): renewals, failed
-- payments with retries and a notice to staff, pause and cancel.
--
-- Terms (price, interval, discounts, minimum term, notice, pausing) are
-- copied onto each membership when it's sold, so changing a plan only
-- affects new members. Included services are granted from the plan at the
-- start of each period.

alter type public.sale_item_kind add value 'membership';
alter type public.payment_method add value 'membership';

create table public.membership_plans (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses (id) on delete cascade,
  name                  text not null check (length(trim(name)) between 1 and 80),
  description           text check (length(description) <= 300),
  price_cents           integer not null check (price_cents between 100 and 100000),
  -- Billed every interval_count weeks or months (12 months: yearly).
  interval_unit         text not null default 'month' check (interval_unit in ('week', 'month')),
  interval_count        smallint not null default 1 check (interval_count between 1 and 12),
  -- Member prices: whole percents off services and retail.
  service_discount_pct  smallint not null default 0 check (service_discount_pct between 0 and 100),
  retail_discount_pct   smallint not null default 0 check (retail_discount_pct between 0 and 100),
  -- Cancellation: not before this many periods, with this much notice
  -- (always at the end of a period).
  min_term_periods      smallint not null default 0 check (min_term_periods between 0 and 24),
  cancel_notice_days    smallint not null default 0 check (cancel_notice_days between 0 and 90),
  allow_pause           boolean not null default true,
  max_pause_periods     smallint not null default 2 check (max_pause_periods between 1 and 6),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (business_id, name)
);

create trigger membership_plans_set_updated_at before update on public.membership_plans
  for each row execute function public.set_updated_at();

-- Services included each period, and whether unused ones roll over (one
-- period's worth at most).
create table public.membership_plan_services (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.membership_plans (id) on delete cascade,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  service_id   uuid not null references public.services (id) on delete cascade,
  quantity     smallint not null check (quantity between 1 and 20),
  rollover     boolean not null default false,
  unique (plan_id, service_id)
);

create type public.membership_status as enum ('active', 'past_due', 'paused', 'canceled');

create table public.client_memberships (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses (id) on delete cascade,
  location_id           uuid not null references public.locations (id) on delete cascade,
  client_id             uuid not null references public.clients (id) on delete cascade,
  plan_id               uuid references public.membership_plans (id) on delete set null,
  name                  text not null,
  status                public.membership_status not null default 'active',
  -- Terms as sold.
  price_cents           integer not null check (price_cents >= 0),
  interval_unit         text not null check (interval_unit in ('week', 'month')),
  interval_count        smallint not null,
  service_discount_pct  smallint not null default 0,
  retail_discount_pct   smallint not null default 0,
  min_term_periods      smallint not null default 0,
  cancel_notice_days    smallint not null default 0,
  allow_pause           boolean not null default true,
  max_pause_periods     smallint not null default 2,
  -- Periods run from the anchor: the nth ends anchor + n intervals (so a
  -- membership started on the 31st doesn't drift). Resuming after a pause
  -- starts a new anchor.
  started_on            date not null,
  anchor_on             date not null,
  periods_paid          integer not null default 1,
  current_period_start  date not null,
  -- The next renewal (the day this period ends).
  current_period_end    date not null,
  -- The card renewals are charged to, at the provider (a token, never a
  -- card number) and how it's shown ("Visa …4242").
  provider              text not null default 'test' check (provider ~ '^[a-z_]{1,20}$'),
  payment_method_ref    text not null check (length(payment_method_ref) between 1 and 200),
  card_label            text check (length(card_label) <= 60),
  failed_attempts       smallint not null default 0,
  next_retry_at         timestamptz,
  pause_from            date,
  resume_on             date,
  cancels_on            date,
  cancel_reason         text check (length(cancel_reason) <= 300),
  canceled_at           timestamptz,
  sale_id               uuid references public.sales (id) on delete set null,
  created_by            uuid references public.staff (id) on delete set null,
  created_at            timestamptz not null default now()
);

create index client_memberships_client_idx on public.client_memberships (client_id);
create index client_memberships_business_status_idx on public.client_memberships (business_id, status);
-- One live membership of a plan per client.
create unique index client_memberships_one_live_idx on public.client_memberships (client_id, plan_id) where status <> 'canceled';

-- What's included this period (and before): allowance is the plan's
-- quantity plus anything rolled over.
create table public.membership_credits (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  membership_id  uuid not null references public.client_memberships (id) on delete cascade,
  service_id     uuid not null references public.services (id) on delete cascade,
  period_start   date not null,
  allowance      smallint not null check (allowance >= 0),
  used           smallint not null default 0 check (used >= 0 and used <= allowance),
  unique (membership_id, service_id, period_start)
);

create table public.membership_charges (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  membership_id       uuid not null references public.client_memberships (id) on delete cascade,
  period_start        date not null,
  amount_cents        integer not null,
  status              text not null check (status in ('succeeded', 'failed')),
  attempt             smallint not null default 1,
  -- 'checkout' for the first payment, taken at the desk.
  provider            text not null,
  provider_reference  text check (length(provider_reference) <= 200),
  failure_reason      text check (length(failure_reason) <= 300),
  sale_id             uuid references public.sales (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index membership_charges_membership_idx on public.membership_charges (membership_id, created_at desc);
create index membership_charges_business_idx on public.membership_charges (business_id, created_at);

create table public.membership_events (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  membership_id  uuid not null references public.client_memberships (id) on delete cascade,
  kind           text not null check (kind in ('started', 'renewed', 'payment_failed', 'paused', 'pause_scheduled', 'resumed', 'cancel_requested', 'kept', 'canceled', 'card_updated', 'credit_used', 'credit_returned', 'renewal_voided')),
  detail         text check (length(detail) <= 500),
  service_id     uuid references public.services (id) on delete set null,
  sale_id        uuid references public.sales (id) on delete set null,
  staff_id       uuid references public.staff (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index membership_events_membership_idx on public.membership_events (membership_id, created_at desc);

alter table public.sale_items
  add column membership_id uuid references public.client_memberships (id) on delete set null,
  add column membership_credit_id uuid references public.membership_credits (id) on delete set null,
  -- The member price's share of line_discount_cents (never counted
  -- against staff discount limits).
  add column member_discount_cents integer not null default 0 check (member_discount_cents >= 0);

alter table public.membership_plans enable row level security;
alter table public.membership_plan_services enable row level security;
alter table public.client_memberships enable row level security;
alter table public.membership_credits enable row level security;
alter table public.membership_charges enable row level security;
alter table public.membership_events enable row level security;

-- Everyone at the salon sees plans, who's a member and what's left; the
-- money side (charges) is for the front of house. All writes go through
-- the functions below.
create policy "Members can view membership plans" on public.membership_plans for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Members can view plan services" on public.membership_plan_services for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Members can view client memberships" on public.client_memberships for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Members can view membership credits" on public.membership_credits for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Members can view membership events" on public.membership_events for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Front of house can view membership charges" on public.membership_charges for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- ---------------------------------------------------------------------------
-- Periods and credits
-- ---------------------------------------------------------------------------

-- A date n intervals on (months clamp to the month's end, as Postgres does:
-- Jan 31 + 1 month = Feb 28). Mirrored by addInterval in lib/memberships.ts.
create function private.add_interval(p_date date, p_unit text, p_count integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when p_unit = 'week' then p_date + 7 * p_count else (p_date + make_interval(months => p_count))::date end
$$;

-- The current period's included services: the plan's quantity, plus what
-- was left last period where it rolls over (up to one period's worth).
create function private.grant_membership_credits(p_membership_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_m public.client_memberships;
begin
  select * into v_m from public.client_memberships where id = p_membership_id;
  insert into public.membership_credits (business_id, membership_id, service_id, period_start, allowance)
  select v_m.business_id, v_m.id, ps.service_id, v_m.current_period_start,
         ps.quantity + case when ps.rollover then least(ps.quantity, coalesce((
           select c.allowance - c.used from public.membership_credits c
           where c.membership_id = v_m.id and c.service_id = ps.service_id and c.period_start < v_m.current_period_start
           order by c.period_start desc limit 1
         ), 0)) else 0 end
  from public.membership_plan_services ps
  where ps.plan_id = v_m.plan_id
  on conflict (membership_id, service_id, period_start) do nothing;
end;
$$;

-- A new membership, sold on a sale (its first period paid there).
create function private.start_membership(p_plan_id uuid, p_client_id uuid, p_sale_id uuid, p_location_id uuid, p_provider text, p_ref text, p_label text, p_paid_cents integer, p_today date)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_plan public.membership_plans;
  v_id uuid;
  v_me uuid;
begin
  select * into v_plan from public.membership_plans where id = p_plan_id;
  v_me := private.current_staff_id(v_plan.business_id);
  insert into public.client_memberships (
    business_id, location_id, client_id, plan_id, name, price_cents, interval_unit, interval_count, service_discount_pct, retail_discount_pct,
    min_term_periods, cancel_notice_days, allow_pause, max_pause_periods, started_on, anchor_on, periods_paid, current_period_start, current_period_end,
    provider, payment_method_ref, card_label, sale_id, created_by
  ) values (
    v_plan.business_id, p_location_id, p_client_id, v_plan.id, v_plan.name, v_plan.price_cents, v_plan.interval_unit, v_plan.interval_count,
    v_plan.service_discount_pct, v_plan.retail_discount_pct, v_plan.min_term_periods, v_plan.cancel_notice_days, v_plan.allow_pause, v_plan.max_pause_periods,
    p_today, p_today, 1, p_today, private.add_interval(p_today, v_plan.interval_unit, v_plan.interval_count),
    p_provider, p_ref, p_label, p_sale_id, v_me
  ) returning id into v_id;
  perform private.grant_membership_credits(v_id);
  insert into public.membership_charges (business_id, membership_id, period_start, amount_cents, status, provider, sale_id)
  values (v_plan.business_id, v_id, p_today, p_paid_cents, 'succeeded', 'checkout', p_sale_id);
  insert into public.membership_events (business_id, membership_id, kind, sale_id, staff_id)
  values (v_plan.business_id, v_id, 'started', p_sale_id, v_me);
  return v_id;
end;
$$;

create function private.use_membership_credit(p_credit_id uuid, p_sale_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_c public.membership_credits;
begin
  update public.membership_credits set used = used + 1 where id = p_credit_id returning * into v_c;
  insert into public.membership_events (business_id, membership_id, kind, service_id, sale_id, staff_id)
  values (v_c.business_id, v_c.membership_id, 'credit_used', v_c.service_id, p_sale_id, private.current_staff_id(v_c.business_id));
end;
$$;

revoke all on function private.add_interval(date, text, integer) from public;
revoke all on function private.grant_membership_credits(uuid) from public;
revoke all on function private.start_membership(uuid, uuid, uuid, uuid, text, text, text, integer, date) from public;
revoke all on function private.use_membership_credit(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- complete_sale, as before, plus memberships: selling one (a 'membership'
-- line: the plan, and the card it renews on at the provider), a service
-- paid for with what a membership includes this period (membership_credit_id:
-- not taxed or discounted again, a 'membership' payment covers it), and
-- member prices taken off services and retail automatically (never counted
-- against staff discount limits).
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
  v_staff_id uuid;
  v_qty integer;
  v_gross integer;
  v_line_discount integer;
  v_line_discounts integer := 0;
  v_discount_gross integer := 0;
  v_on_hand numeric;
  v_draft public.sale_drafts;
  v_rebook uuid;
  v_plan public.membership_plans;
  v_credit public.membership_credits;
  v_member integer;
  v_member_discounts integer := 0;
  v_service_pct integer := 0;
  v_retail_pct integer := 0;
  v_membership_id uuid;
  v_today date;
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
  -- Their memberships' member prices apply automatically (the best of
  -- any they hold), and what they include this period can pay for a line.
  v_today := (now() at time zone (select timezone from public.locations where id = p_location_id))::date;
  if v_client_id is not null then
    select coalesce(max(service_discount_pct), 0), coalesce(max(retail_discount_pct), 0) into v_service_pct, v_retail_pct
    from public.client_memberships where client_id = v_client_id and business_id = v_business.id and status = 'active';
  end if;
  -- The checkout's draft ticket, if it came from one.
  if nullif(p_input ->> 'draft_id', '') is not null then
    select * into v_draft from public.sale_drafts where id = (p_input ->> 'draft_id')::uuid and business_id = v_business.id for update;
    if v_draft.id is null or v_draft.status <> 'open' then
      raise exception 'This checkout was already completed' using errcode = '55000';
    end if;
  end if;
  -- The visit booked before they left.
  if nullif(p_input ->> 'rebook_appointment_id', '') is not null then
    select id into v_rebook from public.appointments
    where id = (p_input ->> 'rebook_appointment_id')::uuid and business_id = v_business.id and client_id is not distinct from v_client_id and status not in ('canceled');
    if v_rebook is null then
      raise exception 'That rebooked visit isn''t this client''s' using errcode = '22023';
    end if;
  end if;

  -- Lines, priced from our tables.
  for v_line in select * from jsonb_array_elements(coalesce(p_input -> 'lines', '[]')) loop
    if v_line ->> 'kind' = 'service' then
      if nullif(v_line ->> 'appointment_item_id', '') is not null then
        select i.id, i.service_id, i.staff_id, i.price_cents, s.name into v_item
        from public.appointment_items i join public.services s on s.id = i.service_id
        where i.id = (v_line ->> 'appointment_item_id')::uuid and i.appointment_id = v_appointment.id;
        if v_item.id is null or v_item.id = any (v_seen) then
          raise exception 'That service isn''t on this visit' using errcode = '22023';
        end if;
        v_seen := v_seen || v_item.id;
        v_qty := 1;
      else
        -- A service added at checkout (not booked), at the stylist's price.
        select null::uuid as id, s.id as service_id, st.id as staff_id, private.stylist_price(st.id, s.id) as price_cents, s.name into v_item
        from public.services s join public.staff st on st.id = (v_line ->> 'staff_id')::uuid and st.business_id = v_business.id and st.is_active
        where s.id = (v_line ->> 'service_id')::uuid and s.business_id = v_business.id and s.archived_at is null;
        if v_item.service_id is null then
          raise exception 'Choose a service and who did it' using errcode = '22023';
        end if;
        v_qty := coalesce((v_line ->> 'quantity')::int, 1);
        if v_qty not between 1 and 20 then
          raise exception 'Enter how many' using errcode = '22023';
        end if;
      end if;
      -- Who gets the credit: the booked stylist, unless changed.
      v_staff_id := coalesce(nullif(v_line ->> 'staff_id', '')::uuid, v_item.staff_id);
      if not exists (select 1 from public.staff where id = v_staff_id and business_id = v_business.id) then
        raise exception 'Unknown stylist' using errcode = '22023';
      end if;
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
        if v_qty <> 1 then
          raise exception 'A package covers one at a time' using errcode = '22023';
        end if;
        select level into v_level from public.staff where id = v_staff_id;
        if v_pitem.levels is not null and (v_level is null or not (v_level = any (v_pitem.levels))) then
          raise exception 'That package doesn''t cover this stylist''s level' using errcode = '22023';
        end if;
        v_covered := v_covered + v_price;
      end if;
      -- Or with a service their membership includes this period.
      v_credit := null;
      if nullif(v_line ->> 'membership_credit_id', '') is not null then
        if v_pitem.id is not null then
          raise exception 'Use a package or the membership, not both' using errcode = '22023';
        end if;
        select c.* into v_credit from public.membership_credits c join public.client_memberships m on m.id = c.membership_id
        where c.id = (v_line ->> 'membership_credit_id')::uuid and c.service_id = v_item.service_id and m.client_id = v_client_id
          and m.business_id = v_business.id and m.status = 'active' and c.period_start = m.current_period_start
        for update of c;
        if v_credit.id is null then
          raise exception 'Their membership doesn''t include this service right now' using errcode = '22023';
        end if;
        if v_credit.used + (select count(*) from jsonb_array_elements(v_rows) r where r ->> 'membership_credit_id' = v_credit.id::text) >= v_credit.allowance then
          raise exception 'No % left on their membership this period', v_item.name using errcode = '22023';
        end if;
        if v_qty <> 1 then
          raise exception 'A membership covers one at a time' using errcode = '22023';
        end if;
        v_covered := v_covered + v_price;
      end if;
      v_gross := v_price * v_qty;
      -- The member price first, then any discount staff give on the rest.
      v_member := case when v_pitem.id is null and v_credit.id is null then round(v_gross::numeric * v_service_pct / 100)::int else 0 end;
      v_line_discount := case when v_pitem.id is null and v_credit.id is null then private.line_discount(v_line -> 'discount', v_gross - v_member) else 0 end;
      v_line_discounts := v_line_discounts + v_line_discount;
      v_member_discounts := v_member_discounts + v_member;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'service', 'service_id', v_item.service_id, 'appointment_item_id', v_item.id, 'staff_id', v_staff_id,
        'description', v_item.name, 'quantity', v_qty, 'unit', v_price,
        'booked', case when v_price <> v_item.price_cents then v_item.price_cents end,
        'reason', case when v_price <> v_item.price_cents then trim(v_line ->> 'price_reason') end,
        'package_item_id', v_pitem.id, 'package_name', v_pitem.name, 'membership_credit_id', v_credit.id, 'member_discount', v_member,
        'line_discount', v_line_discount + v_member,
        'line_discount_reason', nullif(concat_ws('; ', case when v_member > 0 then 'Member price' end, case when v_line_discount > 0 then trim(v_line -> 'discount' ->> 'reason') end), ''));
      v_lines := v_lines || jsonb_build_object('gross', v_gross, 'line_discount', v_line_discount + v_member,
        'taxable_bp', case when v_pitem.id is null and v_credit.id is null then v_business.tax_rate_services_bp else 0 end,
        'discountable', v_pitem.id is null and v_credit.id is null);
    elsif v_line ->> 'kind' = 'product' then
      select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid and business_id = v_business.id;
      if v_product.id is null or v_product.type <> 'retail' or not v_product.is_active then
        raise exception 'That product can''t be sold' using errcode = '22023';
      end if;
      v_qty := coalesce((v_line ->> 'quantity')::int, 0);
      if v_qty not between 1 and 100 then
        raise exception 'Enter how many' using errcode = '22023';
      end if;
      -- Out of stock: a manager's OK (or a manager selling it).
      select on_hand into v_on_hand from public.stock_levels where location_id = p_location_id and product_id = v_product.id;
      if coalesce(v_on_hand, 0) - coalesce((select sum((r ->> 'quantity')::int) from jsonb_array_elements(v_rows) r where r ->> 'product_id' = v_product.id::text), 0) < v_qty
         and not private.has_business_role(v_business.id, array['owner', 'manager']::public.staff_role[])
         and not exists (select 1 from public.stock_overrides o where o.draft_id = v_draft.id and o.product_id = v_product.id) then
        raise exception 'Only % left of %. A manager needs to OK selling it.', greatest(coalesce(v_on_hand, 0), 0)::int, concat_ws(' ', v_product.brand, v_product.line, v_product.name) using errcode = '42501';
      end if;
      -- Who gets the credit for the sale (a stylist), if anyone.
      v_staff_id := nullif(v_line ->> 'staff_id', '')::uuid;
      if v_staff_id is not null and not exists (select 1 from public.staff where id = v_staff_id and business_id = v_business.id) then
        raise exception 'Unknown stylist' using errcode = '22023';
      end if;
      v_gross := v_product.price_cents * v_qty;
      v_member := round(v_gross::numeric * v_retail_pct / 100)::int;
      v_line_discount := private.line_discount(v_line -> 'discount', v_gross - v_member);
      v_line_discounts := v_line_discounts + v_line_discount;
      v_member_discounts := v_member_discounts + v_member;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'product', 'product_id', v_product.id, 'staff_id', v_staff_id,
        'description', concat_ws(' ', v_product.brand, v_product.line, v_product.name), 'quantity', v_qty, 'unit', v_product.price_cents,
        'member_discount', v_member, 'line_discount', v_line_discount + v_member,
        'line_discount_reason', nullif(concat_ws('; ', case when v_member > 0 then 'Member price' end, case when v_line_discount > 0 then trim(v_line -> 'discount' ->> 'reason') end), ''));
      v_lines := v_lines || jsonb_build_object('gross', v_gross, 'line_discount', v_line_discount + v_member, 'taxable_bp', v_business.tax_rate_retail_bp, 'discountable', true);
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
    elsif v_line ->> 'kind' = 'membership' then
      select * into v_plan from public.membership_plans where id = (v_line ->> 'plan_id')::uuid and business_id = v_business.id and is_active;
      if v_plan.id is null then
        raise exception 'That membership isn''t for sale' using errcode = '22023';
      end if;
      if v_client_id is null then
        raise exception 'Choose the client the membership is for' using errcode = '22023';
      end if;
      if exists (select 1 from public.client_memberships where client_id = v_client_id and plan_id = v_plan.id and status <> 'canceled')
         or (select count(*) from jsonb_array_elements(v_rows) r where r ->> 'plan_id' = v_plan.id::text) > 0 then
        raise exception 'They''re already a member of %', v_plan.name using errcode = '22023';
      end if;
      if nullif(trim(v_line ->> 'payment_method_ref'), '') is null then
        raise exception 'Add the card the membership renews on' using errcode = '22023';
      end if;
      v_rows := v_rows || jsonb_build_object('kind', 'membership', 'description', v_plan.name, 'quantity', 1, 'unit', v_plan.price_cents, 'plan_id', v_plan.id,
        'provider', coalesce(nullif(v_line ->> 'provider', ''), 'test'), 'payment_method_ref', trim(v_line ->> 'payment_method_ref'), 'card_label', nullif(trim(v_line ->> 'card_label'), ''));
      v_lines := v_lines || jsonb_build_object('gross', v_plan.price_cents, 'taxable_bp', v_business.tax_rate_services_bp, 'discountable', false);
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
    if (v_line ->> 'discountable')::boolean then
      v_discount_gross := v_discount_gross + (v_line ->> 'gross')::int;
      v_discountable := v_discountable + (v_line ->> 'gross')::int - coalesce((v_line ->> 'line_discount')::int, 0);
    end if;
  end loop;

  -- A discount on the whole sale (on what's left after line discounts).
  if p_input -> 'discount' is not null and jsonb_typeof(p_input -> 'discount') = 'object' and coalesce((p_input -> 'discount' ->> 'value')::int, 0) > 0 then
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
  end if;
  -- Discounts (on lines or the sale): by who may give them, and how much.
  if v_discount + v_line_discounts > 0 then
    if not private.has_business_role(v_business.id, v_business.discount_roles) then
      raise exception 'You can''t give discounts' using errcode = '42501';
    end if;
    if not private.has_business_role(v_business.id, array['owner', 'manager']::public.staff_role[])
       and (v_discount + v_line_discounts) * 100 > v_discount_gross * v_business.discount_max_percent then
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

  v_total := v_subtotal - v_discount - v_line_discounts - v_member_discounts + v_tax + v_tips;

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
    tax_cents, tip_cents, total_cents, note, receipt_email, created_by, rebook_appointment_id, draft_id
  ) values (
    v_business.id, p_location_id, v_number, v_client_id, v_appointment.id, v_subtotal, v_discount + v_line_discounts + v_member_discounts, v_discount_reason,
    v_tax, v_tips, v_total, nullif(trim(p_input ->> 'note'), ''), nullif(trim(p_input ->> 'receipt_email'), ''), v_me, v_rebook, v_draft.id
  ) returning id into v_sale_id;
  if v_draft.id is not null then
    update public.sale_drafts set status = 'completed', sale_id = v_sale_id where id = v_draft.id;
  end if;

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
    v_membership_id := null;
    if v_rows -> i ->> 'kind' = 'membership' then
      v_membership_id := private.start_membership((v_rows -> i ->> 'plan_id')::uuid, v_client_id, v_sale_id, p_location_id, v_rows -> i ->> 'provider',
        v_rows -> i ->> 'payment_method_ref', v_rows -> i ->> 'card_label', (v_priced -> i ->> 'total')::int, v_today);
    end if;
    v_package_id := null;
    if v_rows -> i ->> 'kind' = 'package' then
      v_package_id := private.sell_package((v_rows -> i ->> 'template_id')::uuid, v_client_id, v_sale_id, (v_priced -> i ->> 'total')::int - (v_priced -> i ->> 'tax')::int);
    end if;

    insert into public.sale_items (
      sale_id, business_id, position, kind, service_id, appointment_item_id, product_id, staff_id, description,
      quantity, unit_price_cents, booked_price_cents, price_reason, discount_cents, tax_cents, total_cents, gift_card_id,
      client_package_id, package_item_id, line_discount_cents, line_discount_reason, membership_id, membership_credit_id, member_discount_cents
    ) values (
      v_sale_id, v_business.id, i + 1, (v_rows -> i ->> 'kind')::public.sale_item_kind,
      (v_rows -> i ->> 'service_id')::uuid, (v_rows -> i ->> 'appointment_item_id')::uuid, (v_rows -> i ->> 'product_id')::uuid,
      (v_rows -> i ->> 'staff_id')::uuid, v_rows -> i ->> 'description', (v_rows -> i ->> 'quantity')::int, (v_rows -> i ->> 'unit')::int,
      (v_rows -> i ->> 'booked')::int, v_rows -> i ->> 'reason',
      (v_priced -> i ->> 'discount')::int, (v_priced -> i ->> 'tax')::int, (v_priced -> i ->> 'total')::int, v_card.id,
      v_package_id, (v_rows -> i ->> 'package_item_id')::uuid,
      coalesce((v_rows -> i ->> 'line_discount')::int, 0), v_rows -> i ->> 'line_discount_reason',
      v_membership_id, (v_rows -> i ->> 'membership_credit_id')::uuid, coalesce((v_rows -> i ->> 'member_discount')::int, 0)
    ) returning id into v_sale_item_id;
    if v_rows -> i ->> 'membership_credit_id' is not null then
      perform private.use_membership_credit((v_rows -> i ->> 'membership_credit_id')::uuid, v_sale_id);
      insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, created_by)
      values (v_sale_id, v_business.id, p_location_id, 'membership', (v_priced -> i ->> 'total')::int,
              left((select m.name from public.membership_credits c join public.client_memberships m on m.id = c.membership_id where c.id = (v_rows -> i ->> 'membership_credit_id')::uuid), 40), v_me);
    end if;
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
-- refund_sale, as before: membership services, like package uses, can't
-- come back as cash or card.
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
  where p.sale_id = p_sale_id and p.amount_cents > 0 and (g.kind = 'promotional' or p.method::text in ('package', 'membership'));
  if v_cash_like > 0 and v_sale.refunded_cents + v_cash_like > v_sale.total_cents - v_promo_paid then
    raise exception 'Promotional credit, package uses and membership services can''t be refunded as cash or card' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- Voiding a sale: membership services go back on the membership; a
-- membership sold on it is canceled (unless it's been used or renewed); a
-- renewal voided leaves the membership past due, to be paid again.
-- ---------------------------------------------------------------------------

create function private.on_sale_voided()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item public.sale_items;
  v_c public.membership_credits;
  v_m public.client_memberships;
begin
  for v_item in select * from public.sale_items where sale_id = new.id and membership_credit_id is not null loop
    update public.membership_credits set used = greatest(used - 1, 0) where id = v_item.membership_credit_id returning * into v_c;
    insert into public.membership_events (business_id, membership_id, kind, service_id, sale_id, detail, staff_id)
    values (v_c.business_id, v_c.membership_id, 'credit_returned', v_c.service_id, new.id, 'Void: ' || new.void_reason, new.voided_by);
  end loop;
  for v_item in select * from public.sale_items where sale_id = new.id and kind::text = 'membership' and membership_id is not null loop
    select * into v_m from public.client_memberships where id = v_item.membership_id for update;
    if v_m.sale_id = new.id then
      if exists (select 1 from public.membership_credits where membership_id = v_m.id and used > 0)
         or exists (select 1 from public.membership_charges where membership_id = v_m.id and status = 'succeeded' and sale_id is distinct from new.id) then
        raise exception 'The membership from this sale has been used or renewed, so it can''t be voided. Cancel the membership instead.' using errcode = '55000';
      end if;
      update public.client_memberships set status = 'canceled', canceled_at = now(), cancel_reason = 'Void: ' || new.void_reason where id = v_m.id;
      insert into public.membership_events (business_id, membership_id, kind, sale_id, detail, staff_id)
      values (v_m.business_id, v_m.id, 'canceled', new.id, 'Void: ' || new.void_reason, new.voided_by);
    elsif v_m.status in ('active', 'past_due') then
      update public.client_memberships set status = 'past_due', next_retry_at = now() where id = v_m.id;
      insert into public.membership_events (business_id, membership_id, kind, sale_id, detail, staff_id)
      values (v_m.business_id, v_m.id, 'renewal_voided', new.id, 'Void: ' || new.void_reason, new.voided_by);
    end if;
  end loop;
  return new;
end;
$$;

create trigger sales_membership_void after update of status on public.sales
  for each row when (old.status is distinct from 'voided' and new.status = 'voided')
  execute function private.on_sale_voided();

-- ---------------------------------------------------------------------------
-- Billing (lib/memberships/billing.ts, with the service role): first the
-- day's changes (a pause or cancellation that starts, a pause that ends),
-- then, when a payment is due, the provider's answer is recorded.
-- ---------------------------------------------------------------------------

create function public.advance_membership(p_membership_id uuid, p_today date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.client_memberships;
begin
  select * into v_m from public.client_memberships where id = p_membership_id for update;
  if v_m.id is null then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;
  if v_m.status = 'active' and v_m.cancels_on is not null and v_m.cancels_on <= p_today then
    update public.client_memberships set status = 'canceled', canceled_at = now() where id = v_m.id returning * into v_m;
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_m.business_id, v_m.id, 'canceled', coalesce(v_m.cancel_reason, 'As asked'));
  elsif v_m.status = 'active' and v_m.pause_from is not null and v_m.pause_from <= p_today then
    update public.client_memberships set status = 'paused' where id = v_m.id returning * into v_m;
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_m.business_id, v_m.id, 'paused', 'Until ' || v_m.resume_on);
  elsif v_m.status = 'paused' and v_m.resume_on is not null and v_m.resume_on <= p_today then
    -- Back from a pause: a new period starts today, paid now.
    update public.client_memberships set status = 'active', anchor_on = p_today, periods_paid = 0, current_period_start = p_today, current_period_end = p_today,
      pause_from = null, resume_on = null
    where id = v_m.id returning * into v_m;
    insert into public.membership_events (business_id, membership_id, kind) values (v_m.business_id, v_m.id, 'resumed');
  end if;
  return jsonb_build_object(
    'status', v_m.status,
    'due', (v_m.status = 'active' and v_m.current_period_end <= p_today) or (v_m.status = 'past_due' and coalesce(v_m.next_retry_at <= now(), true)),
    'amount_cents', v_m.price_cents + round(v_m.price_cents::numeric * (select b.tax_rate_services_bp from public.businesses b where b.id = v_m.business_id) / 10000)::int,
    'attempt', v_m.failed_attempts + 1
  );
end;
$$;

-- Retries: a day, then three, then four more after a failed payment; the
-- fourth failure cancels the membership. Mirrored by RETRY_DAYS in
-- lib/memberships.ts.
create function public.record_membership_charge(p_membership_id uuid, p_today date, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.client_memberships;
  v_b public.businesses;
  v_client public.clients;
  v_retry integer[] := '{1, 3, 4}';
  v_attempt integer;
  v_priced jsonb;
  v_tax integer;
  v_total integer;
  v_number integer;
  v_sale_id uuid;
  v_ok boolean := coalesce((p_result ->> 'ok')::boolean, false);
  v_reason text := left(coalesce(nullif(trim(p_result ->> 'reason'), ''), 'The payment didn''t go through'), 300);
  v_staff record;
begin
  select * into v_m from public.client_memberships where id = p_membership_id for update;
  if v_m.id is null then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;
  -- Only once per due payment, however many times the job runs.
  if not ((v_m.status = 'active' and v_m.current_period_end <= p_today) or (v_m.status = 'past_due' and coalesce(v_m.next_retry_at <= now(), true))) then
    raise exception 'No payment is due on this membership' using errcode = '55000';
  end if;
  select * into v_b from public.businesses where id = v_m.business_id;
  select * into v_client from public.clients where id = v_m.client_id;
  v_attempt := v_m.failed_attempts + 1;

  if v_ok then
    v_priced := private.price_sale(jsonb_build_array(jsonb_build_object('gross', v_m.price_cents, 'taxable_bp', v_b.tax_rate_services_bp, 'discountable', false)), 0);
    v_tax := (v_priced -> 0 ->> 'tax')::int;
    v_total := (v_priced -> 0 ->> 'total')::int;
    update public.businesses set next_sale_number = next_sale_number + 1 where id = v_b.id returning next_sale_number - 1 into v_number;
    insert into public.sales (business_id, location_id, number, client_id, subtotal_cents, tax_cents, total_cents, note)
    values (v_b.id, v_m.location_id, v_number, v_m.client_id, v_m.price_cents, v_tax, v_total, v_m.name || ' renewal')
    returning id into v_sale_id;
    insert into public.sale_items (sale_id, business_id, position, kind, description, quantity, unit_price_cents, tax_cents, total_cents, membership_id)
    values (v_sale_id, v_b.id, 1, 'membership', v_m.name || ' renewal', 1, v_m.price_cents, v_tax, v_total, v_m.id);
    insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, processor, processor_reference)
    values (v_sale_id, v_b.id, v_m.location_id, 'card', v_total, left(coalesce(v_m.card_label, 'Card on file'), 40), v_m.provider, left(p_result ->> 'reference', 200));
    insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail) values (v_sale_id, v_b.id, 'completed', v_total, 'Membership renewal');
    insert into public.membership_charges (business_id, membership_id, period_start, amount_cents, status, attempt, provider, provider_reference, sale_id)
    values (v_b.id, v_m.id, v_m.current_period_end, v_total, 'succeeded', v_attempt, v_m.provider, left(p_result ->> 'reference', 200), v_sale_id);
    update public.client_memberships set
      status = 'active', failed_attempts = 0, next_retry_at = null,
      periods_paid = periods_paid + 1,
      current_period_start = current_period_end,
      current_period_end = private.add_interval(anchor_on, interval_unit, interval_count * (periods_paid + 1))
    where id = v_m.id;
    perform private.grant_membership_credits(v_m.id);
    insert into public.membership_events (business_id, membership_id, kind, sale_id) values (v_b.id, v_m.id, 'renewed', v_sale_id);
    return jsonb_build_object('status', 'active', 'sale_id', v_sale_id);
  end if;

  insert into public.membership_charges (business_id, membership_id, period_start, amount_cents, status, attempt, provider, failure_reason)
  values (v_b.id, v_m.id, v_m.current_period_end, v_m.price_cents, 'failed', v_attempt, v_m.provider, v_reason);
  if v_attempt > array_length(v_retry, 1) then
    update public.client_memberships set status = 'canceled', canceled_at = now(), failed_attempts = v_attempt, next_retry_at = null,
      cancel_reason = 'Payment failed ' || v_attempt || ' times'
    where id = v_m.id;
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_b.id, v_m.id, 'payment_failed', v_reason);
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_b.id, v_m.id, 'canceled', 'Payment failed ' || v_attempt || ' times');
  else
    update public.client_memberships set status = 'past_due', failed_attempts = v_attempt, next_retry_at = now() + make_interval(days => v_retry[v_attempt])
    where id = v_m.id;
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_b.id, v_m.id, 'payment_failed', v_reason);
  end if;
  -- A notice to the owners and managers (an email, recorded until email
  -- is connected; the Dashboard shows it too).
  for v_staff in select s.id from public.staff s where s.business_id = v_b.id and s.is_active and s.role in ('owner', 'manager') loop
    insert into public.notifications (business_id, location_id, staff_id, channel, template, body)
    values (v_b.id, v_m.location_id, v_staff.id, 'email', 'membership_payment_failed',
      left(concat(v_client.first_name, ' ', v_client.last_name, '''s ', v_m.name, ' payment of ', to_char(v_m.price_cents / 100.0, 'FM$999,990.00'),
        ' didn''t go through (', v_reason, '). ',
        case when v_attempt > array_length(v_retry, 1) then 'The membership has been canceled.'
             else 'Maestra will try again on ' || to_char((now() + make_interval(days => v_retry[v_attempt])) at time zone (select timezone from public.locations where id = v_m.location_id), 'FMMonth FMDD') || '. You can update their card from their profile.' end), 1000));
  end loop;
  return jsonb_build_object('status', case when v_attempt > array_length(v_retry, 1) then 'canceled' else 'past_due' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- The front of house: pause, resume, cancel (or keep), and the card.
-- ---------------------------------------------------------------------------

-- Today at the membership's location.
create function private.membership_today(p_location_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone (select timezone from public.locations where id = p_location_id))::date
$$;

create function private.front_of_house_membership(p_membership_id uuid)
returns public.client_memberships
language plpgsql
set search_path = ''
as $$
declare
  v_m public.client_memberships;
begin
  select * into v_m from public.client_memberships where id = p_membership_id for update;
  if v_m.id is null or not private.has_business_role(v_m.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return v_m;
end;
$$;

-- From the end of this period, for a number of periods.
create function public.pause_membership(p_membership_id uuid, p_periods integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.client_memberships := private.front_of_house_membership(p_membership_id);
begin
  if not v_m.allow_pause then
    raise exception 'This membership can''t be paused' using errcode = '22023';
  end if;
  if v_m.status <> 'active' or v_m.cancels_on is not null or v_m.pause_from is not null then
    raise exception 'Only an active membership, not already pausing or ending, can be paused' using errcode = '55000';
  end if;
  if p_periods is null or p_periods < 1 or p_periods > v_m.max_pause_periods then
    raise exception 'Pause for 1 to % periods', v_m.max_pause_periods using errcode = '22023';
  end if;
  update public.client_memberships set pause_from = current_period_end,
    resume_on = private.add_interval(current_period_end, interval_unit, interval_count * p_periods)
  where id = v_m.id returning * into v_m;
  insert into public.membership_events (business_id, membership_id, kind, detail, staff_id)
  values (v_m.business_id, v_m.id, 'pause_scheduled', v_m.pause_from || ' to ' || v_m.resume_on, private.current_staff_id(v_m.business_id));
end;
$$;

-- A pause that hasn't started is called off; a paused membership starts a
-- new period today (charged by the billing job, which the app runs for it
-- straight away).
create function public.resume_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.client_memberships := private.front_of_house_membership(p_membership_id);
  p_today date := private.membership_today(v_m.location_id);
begin
  if v_m.status = 'active' and v_m.pause_from is not null then
    update public.client_memberships set pause_from = null, resume_on = null where id = v_m.id;
  elsif v_m.status = 'paused' then
    update public.client_memberships set status = 'active', anchor_on = p_today, periods_paid = 0, current_period_start = p_today, current_period_end = p_today,
      pause_from = null, resume_on = null
    where id = v_m.id;
  else
    raise exception 'This membership isn''t paused' using errcode = '55000';
  end if;
  insert into public.membership_events (business_id, membership_id, kind, staff_id) values (v_m.business_id, v_m.id, 'resumed', private.current_staff_id(v_m.business_id));
end;
$$;

-- When it can end: the end of a period, after the minimum term and the
-- notice. Mirrored by earliestEnd in lib/memberships.ts.
create function private.membership_earliest_end(v_m public.client_memberships, p_today date)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_floor date := greatest(
    v_m.current_period_end,
    private.add_interval(v_m.started_on, v_m.interval_unit, v_m.interval_count * v_m.min_term_periods),
    p_today + v_m.cancel_notice_days
  );
  v_end date := v_m.current_period_end;
  n integer := v_m.periods_paid;
begin
  while v_end < v_floor loop
    n := n + 1;
    v_end := private.add_interval(v_m.anchor_on, v_m.interval_unit, v_m.interval_count * n);
  end loop;
  return v_end;
end;
$$;

-- Ends at the earliest the rules allow; or now (owners and managers, for
-- an exception). A membership that's past due or paused ends now.
create function public.cancel_membership(p_membership_id uuid, p_reason text, p_now boolean)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.client_memberships := private.front_of_house_membership(p_membership_id);
  p_today date := private.membership_today(v_m.location_id);
  v_on date;
  v_me uuid := private.current_staff_id(v_m.business_id);
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v_m.status = 'canceled' then
    raise exception 'This membership has already ended' using errcode = '55000';
  end if;
  if p_now and not private.has_business_role(v_m.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can end a membership early' using errcode = '42501';
  end if;
  if p_now or v_m.status in ('past_due', 'paused') then
    update public.client_memberships set status = 'canceled', canceled_at = now(), cancels_on = p_today, cancel_reason = trim(p_reason), next_retry_at = null
    where id = v_m.id;
    insert into public.membership_events (business_id, membership_id, kind, detail, staff_id) values (v_m.business_id, v_m.id, 'canceled', trim(p_reason), v_me);
    return p_today;
  end if;
  v_on := private.membership_earliest_end(v_m, p_today);
  update public.client_memberships set cancels_on = v_on, cancel_reason = trim(p_reason), pause_from = null, resume_on = null where id = v_m.id;
  insert into public.membership_events (business_id, membership_id, kind, detail, staff_id) values (v_m.business_id, v_m.id, 'cancel_requested', 'Ends ' || v_on || ': ' || trim(p_reason), v_me);
  return v_on;
end;
$$;

-- Changed their mind before it ended.
create function public.keep_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.client_memberships := private.front_of_house_membership(p_membership_id);
begin
  if v_m.status <> 'active' or v_m.cancels_on is null then
    raise exception 'This membership isn''t ending' using errcode = '55000';
  end if;
  update public.client_memberships set cancels_on = null, cancel_reason = null where id = v_m.id;
  insert into public.membership_events (business_id, membership_id, kind, staff_id) values (v_m.business_id, v_m.id, 'kept', private.current_staff_id(v_m.business_id));
end;
$$;

-- A new card at the provider (a token). A past-due payment is tried again
-- straight away.
create function public.update_membership_card(p_membership_id uuid, p_provider text, p_ref text, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.client_memberships := private.front_of_house_membership(p_membership_id);
begin
  if nullif(trim(p_ref), '') is null or p_provider !~ '^[a-z_]{1,20}$' then
    raise exception 'Add the card' using errcode = '22023';
  end if;
  if v_m.status = 'canceled' then
    raise exception 'This membership has already ended' using errcode = '55000';
  end if;
  update public.client_memberships set provider = p_provider, payment_method_ref = trim(p_ref), card_label = nullif(trim(p_label), ''),
    next_retry_at = case when status = 'past_due' then now() else next_retry_at end
  where id = v_m.id;
  insert into public.membership_events (business_id, membership_id, kind, detail, staff_id)
  values (v_m.business_id, v_m.id, 'card_updated', nullif(trim(p_label), ''), private.current_staff_id(v_m.business_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Owners: a plan and its included services (replacing them all).
-- ---------------------------------------------------------------------------

create function public.save_membership_plan(p_business_id uuid, p_plan_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_plan_id;
  v_service jsonb;
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can set up memberships' using errcode = '42501';
  end if;
  if v_id is null then
    insert into public.membership_plans (business_id, name, description, price_cents, interval_unit, interval_count, service_discount_pct, retail_discount_pct,
      min_term_periods, cancel_notice_days, allow_pause, max_pause_periods, is_active)
    values (p_business_id, trim(p_input ->> 'name'), nullif(trim(p_input ->> 'description'), ''), (p_input ->> 'price_cents')::int,
      p_input ->> 'interval_unit', (p_input ->> 'interval_count')::int, (p_input ->> 'service_discount_pct')::int, (p_input ->> 'retail_discount_pct')::int,
      (p_input ->> 'min_term_periods')::int, (p_input ->> 'cancel_notice_days')::int, (p_input ->> 'allow_pause')::boolean, (p_input ->> 'max_pause_periods')::int,
      coalesce((p_input ->> 'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.membership_plans set name = trim(p_input ->> 'name'), description = nullif(trim(p_input ->> 'description'), ''), price_cents = (p_input ->> 'price_cents')::int,
      interval_unit = p_input ->> 'interval_unit', interval_count = (p_input ->> 'interval_count')::int,
      service_discount_pct = (p_input ->> 'service_discount_pct')::int, retail_discount_pct = (p_input ->> 'retail_discount_pct')::int,
      min_term_periods = (p_input ->> 'min_term_periods')::int, cancel_notice_days = (p_input ->> 'cancel_notice_days')::int,
      allow_pause = (p_input ->> 'allow_pause')::boolean, max_pause_periods = (p_input ->> 'max_pause_periods')::int, is_active = coalesce((p_input ->> 'is_active')::boolean, true)
    where id = v_id and business_id = p_business_id;
    if not found then
      raise exception 'Membership not found' using errcode = 'P0002';
    end if;
    delete from public.membership_plan_services where plan_id = v_id;
  end if;
  for v_service in select * from jsonb_array_elements(coalesce(p_input -> 'services', '[]')) loop
    if not exists (select 1 from public.services where id = (v_service ->> 'service_id')::uuid and business_id = p_business_id) then
      raise exception 'Unknown service' using errcode = '22023';
    end if;
    insert into public.membership_plan_services (plan_id, business_id, service_id, quantity, rollover)
    values (v_id, p_business_id, (v_service ->> 'service_id')::uuid, (v_service ->> 'quantity')::int, coalesce((v_service ->> 'rollover')::boolean, false));
  end loop;
  return v_id;
end;
$$;

revoke all on function private.on_sale_voided() from public;
revoke all on function private.front_of_house_membership(uuid) from public;
revoke all on function private.membership_earliest_end(public.client_memberships, date) from public;
revoke all on function public.advance_membership(uuid, date) from public, anon, authenticated;
revoke all on function public.record_membership_charge(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.advance_membership(uuid, date) to service_role;
grant execute on function public.record_membership_charge(uuid, date, jsonb) to service_role;
revoke all on function public.pause_membership(uuid, integer) from public, anon;
revoke all on function private.membership_today(uuid) from public;
revoke all on function public.resume_membership(uuid) from public, anon;
revoke all on function public.cancel_membership(uuid, text, boolean) from public, anon;
revoke all on function public.keep_membership(uuid) from public, anon;
revoke all on function public.update_membership_card(uuid, text, text, text) from public, anon;
revoke all on function public.save_membership_plan(uuid, uuid, jsonb) from public, anon;
grant execute on function public.pause_membership(uuid, integer) to authenticated;
grant execute on function public.resume_membership(uuid) to authenticated;
grant execute on function public.cancel_membership(uuid, text, boolean) to authenticated;
grant execute on function public.keep_membership(uuid) to authenticated;
grant execute on function public.update_membership_card(uuid, text, text, text) to authenticated;
grant execute on function public.save_membership_plan(uuid, uuid, jsonb) to authenticated;

-- Try a failed payment again now (the billing job then charges it).
create function public.retry_membership_payment(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.client_memberships := private.front_of_house_membership(p_membership_id);
begin
  if v_m.status <> 'past_due' then
    raise exception 'Nothing is owed on this membership' using errcode = '55000';
  end if;
  update public.client_memberships set next_retry_at = now() where id = v_m.id;
end;
$$;

revoke all on function public.retry_membership_payment(uuid) from public, anon;
grant execute on function public.retry_membership_payment(uuid) to authenticated;
