-- Bridal and events, stage 1: fast setup.
--
-- Owners set up reusable event packages ("Bride hair + makeup",
-- "Bridesmaid hair", "Trial"…: a price and how long the hair and the makeup
-- take, which says who can do it) and the salon's bridal settings (deposit,
-- service charge, travel and early-start fees, the headcount cutoff, the
-- payment schedule and the contract terms, each change of terms kept as a
-- version). Stylists say which event work they do (hair, makeup).
--
-- An event is a date, a ready-by time, where it is, the party (a row per
-- person with their package, its price and lengths copied when it's chosen)
-- and the timeline the app worked out (a task per person and service, on an
-- artist "lane", with the stylist when one's assigned, and a touch-up at the
-- end). Written only through save_event (front of house), which prices it
-- (private.price_event, the same arithmetic as lib/events/pricing.ts) and
-- logs it; online inquiries come in through save_event_inquiry (service
-- role). Everything starts as an Inquiry.

create type public.event_status as enum ('inquiry', 'proposal_sent', 'booked', 'trial_done', 'completed', 'lost');
create type public.event_party_role as enum ('bride', 'bridesmaid', 'maid_of_honor', 'mother', 'flower_girl', 'groom', 'guest');

-- Which event work a stylist does.
alter table public.staff
  add column event_roles text[] not null default '{}' check (event_roles <@ array['hair', 'makeup']::text[]);

create function public.set_staff_event_roles(p_staff_id uuid, p_roles text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.staff where id = p_staff_id;
  if v_business is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if not private.can(v_business, 'team') then
    raise exception 'Only those who manage the team can change this' using errcode = '42501';
  end if;
  update public.staff
  set event_roles = array(select distinct r from unnest(coalesce(p_roles, '{}')) r where r in ('hair', 'makeup') order by r)
  where id = p_staff_id;
end;
$$;

-- Reusable packages for event parties.
create table public.event_packages (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  -- Who it's usually for, so a party member gets it by default.
  party_role      public.event_party_role,
  hair_minutes    smallint not null default 0 check (hair_minutes between 0 and 480 and hair_minutes % 5 = 0),
  makeup_minutes  smallint not null default 0 check (makeup_minutes between 0 and 480 and makeup_minutes % 5 = 0),
  price_cents     integer not null check (price_cents between 0 and 10000000),
  -- A trial: booked as a visit before the event, not part of the day.
  is_trial        boolean not null default false,
  is_active       boolean not null default true,
  position        smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (hair_minutes + makeup_minutes > 0),
  unique (id, business_id)
);

create index event_packages_business_idx on public.event_packages (business_id, position);
create trigger event_packages_set_updated_at before update on public.event_packages for each row execute function public.set_updated_at();
alter table public.event_packages enable row level security;
create policy "Members can view event packages" on public.event_packages
  for select to authenticated using ((select private.is_business_member(business_id)));

-- The salon's bridal settings (one row per salon).
create table public.event_settings (
  business_id              uuid primary key references public.businesses (id) on delete cascade,
  -- Percent of the bill paid to book, and whether it can be given back.
  deposit_pct              smallint not null default 30 check (deposit_pct between 0 and 100),
  deposit_refundable       boolean not null default false,
  -- Automatic service charge or gratuity on the services, and the share
  -- that goes to the team (as tips, split by their part of the work).
  service_charge_pct       smallint not null default 20 check (service_charge_pct between 0 and 50),
  service_charge_team_pct  smallint not null default 100 check (service_charge_team_pct between 0 and 100),
  -- On-location travel: a base fee, free miles, then a fee per mile; the
  -- team's share; and the travel time held each way on their calendars.
  travel_fee_cents         integer not null default 7500 check (travel_fee_cents between 0 and 100000),
  travel_free_miles        smallint not null default 10 check (travel_free_miles between 0 and 500),
  travel_per_mile_cents    integer not null default 150 check (travel_per_mile_cents between 0 and 10000),
  travel_team_pct          smallint not null default 50 check (travel_team_pct between 0 and 100),
  travel_minutes           smallint not null default 30 check (travel_minutes between 0 and 240 and travel_minutes % 5 = 0),
  -- A fee per artist starting before this time (minutes since midnight).
  early_start_minute       smallint not null default 420 check (early_start_minute between 0 and 1435 and early_start_minute % 5 = 0),
  early_start_fee_cents    integer not null default 5000 check (early_start_fee_cents between 0 and 100000),
  -- Party changes after this many days before the event need a manager.
  headcount_cutoff_days    smallint not null default 14 check (headcount_cutoff_days between 0 and 365),
  -- The payment schedule: the deposit at booking, an optional second
  -- payment, and the balance, charged this many days before the event.
  second_payment_pct       smallint not null default 0 check (second_payment_pct between 0 and 100),
  second_payment_days      smallint not null default 30 check (second_payment_days between 1 and 365),
  final_payment_days       smallint not null default 7 check (final_payment_days between 0 and 365),
  -- The timeline: a gap between each person, and a touch-up at the end.
  buffer_minutes           smallint not null default 10 check (buffer_minutes between 0 and 60 and buffer_minutes % 5 = 0),
  touch_up_minutes         smallint not null default 15 check (touch_up_minutes between 0 and 60 and touch_up_minutes % 5 = 0),
  -- The service a trial is booked as.
  trial_service_id         uuid references public.services (id) on delete set null,
  inquiries_enabled        boolean not null default true,
  updated_at               timestamptz not null default now(),
  check (deposit_pct + second_payment_pct <= 100)
);

alter table public.event_settings enable row level security;
create policy "Members can view event settings" on public.event_settings
  for select to authenticated using ((select private.is_business_member(business_id)));

-- Contract terms: every version kept, so an agreement points at the exact
-- words. "{salon}" is filled in with the salon's name when shown.
create table public.event_terms (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  version      integer not null,
  body         text not null check (length(trim(body)) between 20 and 20000),
  created_by   uuid references public.staff (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (business_id, version)
);

alter table public.event_terms enable row level security;
create policy "Members can view event terms" on public.event_terms
  for select to authenticated using ((select private.is_business_member(business_id)));

-- The starter template every salon begins with (and edits).
create function private.starter_event_terms()
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(line, E'\n\n' order by n) from (values
    (1, 'Booking. Your date is held once you have agreed to these terms and paid the deposit. Until then it can be offered to others.'),
    (2, 'Deposit. The deposit comes off your total. It can''t be given back if you cancel, because we turn other work away to keep your date.'),
    (3, 'Payments. Any scheduled payments and the balance are charged to the card you saved, on the dates shown in your proposal. We send a reminder a few days before each one and a receipt after.'),
    (4, 'Your party. You can add or remove people until the headcount cutoff shown in your proposal. After that, changes depend on our team being free and may not lower the total.'),
    (5, 'Timing. We plan the day back from your ready-by time. Please have everyone ready at their time with clean, dry hair and a clean face, unless we agree otherwise.'),
    (6, 'On location. For on-location events, travel fees cover the team''s time on the road. Please give us a well-lit space near power and a place to park.'),
    (7, 'Service charge. The service charge shown in your proposal is added to the services and shared with the team.'),
    (8, 'Cancellation. If you cancel, payments already made are kept, apart from anything we agree in writing. If {salon} has to cancel, everything you paid is given back.'),
    (9, 'Photos. We may take photos of the looks for our records. We only share them with your permission.')
  ) t(n, line);
$$;

insert into public.event_settings (business_id) select id from public.businesses on conflict do nothing;
insert into public.event_terms (business_id, version, body) select id, 1, private.starter_event_terms() from public.businesses;

create function private.new_business_event_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.event_settings (business_id) values (new.id) on conflict do nothing;
  insert into public.event_terms (business_id, version, body) values (new.id, 1, private.starter_event_terms()) on conflict do nothing;
  return new;
end;
$$;

create trigger businesses_event_settings after insert on public.businesses
  for each row execute function private.new_business_event_settings();

create table public.events (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses (id) on delete cascade,
  location_id           uuid not null,
  -- Who it's for (the main client, who signs and pays). An online inquiry
  -- is matched to a client, or adds one.
  client_id             uuid,
  title                 text not null check (length(trim(title)) between 1 and 120),
  status                public.event_status not null default 'inquiry',
  lost_reason           text check (length(lost_reason) <= 300),
  event_date            date not null,
  ready_by              timestamptz,
  venue_name            text check (length(venue_name) <= 200),
  venue_address         text check (length(venue_address) <= 300),
  on_location           boolean not null default false,
  travel_miles          numeric(6, 1) not null default 0 check (travel_miles between 0 and 1000),
  travel_minutes        smallint not null default 0 check (travel_minutes between 0 and 240 and travel_minutes % 5 = 0),
  notes                 text check (length(notes) <= 4000),
  source                text not null default 'desk' check (source in ('desk', 'denise', 'online')),
  -- Everything to the main client, or members paying their own by link.
  billing               text not null default 'main' check (billing in ('main', 'split')),
  -- What an online inquiry said, as they said it.
  inquiry_party_size    smallint check (inquiry_party_size between 1 and 100),
  inquiry_services      text check (length(inquiry_services) <= 500),
  -- The price, worked out by private.price_event.
  subtotal_cents        integer not null default 0,
  travel_fee_cents      integer not null default 0,
  early_fee_cents       integer not null default 0,
  service_charge_cents  integer not null default 0,
  tax_cents             integer not null default 0,
  total_cents           integer not null default 0,
  deposit_cents         integer not null default 0,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  status_changed_at     timestamptz not null default now(),
  unique (id, business_id),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete set null (client_id),
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index events_business_date_idx on public.events (business_id, event_date);
create index events_client_idx on public.events (client_id);
create trigger events_set_updated_at before update on public.events for each row execute function public.set_updated_at();

create table public.event_members (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  event_id        uuid not null,
  position        smallint not null,
  name            text not null check (length(trim(name)) between 1 and 80),
  party_role      public.event_party_role not null,
  package_id      uuid,
  -- The package as it was chosen: price changes later don't touch it.
  package_name    text not null check (length(package_name) <= 120),
  price_cents     integer not null check (price_cents >= 0),
  hair_minutes    smallint not null default 0,
  makeup_minutes  smallint not null default 0,
  -- Pays their own share by link (when the event is split).
  pays_own        boolean not null default false,
  email           text check (length(email) <= 254),
  phone           text check (length(phone) <= 40),
  created_at      timestamptz not null default now(),
  unique (id, business_id),
  unique (event_id, position),
  foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade,
  foreign key (package_id, business_id) references public.event_packages (id, business_id) on delete set null (package_id)
);

create index event_members_event_idx on public.event_members (event_id);

-- The timeline: one task per person and service, on an artist lane (hair 1,
-- hair 2, makeup 1…), with the stylist once one's assigned, and each lane's
-- touch-up at the end (no person).
create table public.event_tasks (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  event_id     uuid not null,
  member_id    uuid,
  kind         text not null check (kind in ('hair', 'makeup', 'touch_up')),
  role         text not null check (role in ('hair', 'makeup')),
  lane         smallint not null check (lane between 1 and 20),
  staff_id     uuid,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  check (ends_at > starts_at),
  check ((member_id is null) = (kind = 'touch_up')),
  foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade,
  foreign key (member_id, business_id) references public.event_members (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete set null (staff_id)
);

create index event_tasks_event_idx on public.event_tasks (event_id);
create index event_tasks_staff_idx on public.event_tasks (staff_id, starts_at);

-- Every step, with who.
create table public.event_history (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  event_id     uuid not null,
  kind         text not null check (kind ~ '^[a-z_]{1,40}$'),
  detail       text check (length(detail) <= 1000),
  staff_id     uuid,
  created_at   timestamptz not null default now(),
  foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete set null (staff_id)
);

create index event_history_event_idx on public.event_history (event_id, created_at);

alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.event_tasks enable row level security;
alter table public.event_history enable row level security;

-- A stylist on an event's timeline sees it (their own book); the front of
-- house sees them all. Nobody writes directly.
create function private.sees_event(p_business uuid, p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.front_of_house(p_business) or exists (
    select 1 from public.event_tasks t
    where t.event_id = p_event and t.business_id = p_business and t.staff_id = any (private.my_book(p_business))
  );
$$;

grant execute on function private.sees_event(uuid, uuid) to authenticated;

create policy "Front of house and the event's team can view events" on public.events
  for select to authenticated using ((select private.sees_event(business_id, id)));
create policy "Front of house and the event's team can view the party" on public.event_members
  for select to authenticated using ((select private.sees_event(business_id, event_id)));
create policy "Front of house and the event's team can view the timeline" on public.event_tasks
  for select to authenticated using ((select private.sees_event(business_id, event_id)));
create policy "Front of house can view event history" on public.event_history
  for select to authenticated using ((select private.front_of_house(business_id)));

-- The price, as lib/events/pricing.ts works it out (integer arithmetic,
-- rounding half up): the party's packages, travel for on-location events
-- (a base fee, then per mile past the free miles, whole miles up), an
-- early-start fee per artist lane starting before the salon's early time,
-- the service charge on the packages, tax at the services rate on the
-- packages and fees, and the deposit on what the main client pays (the
-- total less the shares of members paying their own).
create function private.price_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_settings public.event_settings;
  v_tax_bp integer;
  v_tz text;
  v_subtotal integer;
  v_travel integer := 0;
  v_early integer;
  v_charge integer;
  v_tax integer;
  v_total integer;
  v_own integer;
begin
  select * into v_event from public.events where id = p_event_id;
  select * into v_settings from public.event_settings where business_id = v_event.business_id;
  select b.tax_rate_services_bp into v_tax_bp from public.businesses b where b.id = v_event.business_id;
  select l.timezone into v_tz from public.locations l where l.id = v_event.location_id;

  select coalesce(sum(price_cents), 0) into v_subtotal from public.event_members where event_id = p_event_id;
  if v_event.on_location then
    v_travel := v_settings.travel_fee_cents
      + v_settings.travel_per_mile_cents * greatest(0, ceil(v_event.travel_miles)::integer - v_settings.travel_free_miles);
  end if;
  select v_settings.early_start_fee_cents * count(*) into v_early
  from (
    select lane, role, min(starts_at) as first_start from public.event_tasks where event_id = p_event_id group by lane, role
  ) l
  where extract(hour from l.first_start at time zone v_tz) * 60 + extract(minute from l.first_start at time zone v_tz) < v_settings.early_start_minute;
  v_charge := (v_subtotal * v_settings.service_charge_pct + 50) / 100;
  v_tax := ((v_subtotal + v_travel + v_early) * v_tax_bp + 5000) / 10000;
  v_total := v_subtotal + v_travel + v_early + v_charge + v_tax;
  -- Each member paying their own: their package, its service charge and tax.
  select coalesce(sum(price_cents + (price_cents * v_settings.service_charge_pct + 50) / 100 + (price_cents * v_tax_bp + 5000) / 10000), 0) into v_own
  from public.event_members
  where event_id = p_event_id and pays_own and v_event.billing = 'split';

  update public.events set
    subtotal_cents = v_subtotal,
    travel_fee_cents = v_travel,
    early_fee_cents = v_early,
    service_charge_cents = v_charge,
    tax_cents = v_tax,
    total_cents = v_total,
    deposit_cents = ((v_total - v_own) * v_settings.deposit_pct + 50) / 100
  where id = p_event_id;
end;
$$;

-- Creates or changes an event (front of house): its details, the client
-- (an existing one, or a new one from a name and phone or email), the party
-- and the timeline the app worked out and checked. New events are
-- Inquiries. Once booked, party changes inside the headcount cutoff need
-- an owner or manager (hint 'cutoff').
create function public.save_event(p_event_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.staff;
  v_event public.events;
  v_settings public.event_settings;
  v_id uuid := p_event_id;
  v_client uuid;
  v_date date;
  v_member jsonb;
  v_task jsonb;
  v_package public.event_packages;
  v_pos integer := 0;
  v_ids uuid[] := '{}';
  v_member_ids jsonb := '{}';
  v_member_id uuid;
  v_old_party text;
  v_new_party text;
  v_staff uuid;
begin
  select * into v_me from public.staff s where s.user_id = (select auth.uid()) and s.is_active
    and s.role in ('owner', 'manager', 'front_desk') limit 1;
  if v_me.id is null then
    raise exception 'Only the front desk, managers and owners can set up events' using errcode = '42501';
  end if;
  select * into v_settings from public.event_settings where business_id = v_me.business_id;

  v_date := (p_input ->> 'event_date')::date;
  if v_date is null then
    raise exception 'Choose the date' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_input ->> 'title', ''))) = 0 then
    raise exception 'Give the event a name' using errcode = '22023';
  end if;

  if v_id is not null then
    select * into v_event from public.events where id = v_id and business_id = v_me.business_id for update;
    if v_event.id is null then
      raise exception 'Not found' using errcode = 'P0002';
    end if;
    if v_event.status in ('completed', 'lost') then
      raise exception 'This event is closed' using errcode = '55000';
    end if;
  end if;

  -- The client: chosen, or added from what was typed.
  if nullif(p_input ->> 'client_id', '') is not null then
    select id into v_client from public.clients where id = (p_input ->> 'client_id')::uuid and business_id = v_me.business_id;
    if v_client is null then
      raise exception 'Not found' using errcode = 'P0002';
    end if;
  elsif nullif(trim(p_input #>> '{new_client,first_name}'), '') is not null then
    if nullif(trim(p_input #>> '{new_client,phone}'), '') is null and nullif(trim(p_input #>> '{new_client,email}'), '') is null then
      raise exception 'Add a phone number or email for the client' using errcode = '22023';
    end if;
    insert into public.clients (business_id, first_name, last_name, phone, email)
    values (v_me.business_id, left(trim(p_input #>> '{new_client,first_name}'), 80), left(coalesce(trim(p_input #>> '{new_client,last_name}'), ''), 80),
      nullif(left(trim(p_input #>> '{new_client,phone}'), 40), ''), nullif(lower(left(trim(p_input #>> '{new_client,email}'), 254)), ''))
    returning id into v_client;
  else
    v_client := v_event.client_id;
  end if;
  if v_client is null then
    raise exception 'Choose the client, or add their name and a phone number or email' using errcode = '22023';
  end if;

  -- The party before, to tell whether the headcount changed.
  select string_agg(concat(party_role, ':', package_id, ':', pays_own), ',' order by position) into v_old_party
  from public.event_members where event_id = v_id;
  select string_agg(concat(m ->> 'party_role', ':', m ->> 'package_id', ':', coalesce((m ->> 'pays_own')::boolean, false) and p_input ->> 'billing' = 'split'), ',' order by n)
  into v_new_party
  from jsonb_array_elements(coalesce(p_input -> 'members', '[]')) with ordinality as x(m, n);
  if v_id is not null and v_event.status in ('booked', 'trial_done')
     and current_date > v_event.event_date - v_settings.headcount_cutoff_days
     and v_old_party is distinct from v_new_party
     and v_me.role not in ('owner', 'manager') then
    raise exception 'The headcount cutoff has passed: an owner or manager can change the party now' using errcode = '42501', hint = 'cutoff';
  end if;

  if v_id is null then
    insert into public.events (business_id, location_id, client_id, title, event_date, source, created_by)
    values (v_me.business_id, v_me.location_id, v_client, left(trim(p_input ->> 'title'), 120), v_date,
      case when p_input ->> 'source' in ('denise', 'online') then p_input ->> 'source' else 'desk' end, v_me.id)
    returning id into v_id;
  end if;

  update public.events set
    client_id = v_client,
    title = left(trim(p_input ->> 'title'), 120),
    event_date = v_date,
    ready_by = nullif(p_input ->> 'ready_by', '')::timestamptz,
    venue_name = nullif(left(trim(coalesce(p_input ->> 'venue_name', '')), 200), ''),
    venue_address = nullif(left(trim(coalesce(p_input ->> 'venue_address', '')), 300), ''),
    on_location = coalesce((p_input ->> 'on_location')::boolean, false),
    travel_miles = case when coalesce((p_input ->> 'on_location')::boolean, false) then least(greatest(coalesce((p_input ->> 'travel_miles')::numeric, 0), 0), 1000) else 0 end,
    travel_minutes = case when coalesce((p_input ->> 'on_location')::boolean, false) then coalesce((p_input ->> 'travel_minutes')::smallint, v_settings.travel_minutes) else 0 end,
    notes = nullif(left(coalesce(p_input ->> 'notes', ''), 4000), ''),
    billing = case when p_input ->> 'billing' = 'split' then 'split' else 'main' end
  where id = v_id;

  -- The party, replaced as a whole (the timeline goes with it).
  delete from public.event_tasks where event_id = v_id;
  delete from public.event_members where event_id = v_id;
  for v_member in select * from jsonb_array_elements(coalesce(p_input -> 'members', '[]')) loop
    v_pos := v_pos + 1;
    if v_pos > 40 then
      raise exception 'A party can have up to 40 people' using errcode = '22023';
    end if;
    select * into v_package from public.event_packages
    where id = (v_member ->> 'package_id')::uuid and business_id = v_me.business_id and not is_trial;
    if v_package.id is null then
      raise exception 'Choose a package for everyone in the party' using errcode = '22023';
    end if;
    insert into public.event_members (business_id, event_id, position, name, party_role, package_id, package_name, price_cents, hair_minutes, makeup_minutes, pays_own, email, phone)
    values (v_me.business_id, v_id, v_pos, left(coalesce(nullif(trim(v_member ->> 'name'), ''), 'Guest ' || v_pos), 80),
      (v_member ->> 'party_role')::public.event_party_role, v_package.id, v_package.name, v_package.price_cents,
      v_package.hair_minutes, v_package.makeup_minutes,
      coalesce((v_member ->> 'pays_own')::boolean, false) and p_input ->> 'billing' = 'split',
      nullif(lower(left(trim(coalesce(v_member ->> 'email', '')), 254)), ''), nullif(left(trim(coalesce(v_member ->> 'phone', '')), 40), ''))
    returning id into v_member_id;
    -- The app refers to members by their place in the list.
    v_member_ids := v_member_ids || jsonb_build_object(v_pos::text, v_member_id);
  end loop;

  for v_task in select * from jsonb_array_elements(coalesce(p_input -> 'tasks', '[]')) loop
    v_staff := nullif(v_task ->> 'staff_id', '')::uuid;
    if v_staff is not null and not exists (
      select 1 from public.staff s where s.id = v_staff and s.business_id = v_me.business_id and s.is_active and (v_task ->> 'role') = any (s.event_roles)
    ) then
      raise exception 'Choose someone who does event %', v_task ->> 'role' using errcode = '22023';
    end if;
    insert into public.event_tasks (business_id, event_id, member_id, kind, role, lane, staff_id, starts_at, ends_at)
    values (v_me.business_id, v_id,
      case when v_task ->> 'kind' = 'touch_up' then null else (v_member_ids ->> (v_task ->> 'member'))::uuid end,
      v_task ->> 'kind', v_task ->> 'role', (v_task ->> 'lane')::smallint, v_staff,
      (v_task ->> 'starts_at')::timestamptz, (v_task ->> 'ends_at')::timestamptz);
  end loop;

  perform private.price_event(v_id);
  insert into public.event_history (business_id, event_id, kind, detail, staff_id)
  values (v_me.business_id, v_id,
    case when p_event_id is null then 'created' else 'changed' end,
    case when p_event_id is null and p_input ->> 'source' = 'denise' then left('Drafted by Denise from: ' || coalesce(p_input ->> 'described', ''), 1000)
         when p_event_id is not null and v_old_party is distinct from v_new_party then 'The party changed'
    end,
    v_me.id);
  return v_id;
end;
$$;

-- An inquiry from the booking site (service role): the date, ready-by
-- time, where, party size and services, as they said them, matched to a
-- client by phone or email (or added). Inquiries come in as Inquiry.
create function public.save_event_inquiry(p_business_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location uuid;
  v_client uuid;
  v_id uuid;
  v_first text := left(trim(coalesce(p_input ->> 'first_name', '')), 80);
  v_date date := (p_input ->> 'event_date')::date;
begin
  if not exists (select 1 from public.event_settings where business_id = p_business_id and inquiries_enabled) then
    raise exception 'This salon isn''t taking event inquiries online' using errcode = '55000';
  end if;
  if v_first = '' or v_date is null or v_date < current_date then
    raise exception 'Add your name and a date that hasn''t passed' using errcode = '22023';
  end if;
  select id into v_location from public.locations where business_id = p_business_id order by created_at limit 1;
  v_client := public.find_online_client(p_business_id, p_input ->> 'phone', p_input ->> 'email', v_first, p_input ->> 'last_name', p_input ->> 'phone');
  insert into public.events (business_id, location_id, client_id, title, event_date, ready_by, venue_name, on_location, notes, source, inquiry_party_size, inquiry_services)
  values (p_business_id, v_location, v_client,
    left(concat(v_first, '''s ', coalesce(nullif(p_input ->> 'kind', ''), 'event')), 120), v_date,
    nullif(p_input ->> 'ready_by', '')::timestamptz,
    nullif(left(trim(coalesce(p_input ->> 'venue', '')), 200), ''),
    coalesce((p_input ->> 'on_location')::boolean, false),
    nullif(left(coalesce(p_input ->> 'notes', ''), 4000), ''), 'online',
    (p_input ->> 'party_size')::smallint, nullif(left(coalesce(p_input ->> 'services', ''), 500), ''))
  returning id into v_id;
  insert into public.event_history (business_id, event_id, kind, detail) values (p_business_id, v_id, 'inquiry', 'Sent from the booking site');
  return v_id;
end;
$$;

-- Packages (whoever has the settings permission).
create function public.save_event_package(p_package_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select s.business_id from public.staff s where s.user_id = (select auth.uid()) and s.is_active limit 1);
  v_id uuid;
begin
  if v_business is null or not private.can(v_business, 'settings') then
    raise exception 'Only owners and managers can set up event packages' using errcode = '42501';
  end if;
  if p_package_id is null then
    insert into public.event_packages (business_id, name, party_role, hair_minutes, makeup_minutes, price_cents, is_trial, is_active, position)
    values (v_business, trim(p_input ->> 'name'), nullif(p_input ->> 'party_role', '')::public.event_party_role,
      coalesce((p_input ->> 'hair_minutes')::smallint, 0), coalesce((p_input ->> 'makeup_minutes')::smallint, 0),
      (p_input ->> 'price_cents')::integer, coalesce((p_input ->> 'is_trial')::boolean, false), coalesce((p_input ->> 'is_active')::boolean, true),
      coalesce((select max(position) + 1 from public.event_packages where business_id = v_business), 0))
    returning id into v_id;
  else
    update public.event_packages set
      name = trim(p_input ->> 'name'),
      party_role = nullif(p_input ->> 'party_role', '')::public.event_party_role,
      hair_minutes = coalesce((p_input ->> 'hair_minutes')::smallint, 0),
      makeup_minutes = coalesce((p_input ->> 'makeup_minutes')::smallint, 0),
      price_cents = (p_input ->> 'price_cents')::integer,
      is_trial = coalesce((p_input ->> 'is_trial')::boolean, false),
      is_active = coalesce((p_input ->> 'is_active')::boolean, true)
    where id = p_package_id and business_id = v_business
    returning id into v_id;
    if v_id is null then
      raise exception 'Not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- Bridal settings, and the terms (a new version when they change).
create function public.save_event_settings(p_input jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.staff;
  v_terms text := trim(coalesce(p_input ->> 'terms', ''));
begin
  select * into v_me from public.staff s where s.user_id = (select auth.uid()) and s.is_active limit 1;
  if v_me.id is null or not private.can(v_me.business_id, 'settings') then
    raise exception 'Only owners and managers can change bridal settings' using errcode = '42501';
  end if;
  if p_input ? 'trial_service_id' and nullif(p_input ->> 'trial_service_id', '') is not null
     and not exists (select 1 from public.services where id = (p_input ->> 'trial_service_id')::uuid and business_id = v_me.business_id) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  update public.event_settings set
    deposit_pct = (p_input ->> 'deposit_pct')::smallint,
    deposit_refundable = (p_input ->> 'deposit_refundable')::boolean,
    service_charge_pct = (p_input ->> 'service_charge_pct')::smallint,
    service_charge_team_pct = (p_input ->> 'service_charge_team_pct')::smallint,
    travel_fee_cents = (p_input ->> 'travel_fee_cents')::integer,
    travel_free_miles = (p_input ->> 'travel_free_miles')::smallint,
    travel_per_mile_cents = (p_input ->> 'travel_per_mile_cents')::integer,
    travel_team_pct = (p_input ->> 'travel_team_pct')::smallint,
    travel_minutes = (p_input ->> 'travel_minutes')::smallint,
    early_start_minute = (p_input ->> 'early_start_minute')::smallint,
    early_start_fee_cents = (p_input ->> 'early_start_fee_cents')::integer,
    headcount_cutoff_days = (p_input ->> 'headcount_cutoff_days')::smallint,
    second_payment_pct = (p_input ->> 'second_payment_pct')::smallint,
    second_payment_days = (p_input ->> 'second_payment_days')::smallint,
    final_payment_days = (p_input ->> 'final_payment_days')::smallint,
    buffer_minutes = (p_input ->> 'buffer_minutes')::smallint,
    touch_up_minutes = (p_input ->> 'touch_up_minutes')::smallint,
    trial_service_id = nullif(p_input ->> 'trial_service_id', '')::uuid,
    inquiries_enabled = (p_input ->> 'inquiries_enabled')::boolean,
    updated_at = now()
  where business_id = v_me.business_id;
  if v_terms <> '' and v_terms is distinct from (select body from public.event_terms where business_id = v_me.business_id order by version desc limit 1) then
    insert into public.event_terms (business_id, version, body, created_by)
    values (v_me.business_id, (select coalesce(max(version), 0) + 1 from public.event_terms where business_id = v_me.business_id), v_terms, v_me.id);
  end if;
end;
$$;

revoke all on function public.save_event(uuid, jsonb) from public, anon;
revoke all on function public.save_event_package(uuid, jsonb) from public, anon;
revoke all on function public.save_event_settings(jsonb) from public, anon;
revoke all on function public.set_staff_event_roles(uuid, text[]) from public, anon;
revoke all on function public.save_event_inquiry(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.price_event(uuid) from public;
grant execute on function public.save_event_inquiry(uuid, jsonb) to service_role;

-- Inspiration photos (from an inquiry) and, later, photos of the look:
-- files in the private `event-photos` bucket under <business>/<event>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Front of house can see event photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'event-photos' and (select private.front_of_house(private.logo_business(name))));
create policy "Front of house can add event photo files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'event-photos' and (select private.front_of_house(private.logo_business(name))));

create table public.event_photos (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  event_id      uuid not null,
  kind          text not null check (kind in ('inspiration', 'look')),
  storage_path  text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade,
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index event_photos_event_idx on public.event_photos (event_id);
alter table public.event_photos enable row level security;
create policy "Front of house and the event's team can view event photos" on public.event_photos
  for select to authenticated using ((select private.sees_event(business_id, event_id)));

-- An inquiry's photos, added with the service role once the files are up.
create function public.add_inquiry_photos(p_event_id uuid, p_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.events where id = p_event_id and source = 'online');
begin
  if v_business is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  insert into public.event_photos (business_id, event_id, kind, storage_path)
  select v_business, p_event_id, 'inspiration', p
  from unnest(p_paths[1:6]) p
  where split_part(p, '/', 1) = v_business::text and split_part(p, '/', 2) = p_event_id::text
    and exists (select 1 from storage.objects o where o.bucket_id = 'event-photos' and o.name = p);
end;
$$;

revoke all on function public.add_inquiry_photos(uuid, text[]) from public, anon, authenticated;
grant execute on function public.add_inquiry_photos(uuid, text[]) to service_role;
