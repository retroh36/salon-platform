-- Promotions and last-minute specials (lib/promotions.ts mirrors these
-- rules for the screens): a percent or amount off the services and/or
-- retail a promotion covers (by service, category, stylist, level or
-- product, with exclusions like "never Master color"), used as a code,
-- automatically at checkout, or as a last-minute special (open time
-- starting within N hours, with a badge on the booking site). Dates, a
-- total and a per-client limit, new clients only, first visit only, a
-- minimum spend, and no stacking unless allowed. complete_sale applies
-- them after member prices and before staff discounts (which they don't
-- count against), and every use is a redemption with who applied it.
-- Staff send specials to clients who said yes to offers, from a fixed
-- template, within the salon's sending hours and at most one offer a week.

create table public.promotions (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  name                 text not null check (length(btrim(name)) between 1 and 60),
  kind                 text not null check (kind in ('code', 'automatic', 'last_minute')),
  code                 text check (code ~ '^[A-Z0-9_-]{3,24}$'),
  discount_kind        text not null check (discount_kind in ('percent', 'amount')),
  percent              numeric(5, 2) check (percent > 0 and percent <= 100),
  amount_cents         integer check (amount_cents between 1 and 100000),
  applies_services     boolean not null default true,
  applies_retail       boolean not null default false,
  -- null: any.
  service_ids          uuid[],
  categories           text[],
  staff_ids            uuid[],
  levels               public.staff_level[],
  -- [{ "level": "master", "category": "Color" }, …]: never these.
  exclusions           jsonb not null default '[]' check (jsonb_typeof(exclusions) = 'array'),
  product_ids          uuid[],
  starts_on            date,
  ends_on              date,
  max_uses             integer check (max_uses > 0),
  max_uses_per_client  integer check (max_uses_per_client > 0),
  new_clients_only     boolean not null default false,
  first_visit_only     boolean not null default false,
  min_spend_cents      integer check (min_spend_cents > 0),
  stackable            boolean not null default false,
  online               boolean not null default true,
  hours_ahead          integer check (hours_ahead between 1 and 168),
  archived_at          timestamptz,
  created_by           uuid references public.staff (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((kind = 'code') = (code is not null)),
  check ((kind = 'last_minute') = (hours_ahead is not null)),
  check ((discount_kind = 'percent') = (percent is not null) and (discount_kind = 'amount') = (amount_cents is not null)),
  check (applies_services or applies_retail),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (not new_clients_only or starts_on is not null)
);
create unique index promotions_code_idx on public.promotions (business_id, code) where archived_at is null and code is not null;
create index promotions_business_idx on public.promotions (business_id) where archived_at is null;
alter table public.promotions enable row level security;

create policy "Staff see their salon's promotions"
  on public.promotions for select to authenticated
  using ((select private.is_business_member(business_id)));

create trigger promotions_set_updated_at before update on public.promotions
  for each row execute function public.set_updated_at();

-- Every use: on a sale, with how it came (a code at the desk, automatic,
-- a special, or from the booking), who applied it and what it took off.
create table public.promotion_redemptions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  promotion_id    uuid not null references public.promotions (id) on delete cascade,
  sale_id         uuid not null references public.sales (id) on delete cascade,
  appointment_id  uuid references public.appointments (id) on delete set null,
  client_id       uuid references public.clients (id) on delete set null,
  source          text not null check (source in ('code', 'automatic', 'special', 'online')),
  discount_cents  integer not null check (discount_cents >= 0),
  -- The client's first visit (for "new clients" in reports), and a
  -- last-minute special (a gap filled).
  first_visit     boolean not null default false,
  last_minute     boolean not null default false,
  applied_by      uuid references public.staff (id) on delete set null,
  voided_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (promotion_id, sale_id)
);
create index promotion_redemptions_promotion_idx on public.promotion_redemptions (promotion_id, created_at);
create index promotion_redemptions_client_idx on public.promotion_redemptions (client_id);
alter table public.promotion_redemptions enable row level security;

create policy "Front of house see promotion uses"
  on public.promotion_redemptions for select to authenticated
  using ((select private.front_of_house(business_id)));

-- A code or special the client used when booking online, taken off at checkout.
alter table public.appointments add column promotion_id uuid references public.promotions (id) on delete set null;
create index appointments_promotion_idx on public.appointments (promotion_id) where promotion_id is not null;

alter table public.sale_items add column promo_discount_cents integer not null default 0 check (promo_discount_cents >= 0);

alter table public.marketing_messages drop constraint marketing_messages_kind_check;
alter table public.marketing_messages add constraint marketing_messages_kind_check check (kind in ('rebook', 'win_back', 'birthday', 'review', 'staff', 'promotion'));
alter table public.client_messages drop constraint client_messages_template_check;
alter table public.client_messages add constraint client_messages_template_check check (template in ('running_late', 'please_call', 'need_to_move', 'reminder', 'ready_early', 'custom', 'special'));
alter table public.client_messages add column promotion_id uuid references public.promotions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- The rules (as promotionApplies and promotionProblem in lib/promotions.ts).
-- ---------------------------------------------------------------------------

create function private.promotion_applies(
  p public.promotions, p_kind text, p_service_id uuid, p_category text, p_staff_id uuid, p_level public.staff_level, p_product_id uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'service' then p.applies_services
      and (p.service_ids is null or p_service_id = any (p.service_ids))
      and (p.categories is null or p_category = any (p.categories))
      and (p.staff_ids is null or p_staff_id = any (p.staff_ids))
      and (p.levels is null or p_level = any (p.levels))
      and not exists (
        select 1 from jsonb_array_elements(p.exclusions) e
        where (e ->> 'level' is not null or e ->> 'category' is not null)
          and (e ->> 'level' is null or e ->> 'level' = p_level::text)
          and (e ->> 'category' is null or e ->> 'category' = p_category)
      )
    when 'product' then p.applies_retail and (p.product_ids is null or p_product_id = any (p.product_ids))
    else false
  end;
$$;

-- Whether the client has had a visit before (checked out), apart from this one.
create function private.visited_before(p_client_id uuid, p_except uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.appointments where client_id = p_client_id and status = 'completed' and id is distinct from p_except);
$$;

create function private.money_text(p_cents integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_cents % 100 = 0 then to_char(p_cents / 100, 'FM$999,999,990') else to_char(p_cents / 100.0, 'FM$999,999,990.00') end;
$$;

-- Why a promotion can't be used here (null: it can). Uses count every sale
-- that used it (not voided) and every upcoming visit holding it from
-- online booking, apart from this visit.
create function private.promotion_problem(p public.promotions, p_where text, p_client_id uuid, p_appointment_id uuid, p_spend integer, p_today date)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uses integer;
  v_client_uses integer;
  v_tz text;
  v_created date;
  v_a public.appointments;
begin
  if p.archived_at is not null then
    return p.name || ' has ended.';
  end if;
  if p_where = 'online' and not p.online then
    return p.name || ' can''t be used online.';
  end if;
  if p.starts_on is not null and p_today < p.starts_on then
    return p.name || ' hasn''t started yet.';
  end if;
  if p.ends_on is not null and p_today > p.ends_on then
    return p.name || ' has ended.';
  end if;
  select count(*) into v_uses from public.promotion_redemptions where promotion_id = p.id and voided_at is null;
  v_uses := v_uses + (select count(*) from public.appointments where promotion_id = p.id and status in ('booked', 'confirmed', 'checked_in') and id is distinct from p_appointment_id);
  if p.max_uses is not null and v_uses >= p.max_uses then
    return p.name || ' has been used as many times as it can be.';
  end if;
  if (p.new_clients_only or p.first_visit_only or p.max_uses_per_client is not null) and p_client_id is null then
    return p.name || ' needs a client on the sale.';
  end if;
  if p.max_uses_per_client is not null then
    select count(*) into v_client_uses from public.promotion_redemptions where promotion_id = p.id and client_id = p_client_id and voided_at is null;
    v_client_uses := v_client_uses + (select count(*) from public.appointments where promotion_id = p.id and client_id = p_client_id and status in ('booked', 'confirmed', 'checked_in') and id is distinct from p_appointment_id);
    if v_client_uses >= p.max_uses_per_client then
      return 'This client has already used ' || p.name || case when p.max_uses_per_client > 1 then ' ' || p.max_uses_per_client || ' times' else '' end || '.';
    end if;
  end if;
  if p.new_clients_only then
    select l.timezone into v_tz from public.locations l where l.business_id = p.business_id order by l.created_at limit 1;
    select (created_at at time zone v_tz)::date into v_created from public.clients where id = p_client_id;
    if v_created < p.starts_on then
      return p.name || ' is for new clients only.';
    end if;
  end if;
  if p.first_visit_only and private.visited_before(p_client_id, p_appointment_id) then
    return p.name || ' is for a client''s first visit only.';
  end if;
  if p.min_spend_cents is not null and p_spend < p.min_spend_cents then
    return p.name || ' needs a spend of ' || private.money_text(p.min_spend_cents) || ' or more.';
  end if;
  if p.kind = 'last_minute' then
    select * into v_a from public.appointments where id = p_appointment_id;
    if v_a.id is null then
      return p.name || ' is for visits booked at the last minute.';
    end if;
    if v_a.starts_at - v_a.created_at > make_interval(hours => p.hours_ahead) then
      return p.name || ' is for visits booked within ' || p.hours_ahead || ' hours of starting.';
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owners and managers (the settings permission) set them up.
-- ---------------------------------------------------------------------------

create function public.save_promotion(p_business_id uuid, p_promotion_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.promotions;
  v_list jsonb;
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers can set up promotions' using errcode = '42501';
  end if;
  if p_promotion_id is not null then
    select * into v from public.promotions where id = p_promotion_id and business_id = p_business_id and archived_at is null;
    if v.id is null then
      raise exception 'Promotion not found' using errcode = 'P0002';
    end if;
  else
    v.id := gen_random_uuid();
    v.business_id := p_business_id;
    v.created_by := private.current_staff_id(p_business_id);
    v.created_at := now();
    v.updated_at := now();
  end if;
  v.name := btrim(p_input ->> 'name');
  v.kind := p_input ->> 'kind';
  v.code := nullif(upper(btrim(p_input ->> 'code')), '');
  v.discount_kind := p_input ->> 'discount_kind';
  v.percent := (p_input ->> 'percent')::numeric;
  v.amount_cents := (p_input ->> 'amount_cents')::int;
  v.applies_services := coalesce((p_input ->> 'applies_services')::boolean, true);
  v.applies_retail := coalesce((p_input ->> 'applies_retail')::boolean, false);
  v_list := case when jsonb_typeof(p_input -> 'service_ids') = 'array' then p_input -> 'service_ids' end;
  v.service_ids := (select array_agg(x::uuid) from jsonb_array_elements_text(v_list) x);
  v_list := case when jsonb_typeof(p_input -> 'categories') = 'array' then p_input -> 'categories' end;
  v.categories := (select array_agg(x) from jsonb_array_elements_text(v_list) x);
  v_list := case when jsonb_typeof(p_input -> 'staff_ids') = 'array' then p_input -> 'staff_ids' end;
  v.staff_ids := (select array_agg(x::uuid) from jsonb_array_elements_text(v_list) x);
  v_list := case when jsonb_typeof(p_input -> 'levels') = 'array' then p_input -> 'levels' end;
  v.levels := (select array_agg(x::public.staff_level) from jsonb_array_elements_text(v_list) x);
  v.exclusions := coalesce(case when jsonb_typeof(p_input -> 'exclusions') = 'array' then p_input -> 'exclusions' end, '[]');
  v_list := case when jsonb_typeof(p_input -> 'product_ids') = 'array' then p_input -> 'product_ids' end;
  v.product_ids := (select array_agg(x::uuid) from jsonb_array_elements_text(v_list) x);
  v.starts_on := (p_input ->> 'starts_on')::date;
  v.ends_on := (p_input ->> 'ends_on')::date;
  v.max_uses := (p_input ->> 'max_uses')::int;
  v.max_uses_per_client := (p_input ->> 'max_uses_per_client')::int;
  v.new_clients_only := coalesce((p_input ->> 'new_clients_only')::boolean, false);
  v.first_visit_only := coalesce((p_input ->> 'first_visit_only')::boolean, false);
  v.min_spend_cents := (p_input ->> 'min_spend_cents')::int;
  v.stackable := coalesce((p_input ->> 'stackable')::boolean, false);
  v.online := coalesce((p_input ->> 'online')::boolean, true);
  v.hours_ahead := (p_input ->> 'hours_ahead')::int;
  -- Only this salon's services, stylists and products.
  if exists (select 1 from unnest(coalesce(v.service_ids, '{}')) x where not exists (select 1 from public.services s where s.id = x and s.business_id = p_business_id))
     or exists (select 1 from unnest(coalesce(v.staff_ids, '{}')) x where not exists (select 1 from public.staff s where s.id = x and s.business_id = p_business_id))
     or exists (select 1 from unnest(coalesce(v.product_ids, '{}')) x where not exists (select 1 from public.products s where s.id = x and s.business_id = p_business_id)) then
    raise exception 'Choose this salon''s services, stylists and products' using errcode = '22023';
  end if;
  if p_promotion_id is null then
    insert into public.promotions select (v).*;
  else
    update public.promotions set
      (name, kind, code, discount_kind, percent, amount_cents, applies_services, applies_retail, service_ids, categories, staff_ids, levels, exclusions,
       product_ids, starts_on, ends_on, max_uses, max_uses_per_client, new_clients_only, first_visit_only, min_spend_cents, stackable, online, hours_ahead) =
      (v.name, v.kind, v.code, v.discount_kind, v.percent, v.amount_cents, v.applies_services, v.applies_retail, v.service_ids, v.categories, v.staff_ids, v.levels, v.exclusions,
       v.product_ids, v.starts_on, v.ends_on, v.max_uses, v.max_uses_per_client, v.new_clients_only, v.first_visit_only, v.min_spend_cents, v.stackable, v.online, v.hours_ahead)
    where id = v.id;
  end if;
  return v.id;
exception when unique_violation then
  raise exception 'Another promotion already uses that code' using errcode = '23505';
end;
$$;

-- Ending one: it stays in reports, and can't be used again.
create function public.archive_promotion(p_promotion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.promotions where id = p_promotion_id;
  if v_business is null or not private.can(v_business, 'settings') then
    raise exception 'Only owners and managers can end promotions' using errcode = '42501';
  end if;
  update public.promotions set archived_at = now() where id = p_promotion_id and archived_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Online booking (service role): a code or special the client used, kept
-- on the visit (it counts towards the limits) and taken off at checkout.
-- ---------------------------------------------------------------------------

create function public.attach_online_promotion(p_appointment_id uuid, p_promotion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments;
  v_p public.promotions;
  v_spend integer;
  v_problem text;
begin
  select * into v_a from public.appointments where id = p_appointment_id;
  select * into v_p from public.promotions where id = p_promotion_id and business_id = v_a.business_id for update;
  if v_a.id is null or v_p.id is null or v_p.kind = 'automatic' then
    raise exception 'That promotion isn''t available online' using errcode = '22023';
  end if;
  select coalesce(sum(price_cents), 0) into v_spend from public.appointment_items where appointment_id = v_a.id;
  v_problem := private.promotion_problem(v_p, 'online', v_a.client_id, v_a.id, v_spend,
    (now() at time zone (select timezone from public.locations where id = v_a.location_id))::date);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023', hint = 'promotion';
  end if;
  if not exists (
    select 1 from public.appointment_items i join public.services s on s.id = i.service_id join public.staff st on st.id = i.staff_id
    where i.appointment_id = v_a.id and private.promotion_applies(v_p, 'service', i.service_id, s.category, i.staff_id, st.level, null)
  ) then
    raise exception '% doesn''t cover these services', v_p.name using errcode = '22023', hint = 'promotion';
  end if;
  update public.appointments set promotion_id = v_p.id where id = v_a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_sale, as before, with promotions (promotion_ids, in order).
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
  -- Promotions on the sale, in the order given: the rows, what's left of
  -- each amount off, and what each took.
  v_promos public.promotions[] := '{}';
  v_promo public.promotions;
  v_pool integer[] := '{}';
  v_promo_take integer[] := '{}';
  v_promo_line integer;
  v_promo_names text;
  v_promo_discounts integer := 0;
  v_spend integer := 0;
  v_left integer;
  v_take integer;
  v_category text;
  v_problem text;
  v_first_visit boolean;
  j integer;
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

  -- Promotions: a code given at the desk or online, an automatic offer or
  -- a last-minute special (locked, so limits hold with two checkouts at once).
  for v_line in select * from jsonb_array_elements(coalesce(p_input -> 'promotion_ids', '[]')) loop
    select * into v_promo from public.promotions where id = (v_line #>> '{}')::uuid and business_id = v_business.id and archived_at is null for update;
    if v_promo.id is null then
      raise exception 'That promotion isn''t available' using errcode = '22023', hint = 'promotion';
    end if;
    for j in 1 .. coalesce(array_length(v_promos, 1), 0) loop
      if (v_promos[j]).id = v_promo.id then
        raise exception 'That promotion is already on the sale' using errcode = '22023', hint = 'promotion';
      end if;
    end loop;
    v_promos := v_promos || v_promo;
    v_pool := v_pool || case when v_promo.discount_kind = 'amount' then v_promo.amount_cents end;
    v_promo_take := v_promo_take || 0;
  end loop;

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
      -- The member price first, then promotions, then any discount staff
      -- give on the rest.
      v_member := case when v_pitem.id is null and v_credit.id is null then round(v_gross::numeric * v_service_pct / 100)::int else 0 end;
      v_promo_line := 0;
      v_promo_names := null;
      if v_pitem.id is null and v_credit.id is null then
        v_spend := v_spend + v_gross;
        select category into v_category from public.services where id = v_item.service_id;
        select level into v_level from public.staff where id = v_staff_id;
        for j in 1 .. coalesce(array_length(v_promos, 1), 0) loop
          v_promo := v_promos[j];
          v_left := v_gross - v_member - v_promo_line;
          if v_left > 0 and private.promotion_applies(v_promo, 'service', v_item.service_id, v_category, v_staff_id, v_level, null) then
            v_take := case when v_promo.discount_kind = 'percent' then round(v_left::numeric * v_promo.percent / 100)::int else least(v_left, v_pool[j]) end;
            if v_promo.discount_kind = 'amount' then
              v_pool[j] := v_pool[j] - v_take;
            end if;
            v_promo_take[j] := v_promo_take[j] + v_take;
            v_promo_line := v_promo_line + v_take;
            if v_take > 0 then
              v_promo_names := concat_ws('; ', v_promo_names, v_promo.name);
            end if;
          end if;
        end loop;
      end if;
      v_line_discount := case when v_pitem.id is null and v_credit.id is null then private.line_discount(v_line -> 'discount', v_gross - v_member - v_promo_line) else 0 end;
      v_line_discounts := v_line_discounts + v_line_discount;
      v_member_discounts := v_member_discounts + v_member;
      v_promo_discounts := v_promo_discounts + v_promo_line;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'service', 'service_id', v_item.service_id, 'appointment_item_id', v_item.id, 'staff_id', v_staff_id,
        'description', v_item.name, 'quantity', v_qty, 'unit', v_price,
        'booked', case when v_price <> v_item.price_cents then v_item.price_cents end,
        'reason', case when v_price <> v_item.price_cents then trim(v_line ->> 'price_reason') end,
        'package_item_id', v_pitem.id, 'package_name', v_pitem.name, 'membership_credit_id', v_credit.id, 'member_discount', v_member,
        'promo_discount', v_promo_line, 'line_discount', v_line_discount + v_member + v_promo_line,
        'line_discount_reason', nullif(concat_ws('; ', case when v_member > 0 then 'Member price' end, v_promo_names, case when v_line_discount > 0 then trim(v_line -> 'discount' ->> 'reason') end), ''));
      v_lines := v_lines || jsonb_build_object('gross', v_gross, 'line_discount', v_line_discount + v_member + v_promo_line,
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
      v_spend := v_spend + v_gross;
      v_member := round(v_gross::numeric * v_retail_pct / 100)::int;
      v_promo_line := 0;
      v_promo_names := null;
      for j in 1 .. coalesce(array_length(v_promos, 1), 0) loop
        v_promo := v_promos[j];
        v_left := v_gross - v_member - v_promo_line;
        if v_left > 0 and private.promotion_applies(v_promo, 'product', null, null, null, null, v_product.id) then
          v_take := case when v_promo.discount_kind = 'percent' then round(v_left::numeric * v_promo.percent / 100)::int else least(v_left, v_pool[j]) end;
          if v_promo.discount_kind = 'amount' then
            v_pool[j] := v_pool[j] - v_take;
          end if;
          v_promo_take[j] := v_promo_take[j] + v_take;
          v_promo_line := v_promo_line + v_take;
          if v_take > 0 then
            v_promo_names := concat_ws('; ', v_promo_names, v_promo.name);
          end if;
        end if;
      end loop;
      v_line_discount := private.line_discount(v_line -> 'discount', v_gross - v_member - v_promo_line);
      v_line_discounts := v_line_discounts + v_line_discount;
      v_member_discounts := v_member_discounts + v_member;
      v_promo_discounts := v_promo_discounts + v_promo_line;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'product', 'product_id', v_product.id, 'staff_id', v_staff_id,
        'description', concat_ws(' ', v_product.brand, v_product.line, v_product.name), 'quantity', v_qty, 'unit', v_product.price_cents,
        'member_discount', v_member, 'promo_discount', v_promo_line, 'line_discount', v_line_discount + v_member + v_promo_line,
        'line_discount_reason', nullif(concat_ws('; ', case when v_member > 0 then 'Member price' end, v_promo_names, case when v_line_discount > 0 then trim(v_line -> 'discount' ->> 'reason') end), ''));
      v_lines := v_lines || jsonb_build_object('gross', v_gross, 'line_discount', v_line_discount + v_member + v_promo_line, 'taxable_bp', v_business.tax_rate_retail_bp, 'discountable', true);
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
  -- Each promotion: its rules for this client and visit, that it covers
  -- something here, and no stacking unless every one allows it.
  for j in 1 .. coalesce(array_length(v_promos, 1), 0) loop
    v_problem := private.promotion_problem(v_promos[j], 'checkout', v_client_id, v_appointment.id, v_spend, v_today);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023', hint = 'promotion';
    end if;
    if v_promo_take[j] = 0 then
      raise exception '% doesn''t cover anything on this sale', (v_promos[j]).name using errcode = '22023', hint = 'promotion';
    end if;
    if not (v_promos[j]).stackable and array_length(v_promos, 1) > 1 then
      raise exception '% can''t be used with another promotion', (v_promos[j]).name using errcode = '22023', hint = 'promotion';
    end if;
    if not (v_promos[j]).stackable and v_discount + v_line_discounts > 0 then
      raise exception '% can''t be used with another discount', (v_promos[j]).name using errcode = '22023', hint = 'promotion';
    end if;
  end loop;
  -- Discounts staff give (on lines or the sale; member prices and
  -- promotions aren't counted): by who may give them, and how much.
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

  v_total := v_subtotal - v_discount - v_line_discounts - v_member_discounts - v_promo_discounts + v_tax + v_tips;

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
    v_business.id, p_location_id, v_number, v_client_id, v_appointment.id, v_subtotal, v_discount + v_line_discounts + v_member_discounts + v_promo_discounts, v_discount_reason,
    v_tax, v_tips, v_total, nullif(trim(p_input ->> 'note'), ''), nullif(trim(p_input ->> 'receipt_email'), ''), v_me, v_rebook, v_draft.id
  ) returning id into v_sale_id;
  if v_draft.id is not null then
    update public.sale_drafts set status = 'completed', sale_id = v_sale_id where id = v_draft.id;
  end if;
  -- Each promotion used, with who applied it and how it came.
  if coalesce(array_length(v_promos, 1), 0) > 0 then
    v_first_visit := v_client_id is not null and not private.visited_before(v_client_id, v_appointment.id);
    for j in 1 .. array_length(v_promos, 1) loop
      insert into public.promotion_redemptions (business_id, promotion_id, sale_id, appointment_id, client_id, source, discount_cents, first_visit, last_minute, applied_by)
      values (v_business.id, (v_promos[j]).id, v_sale_id, v_appointment.id, v_client_id,
        case when v_appointment.promotion_id = (v_promos[j]).id then 'online' when (v_promos[j]).kind = 'automatic' then 'automatic' when (v_promos[j]).kind = 'last_minute' then 'special' else 'code' end,
        v_promo_take[j], v_first_visit, (v_promos[j]).kind = 'last_minute', v_me);
    end loop;
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
      client_package_id, package_item_id, line_discount_cents, line_discount_reason, membership_id, membership_credit_id, member_discount_cents, promo_discount_cents
    ) values (
      v_sale_id, v_business.id, i + 1, (v_rows -> i ->> 'kind')::public.sale_item_kind,
      (v_rows -> i ->> 'service_id')::uuid, (v_rows -> i ->> 'appointment_item_id')::uuid, (v_rows -> i ->> 'product_id')::uuid,
      (v_rows -> i ->> 'staff_id')::uuid, v_rows -> i ->> 'description', (v_rows -> i ->> 'quantity')::int, (v_rows -> i ->> 'unit')::int,
      (v_rows -> i ->> 'booked')::int, v_rows -> i ->> 'reason',
      (v_priced -> i ->> 'discount')::int, (v_priced -> i ->> 'tax')::int, (v_priced -> i ->> 'total')::int, v_card.id,
      v_package_id, (v_rows -> i ->> 'package_item_id')::uuid,
      coalesce((v_rows -> i ->> 'line_discount')::int, 0), v_rows -> i ->> 'line_discount_reason',
      v_membership_id, (v_rows -> i ->> 'membership_credit_id')::uuid, coalesce((v_rows -> i ->> 'member_discount')::int, 0),
      coalesce((v_rows -> i ->> 'promo_discount')::int, 0)
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

-- A voided sale gives its promotion uses back.
create function private.on_sale_voided_promotions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.promotion_redemptions set voided_at = now() where sale_id = new.id and voided_at is null;
  return new;
end;
$$;

create trigger sales_promotion_void after update of status on public.sales
  for each row when (old.status is distinct from 'voided' and new.status = 'voided')
  execute function private.on_sale_voided_promotions();

-- ---------------------------------------------------------------------------
-- Sending a special to a client (front of house): the fixed template our
-- code fills in ('special'), or their own words when their role may write;
-- only to clients who said yes to offers on that channel, between 9am and
-- 8pm at the salon, at most one offer a week, and once per promotion.
-- ---------------------------------------------------------------------------

create function public.send_promotion_message(
  p_promotion_id uuid, p_client_id uuid, p_channel text, p_template text, p_subject text, p_body text, p_opt_out_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.promotions;
  v_client public.clients;
  v_staff uuid;
  v_role public.staff_role;
  v_free_text public.staff_role[];
  v_tz text;
  v_minute integer;
  v_body text := btrim(coalesce(p_body, ''));
  v_to text;
  v_outbox uuid;
  v_id uuid;
begin
  select * into v_p from public.promotions where id = p_promotion_id;
  if v_p.id is null or not private.front_of_house(v_p.business_id) then
    raise exception 'Only the front of house can send offers' using errcode = '42501';
  end if;
  v_staff := private.current_staff_id(v_p.business_id);
  select role into v_role from public.staff where id = v_staff;
  select free_text_roles into v_free_text from public.businesses where id = v_p.business_id;
  if p_template not in ('special', 'custom') then
    raise exception 'Choose the message' using errcode = '22023';
  end if;
  if p_template = 'custom' and v_role <> 'owner' and not v_role = any (v_free_text) then
    raise exception 'Writing your own messages is turned off for your role; send the suggested message' using errcode = '42501', hint = 'free_text';
  end if;
  select l.timezone into v_tz from public.locations l where l.business_id = v_p.business_id order by l.created_at limit 1;
  if v_p.archived_at is not null or (v_p.ends_on is not null and (now() at time zone v_tz)::date > v_p.ends_on) then
    raise exception '% has ended', v_p.name using errcode = '55000';
  end if;
  select * into v_client from public.clients where id = p_client_id and business_id = v_p.business_id;
  if v_client.id is null then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if not private.message_channel_ok(v_client, 'marketing', p_channel) then
    raise exception 'The client doesn''t get offers by %', case when p_channel = 'sms' then 'text' else 'email' end using errcode = '55000', hint = 'channel';
  end if;
  v_minute := extract(hour from now() at time zone v_tz)::int * 60 + extract(minute from now() at time zone v_tz)::int;
  if v_minute < 9 * 60 or v_minute >= 20 * 60 then
    raise exception 'Offers go out between 9am and 8pm' using errcode = '55000', hint = 'hours';
  end if;
  if exists (select 1 from public.marketing_messages where client_id = v_client.id and kind <> 'review' and sent_at > now() - interval '7 days') then
    raise exception 'They had an offer or reminder from us this week' using errcode = '55000', hint = 'quiet';
  end if;
  if length(v_body) not between 1 and 1000 then
    raise exception 'Write a message (up to 1,000 characters)' using errcode = '22023';
  end if;
  if coalesce(p_opt_out_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Offers need their unsubscribe link' using errcode = '22023';
  end if;
  if p_channel = 'sms' and v_body !~* 'reply stop' then
    v_body := v_body || ' Reply STOP to stop texts.';
  end if;
  v_to := case when p_channel = 'sms' then v_client.phone_digits else v_client.email end;
  begin
    insert into public.marketing_messages (business_id, kind, client_id, cycle_key, channel, to_address, subject, body, opt_out_token_hash)
    values (v_p.business_id, 'promotion', v_client.id, 'promotion:' || v_p.id, p_channel, v_to, case when p_channel = 'email' then left(btrim(coalesce(p_subject, '')), 120) end, v_body, p_opt_out_hash)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'They already have this offer' using errcode = '55000', hint = 'sent';
  end;
  insert into public.outbox_messages (business_id, channel, to_address, subject, body)
  values (v_p.business_id, p_channel, v_to, case when p_channel = 'email' then left(btrim(coalesce(p_subject, '')), 120) end, v_body)
  returning id into v_outbox;
  update public.marketing_messages set outbox_message_id = v_outbox where id = v_id;
  insert into public.client_messages (business_id, client_id, purpose, template, channel, subject, body, sent_by, outbox_id, promotion_id)
  values (v_p.business_id, v_client.id, 'marketing', p_template, p_channel, case when p_channel = 'email' then left(btrim(coalesce(p_subject, '')), 120) end, v_body, v_staff, v_outbox, v_p.id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Which of these clients had an offer or reminder from us in the last
-- week (so Denise doesn't suggest them): front of house.
create function public.recent_offer_clients(p_business_id uuid, p_client_ids uuid[])
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.front_of_house(p_business_id) then
    raise exception 'Only the front of house can see this' using errcode = '42501';
  end if;
  return query
    select distinct client_id from public.marketing_messages
    where business_id = p_business_id and client_id = any (p_client_ids) and kind <> 'review' and sent_at > now() - interval '7 days';
end;
$$;

revoke all on function public.recent_offer_clients(uuid, uuid[]) from public, anon;
grant execute on function public.recent_offer_clients(uuid, uuid[]) to authenticated;
revoke all on function private.promotion_applies(public.promotions, text, uuid, text, uuid, public.staff_level, uuid) from public;
revoke all on function private.visited_before(uuid, uuid) from public;
revoke all on function private.money_text(integer) from public;
revoke all on function private.promotion_problem(public.promotions, text, uuid, uuid, integer, date) from public;
revoke all on function private.on_sale_voided_promotions() from public;
revoke all on function public.save_promotion(uuid, uuid, jsonb) from public, anon;
revoke all on function public.archive_promotion(uuid) from public, anon;
revoke all on function public.attach_online_promotion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.send_promotion_message(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.save_promotion(uuid, uuid, jsonb) to authenticated;
grant execute on function public.archive_promotion(uuid) to authenticated;
grant execute on function public.attach_online_promotion(uuid, uuid) to service_role;
grant execute on function public.send_promotion_message(uuid, uuid, text, text, text, text, text) to authenticated;
