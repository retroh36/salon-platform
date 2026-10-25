-- Bridal and events, stage 2: the proposal, the contract and the money.
--
-- * event_links: secure links (only the token's sha256 is stored) the desk
--   sends: a proposal to the main client (the party, services, total,
--   payment schedule and the terms version it was sent with), a member's
--   own share to pay when the event is split, or a new card after a
--   payment didn't go through.
-- * event_agreements: exactly what the client agreed to: the typed name,
--   when, the terms text of that version, and the totals and schedule then.
-- * event_payments: every payment, scheduled or taken: the deposit to book,
--   the second payment and balance charged to the card on file before the
--   event, members paying their own, with what happened to each (paid,
--   failed with the reason, canceled). Charging goes through the payment
--   provider layer in the app (lib/events/billing.ts, service role),
--   recorded with record_event_charge; nothing here talks to a provider.
--
-- The schedule is worked out here the same way as remainingSchedule in
-- lib/events/pricing.ts (tests check they agree), and again whenever a
-- booked event's party changes (private.after_event_saved).

alter table public.events
  -- What the main client pays (the total less members paying their own).
  add column main_cents   integer not null default 0,
  add column booked_at    timestamptz,
  -- The card the scheduled payments are charged to: a provider token and
  -- its label, never a number.
  add column card_provider text,
  add column card_ref      text check (length(card_ref) <= 200),
  add column card_label    text check (length(card_label) <= 60);

create table public.event_links (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  event_id     uuid not null,
  -- A member's own share; null for the proposal.
  member_id    uuid,
  -- The proposal, a member's own share, or a new card after a failed payment.
  kind         text not null check (kind in ('proposal', 'member', 'card')),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  terms_id     uuid references public.event_terms (id),
  status       text not null default 'open' check (status in ('open', 'done', 'canceled')),
  channel      text not null check (channel in ('sms', 'email')),
  sent_to      text not null check (length(sent_to) <= 254),
  expires_at   timestamptz not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  done_at      timestamptz,
  check ((kind = 'member') = (member_id is not null)),
  check (kind <> 'proposal' or terms_id is not null),
  foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade,
  foreign key (member_id, business_id) references public.event_members (id, business_id) on delete cascade,
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create unique index event_links_one_open_idx on public.event_links (event_id, kind, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open';

create table public.event_agreements (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  event_id      uuid not null,
  link_id       uuid references public.event_links (id) on delete set null,
  terms_id      uuid not null references public.event_terms (id),
  terms_version integer not null,
  terms_text    text not null,
  typed_name    text not null check (length(trim(typed_name)) between 2 and 120),
  total_cents   integer not null,
  deposit_cents integer not null,
  schedule      jsonb not null,
  ip_hash       text check (length(ip_hash) <= 128),
  agreed_at     timestamptz not null default now(),
  foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade
);

create index event_agreements_event_idx on public.event_agreements (event_id);

create table public.event_payments (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  event_id            uuid not null,
  member_id           uuid,
  -- Kept when the member is later taken off the party.
  member_name         text check (length(member_name) <= 80),
  kind                text not null check (kind in ('deposit', 'second', 'final', 'member')),
  amount_cents        integer not null check (amount_cents > 0),
  status              text not null check (status in ('scheduled', 'paid', 'failed', 'canceled')),
  due_on              date not null,
  -- Claimed for charging until then (so two runs never charge one twice).
  charge_after        timestamptz,
  attempts            smallint not null default 0,
  provider            text,
  provider_reference  text check (length(provider_reference) <= 200),
  card_label          text check (length(card_label) <= 60),
  failure_reason      text check (length(failure_reason) <= 200),
  paid_at             timestamptz,
  reminded_at         timestamptz,
  receipt_sent_at     timestamptz,
  created_at          timestamptz not null default now(),
  check (status <> 'paid' or paid_at is not null),
  foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade,
  foreign key (member_id, business_id) references public.event_members (id, business_id) on delete set null (member_id)
);

create index event_payments_event_idx on public.event_payments (event_id);
create index event_payments_due_idx on public.event_payments (due_on) where status = 'scheduled';

alter table public.event_links enable row level security;
alter table public.event_agreements enable row level security;
alter table public.event_payments enable row level security;

-- Money and links are the front of house's; nobody writes directly.
create policy "Front of house see event links" on public.event_links for select to authenticated
  using ((select private.front_of_house(business_id)));
create policy "Front of house see event agreements" on public.event_agreements for select to authenticated
  using ((select private.front_of_house(business_id)));
create policy "Front of house see event payments" on public.event_payments for select to authenticated
  using ((select private.front_of_house(business_id)));

-- ---------------------------------------------------------------------------
-- The price (now with the main client's part) and the schedule
-- ---------------------------------------------------------------------------

create or replace function private.price_event(p_event_id uuid)
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
  select coalesce(sum(private.event_member_share(price_cents, v_settings.service_charge_pct, v_tax_bp)), 0) into v_own
  from public.event_members
  where event_id = p_event_id and pays_own and v_event.billing = 'split';

  update public.events set
    subtotal_cents = v_subtotal,
    travel_fee_cents = v_travel,
    early_fee_cents = v_early,
    service_charge_cents = v_charge,
    tax_cents = v_tax,
    total_cents = v_total,
    main_cents = v_total - v_own,
    deposit_cents = ((v_total - v_own) * v_settings.deposit_pct + 50) / 100
  where id = p_event_id;
end;
$$;

-- A member paying their own: their package, its service charge and tax
-- (memberShare in lib/events/pricing.ts).
create function private.event_member_share(p_price integer, p_charge_pct integer, p_tax_bp integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select p_price + (p_price * p_charge_pct + 50) / 100 + (p_price * p_tax_bp + 5000) / 10000;
$$;

-- The salon's today, where the event is.
create function private.event_today(p_event_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone l.timezone)::date
  from public.events e join public.locations l on l.id = e.location_id
  where e.id = p_event_id;
$$;

-- What's left for the main client to pay, scheduled again (at booking,
-- and whenever a booked event's total changes): unpaid scheduled and
-- failed payments are canceled and replaced. The second payment (if the
-- salon uses one and it was due after booking) and the balance, each due
-- on its day or today if that's passed. Overpaid leaves nothing scheduled.
create function private.schedule_event_payments(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_settings public.event_settings;
  v_today date := private.event_today(p_event_id);
  v_booked date;
  v_paid integer;
  v_second_due date;
  v_final_due date;
  v_second integer := 0;
  v_final integer;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.status not in ('booked', 'trial_done') then
    return;
  end if;
  select * into v_settings from public.event_settings where business_id = v_event.business_id;
  select (v_event.booked_at at time zone l.timezone)::date into v_booked from public.locations l where l.id = v_event.location_id;

  update public.event_payments set status = 'canceled', charge_after = null
  where event_id = p_event_id and kind <> 'member' and status in ('scheduled', 'failed');

  select coalesce(sum(amount_cents), 0) into v_paid from public.event_payments
  where event_id = p_event_id and kind <> 'member' and status = 'paid';

  v_second_due := v_event.event_date - v_settings.second_payment_days;
  v_final_due := v_event.event_date - v_settings.final_payment_days;
  if v_settings.second_payment_pct > 0 and v_second_due > v_booked
     and not exists (select 1 from public.event_payments where event_id = p_event_id and kind = 'second' and status = 'paid') then
    v_second := least((v_event.main_cents * v_settings.second_payment_pct + 50) / 100, greatest(0, v_event.main_cents - v_paid));
  end if;
  v_final := greatest(0, v_event.main_cents - v_paid - v_second);

  if v_second > 0 then
    insert into public.event_payments (business_id, event_id, kind, amount_cents, status, due_on)
    values (v_event.business_id, p_event_id, 'second', v_second, 'scheduled', greatest(v_second_due, v_today));
  end if;
  if v_final > 0 then
    insert into public.event_payments (business_id, event_id, kind, amount_cents, status, due_on)
    values (v_event.business_id, p_event_id, 'final', v_final, 'scheduled', greatest(v_final_due, v_today));
  end if;
end;
$$;

-- After every save: a booked event's schedule follows its new total.
create function private.after_event_saved(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.schedule_event_payments(p_event_id);
end;
$$;

-- save_event again, keeping each member who's still in the party (by id),
-- so their pay links and payments stay theirs, then after_event_saved.
create or replace function public.save_event(p_event_id uuid, p_input jsonb)
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
  v_member_ids jsonb := '{}';
  v_member_id uuid;
  v_keep uuid[];
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

  select string_agg(concat(party_role, ':', package_id, ':', pays_own), ',' order by position) into v_old_party
  from public.event_members where event_id = v_id;
  select string_agg(concat(m ->> 'party_role', ':', m ->> 'package_id', ':', coalesce((m ->> 'pays_own')::boolean, false) and p_input ->> 'billing' = 'split'), ',' order by n)
  into v_new_party
  from jsonb_array_elements(coalesce(p_input -> 'members', '[]')) with ordinality as x(m, n);
  if v_id is not null and v_event.status in ('booked', 'trial_done')
     and private.event_today(v_id) > v_event.event_date - v_settings.headcount_cutoff_days
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

  -- The timeline is replaced as a whole; members still in the party keep
  -- their row (their links and payments), the rest are taken off.
  delete from public.event_tasks where event_id = v_id;
  select coalesce(array_agg((m ->> 'id')::uuid), '{}') into v_keep
  from jsonb_array_elements(coalesce(p_input -> 'members', '[]')) m
  where (m ->> 'id') ~ '^[0-9a-f-]{36}$';
  delete from public.event_members where event_id = v_id and id <> all (v_keep);
  update public.event_members set position = -position where event_id = v_id;

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
    v_member_id := null;
    if (v_member ->> 'id') ~ '^[0-9a-f-]{36}$' then
      -- The package's price as it was chosen stays, unless it's another package.
      update public.event_members m set
        position = v_pos,
        name = left(coalesce(nullif(trim(v_member ->> 'name'), ''), 'Guest ' || v_pos), 80),
        party_role = (v_member ->> 'party_role')::public.event_party_role,
        package_name = case when m.package_id = v_package.id then m.package_name else v_package.name end,
        price_cents = case when m.package_id = v_package.id then m.price_cents else v_package.price_cents end,
        hair_minutes = case when m.package_id = v_package.id then m.hair_minutes else v_package.hair_minutes end,
        makeup_minutes = case when m.package_id = v_package.id then m.makeup_minutes else v_package.makeup_minutes end,
        package_id = v_package.id,
        pays_own = coalesce((v_member ->> 'pays_own')::boolean, false) and p_input ->> 'billing' = 'split',
        email = nullif(lower(left(trim(coalesce(v_member ->> 'email', '')), 254)), ''),
        phone = nullif(left(trim(coalesce(v_member ->> 'phone', '')), 40), '')
      where m.id = (v_member ->> 'id')::uuid and m.event_id = v_id
      returning m.id into v_member_id;
    end if;
    if v_member_id is null then
      insert into public.event_members (business_id, event_id, position, name, party_role, package_id, package_name, price_cents, hair_minutes, makeup_minutes, pays_own, email, phone)
      values (v_me.business_id, v_id, v_pos, left(coalesce(nullif(trim(v_member ->> 'name'), ''), 'Guest ' || v_pos), 80),
        (v_member ->> 'party_role')::public.event_party_role, v_package.id, v_package.name, v_package.price_cents,
        v_package.hair_minutes, v_package.makeup_minutes,
        coalesce((v_member ->> 'pays_own')::boolean, false) and p_input ->> 'billing' = 'split',
        nullif(lower(left(trim(coalesce(v_member ->> 'email', '')), 254)), ''), nullif(left(trim(coalesce(v_member ->> 'phone', '')), 40), ''))
      returning id into v_member_id;
    end if;
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
  perform private.after_event_saved(v_id);
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

-- ---------------------------------------------------------------------------
-- The pipeline
-- ---------------------------------------------------------------------------

-- Moves an event along by hand (front of house): Lost (with a reason;
-- open links and scheduled payments are canceled), reopened from Lost as
-- an Inquiry, or between Booked and Trial done. Proposal sent and Booked
-- come from sending the proposal and the client agreeing.
create function public.set_event_status(p_event_id uuid, p_status public.event_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_me uuid;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null or not private.front_of_house(v_event.business_id) then
    raise exception 'Only the front desk, managers and owners can change events' using errcode = '42501';
  end if;
  select s.id into v_me from public.staff s where s.user_id = (select auth.uid()) and s.business_id = v_event.business_id and s.is_active limit 1;
  if p_status = v_event.status then
    return;
  end if;
  if p_status = 'lost' then
    if v_event.status = 'completed' then
      raise exception 'This event is completed' using errcode = '55000';
    end if;
    if length(trim(coalesce(p_reason, ''))) = 0 then
      raise exception 'Say why it was lost' using errcode = '22023';
    end if;
    update public.event_links set status = 'canceled' where event_id = p_event_id and status = 'open';
    update public.event_payments set status = 'canceled', charge_after = null where event_id = p_event_id and status in ('scheduled', 'failed');
  elsif p_status = 'inquiry' then
    if v_event.status <> 'lost' then
      raise exception 'Only a lost event can be reopened' using errcode = '55000';
    end if;
  elsif p_status in ('booked', 'trial_done') then
    if v_event.status not in ('booked', 'trial_done') then
      raise exception 'An event is booked when the client agrees to the proposal' using errcode = '55000';
    end if;
  else
    raise exception 'That can''t be set by hand' using errcode = '55000';
  end if;
  update public.events set status = p_status, status_changed_at = now(),
    lost_reason = case when p_status = 'lost' then left(trim(p_reason), 300) else null end
  where id = p_event_id;
  insert into public.event_history (business_id, event_id, kind, detail, staff_id)
  values (v_event.business_id, p_event_id, 'status_' || p_status::text, case when p_status = 'lost' then left(trim(p_reason), 300) end, v_me);
end;
$$;

-- The proposal (front of house): a link to the main client with the party,
-- services, total, payment schedule and the current terms. Any open
-- proposal link is canceled first; the event is then Proposal sent.
create function public.send_event_proposal(p_event_id uuid, p_token_hash text, p_channel text, p_to text, p_days integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_me uuid;
  v_terms uuid;
  v_id uuid;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null or not private.front_of_house(v_event.business_id) then
    raise exception 'Only the front desk, managers and owners can send proposals' using errcode = '42501';
  end if;
  if v_event.status not in ('inquiry', 'proposal_sent') then
    raise exception 'This event is already booked' using errcode = '55000';
  end if;
  if v_event.client_id is null or v_event.total_cents <= 0 or not exists (select 1 from public.event_members where event_id = p_event_id) then
    raise exception 'Add the client and the party before sending a proposal' using errcode = '55000';
  end if;
  if v_event.event_date <= private.event_today(p_event_id) then
    raise exception 'The event date has passed' using errcode = '55000';
  end if;
  select id into v_terms from public.event_terms where business_id = v_event.business_id order by version desc limit 1;
  select s.id into v_me from public.staff s where s.user_id = (select auth.uid()) and s.business_id = v_event.business_id and s.is_active limit 1;

  update public.event_links set status = 'canceled' where event_id = p_event_id and kind = 'proposal' and status = 'open';
  insert into public.event_links (business_id, event_id, kind, token_hash, terms_id, channel, sent_to, expires_at, created_by)
  values (v_event.business_id, p_event_id, 'proposal', p_token_hash, v_terms, p_channel, left(trim(p_to), 254),
    now() + make_interval(days => least(greatest(p_days, 1), 60)), v_me)
  returning id into v_id;
  update public.events set status = 'proposal_sent', status_changed_at = case when status <> 'proposal_sent' then now() else status_changed_at end
  where id = p_event_id;
  insert into public.event_history (business_id, event_id, kind, detail, staff_id)
  values (v_event.business_id, p_event_id, 'proposal_sent', left('To ' || trim(p_to), 300), v_me);
  return v_id;
end;
$$;

-- The client agreed (service role, from the proposal page): what they
-- agreed to is kept exactly (the terms version the link was sent with, the
-- typed name, the totals and schedule), the card is kept on the event, the
-- deposit (charged by the app just before) is recorded, the event is
-- Booked and the rest of the schedule is set. Refuses a link that isn't
-- open, an event that changed price since the page was shown, or a
-- deposit that isn't the event's.
create function public.accept_event_proposal(p_link_id uuid, p_input jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.event_links;
  v_event public.events;
  v_terms public.event_terms;
  v_staff uuid;
  v_client public.clients;
  v_salon text;
begin
  select * into v_link from public.event_links where id = p_link_id for update;
  if v_link.id is null or v_link.kind <> 'proposal' then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if v_link.status = 'done' then
    raise exception 'Already agreed' using errcode = '55000', hint = 'used';
  end if;
  if v_link.status <> 'open' or v_link.expires_at <= now() then
    raise exception 'This link is no longer active' using errcode = '55000', hint = 'expired';
  end if;
  select * into v_event from public.events where id = v_link.event_id for update;
  if v_event.status <> 'proposal_sent' then
    raise exception 'This link is no longer active' using errcode = '55000', hint = 'expired';
  end if;
  if (p_input ->> 'total_cents')::integer is distinct from v_event.total_cents
     or coalesce((p_input #>> '{deposit,amount_cents}')::integer, 0) <> v_event.deposit_cents then
    raise exception 'The proposal changed' using errcode = '55000', hint = 'changed';
  end if;
  if length(trim(coalesce(p_input ->> 'typed_name', ''))) < 2 then
    raise exception 'Type your full name to agree' using errcode = '22023';
  end if;
  select * into v_terms from public.event_terms where id = v_link.terms_id;
  select name into v_salon from public.businesses where id = v_event.business_id;

  update public.events set status = 'booked', status_changed_at = now(), booked_at = now(),
    card_provider = p_input #>> '{card,provider}', card_ref = left(p_input #>> '{card,ref}', 200), card_label = left(p_input #>> '{card,label}', 60)
  where id = v_event.id;
  if v_event.deposit_cents > 0 then
    insert into public.event_payments (business_id, event_id, kind, amount_cents, status, due_on, provider, provider_reference, card_label, paid_at, attempts)
    values (v_event.business_id, v_event.id, 'deposit', v_event.deposit_cents, 'paid', private.event_today(v_event.id),
      p_input #>> '{deposit,provider}', left(p_input #>> '{deposit,reference}', 200), left(p_input #>> '{card,label}', 60), now(), 1);
  end if;
  perform private.schedule_event_payments(v_event.id);
  insert into public.event_agreements (business_id, event_id, link_id, terms_id, terms_version, terms_text, typed_name, total_cents, deposit_cents, schedule, ip_hash)
  values (v_event.business_id, v_event.id, v_link.id, v_terms.id, v_terms.version, replace(v_terms.body, '{salon}', v_salon), left(trim(p_input ->> 'typed_name'), 120),
    v_event.total_cents, v_event.deposit_cents,
    coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amount_cents', amount_cents, 'due_on', due_on) order by due_on, kind)
              from public.event_payments where event_id = v_event.id and kind <> 'member' and status in ('paid', 'scheduled')), '[]'),
    left(p_input ->> 'ip_hash', 128));
  update public.event_links set status = 'done', done_at = now() where id = v_link.id;
  insert into public.event_history (business_id, event_id, kind, detail)
  values (v_event.business_id, v_event.id, 'booked', left(concat('Agreed to the terms (version ', v_terms.version, ') as ', trim(p_input ->> 'typed_name'),
    case when v_event.deposit_cents > 0 then concat(' and paid the ', to_char(v_event.deposit_cents / 100.0, 'FM$999,990.00'), ' deposit') end), 1000));
  -- The desk and owners hear about it (recorded until email is connected).
  select * into v_client from public.clients where id = v_event.client_id;
  for v_staff in select s.id from public.staff s where s.business_id = v_event.business_id and s.is_active and s.role in ('owner', 'manager', 'front_desk') loop
    insert into public.notifications (business_id, location_id, staff_id, channel, template, body)
    values (v_event.business_id, v_event.location_id, v_staff, 'email', 'event_booked',
      left(concat(v_client.first_name, ' ', v_client.last_name, ' booked ', v_event.title, ' and agreed to the terms.'), 1000));
  end loop;
end;
$$;

-- A member's own share by link (front of house, a split event that's
-- booked): their package, its service charge and tax.
create function public.send_event_member_link(p_member_id uuid, p_token_hash text, p_channel text, p_to text, p_days integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.event_members;
  v_event public.events;
  v_me uuid;
  v_id uuid;
begin
  select * into v_member from public.event_members where id = p_member_id;
  select * into v_event from public.events where id = v_member.event_id;
  if v_event.id is null or not private.front_of_house(v_event.business_id) then
    raise exception 'Only the front desk, managers and owners can send pay links' using errcode = '42501';
  end if;
  if v_event.status not in ('booked', 'trial_done') or not v_member.pays_own then
    raise exception 'Pay links are for members paying their own, once the event is booked' using errcode = '55000';
  end if;
  if exists (select 1 from public.event_payments where member_id = p_member_id and status = 'paid') then
    raise exception 'They''ve already paid' using errcode = '55000';
  end if;
  select s.id into v_me from public.staff s where s.user_id = (select auth.uid()) and s.business_id = v_event.business_id and s.is_active limit 1;
  update public.event_links set status = 'canceled' where member_id = p_member_id and status = 'open';
  insert into public.event_links (business_id, event_id, member_id, kind, token_hash, channel, sent_to, expires_at, created_by)
  values (v_event.business_id, v_event.id, p_member_id, 'member', p_token_hash, p_channel, left(trim(p_to), 254),
    now() + make_interval(days => least(greatest(p_days, 1), 60)), v_me)
  returning id into v_id;
  insert into public.event_history (business_id, event_id, kind, detail, staff_id)
  values (v_event.business_id, v_event.id, 'member_link_sent', left(concat('Pay link for ', v_member.name, ' to ', trim(p_to)), 300), v_me);
  return v_id;
end;
$$;

-- A member paid their share (service role, from their page, charged by the
-- app just before). Refuses if the share isn't what's owed now.
create function public.pay_event_member(p_link_id uuid, p_payment jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.event_links;
  v_member public.event_members;
  v_event public.events;
  v_settings public.event_settings;
  v_tax_bp integer;
begin
  select * into v_link from public.event_links where id = p_link_id for update;
  if v_link.id is null or v_link.kind <> 'member' then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if v_link.status = 'done' then
    raise exception 'Already paid' using errcode = '55000', hint = 'used';
  end if;
  if v_link.status <> 'open' or v_link.expires_at <= now() then
    raise exception 'This link is no longer active' using errcode = '55000', hint = 'expired';
  end if;
  select * into v_member from public.event_members where id = v_link.member_id;
  select * into v_event from public.events where id = v_link.event_id;
  select * into v_settings from public.event_settings where business_id = v_event.business_id;
  select tax_rate_services_bp into v_tax_bp from public.businesses where id = v_event.business_id;
  if v_event.status not in ('booked', 'trial_done') or not v_member.pays_own
     or (p_payment ->> 'amount_cents')::integer is distinct from private.event_member_share(v_member.price_cents, v_settings.service_charge_pct, v_tax_bp) then
    raise exception 'What''s owed changed' using errcode = '55000', hint = 'changed';
  end if;
  insert into public.event_payments (business_id, event_id, member_id, member_name, kind, amount_cents, status, due_on, provider, provider_reference, card_label, paid_at, attempts)
  values (v_event.business_id, v_event.id, v_member.id, v_member.name, 'member', (p_payment ->> 'amount_cents')::integer, 'paid', private.event_today(v_event.id),
    p_payment ->> 'provider', left(p_payment ->> 'reference', 200), left(p_payment ->> 'card_label', 60), now(), 1);
  update public.event_links set status = 'done', done_at = now() where id = v_link.id;
  insert into public.event_history (business_id, event_id, kind, detail)
  values (v_event.business_id, v_event.id, 'member_paid', left(concat(v_member.name, ' paid their ', to_char((p_payment ->> 'amount_cents')::integer / 100.0, 'FM$999,990.00')), 300));
end;
$$;

-- A link for the main client to put a new card on the event (front of
-- house, a booked event), after a payment didn't go through.
create function public.send_event_card_link(p_event_id uuid, p_token_hash text, p_channel text, p_to text, p_days integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_me uuid;
  v_id uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null or not private.front_of_house(v_event.business_id) then
    raise exception 'Only the front desk, managers and owners can send card links' using errcode = '42501';
  end if;
  if v_event.status not in ('booked', 'trial_done') then
    raise exception 'Card links are for booked events' using errcode = '55000';
  end if;
  select s.id into v_me from public.staff s where s.user_id = (select auth.uid()) and s.business_id = v_event.business_id and s.is_active limit 1;
  update public.event_links set status = 'canceled' where event_id = p_event_id and kind = 'card' and status = 'open';
  insert into public.event_links (business_id, event_id, kind, token_hash, channel, sent_to, expires_at, created_by)
  values (v_event.business_id, p_event_id, 'card', p_token_hash, p_channel, left(trim(p_to), 254),
    now() + make_interval(days => least(greatest(p_days, 1), 60)), v_me)
  returning id into v_id;
  insert into public.event_history (business_id, event_id, kind, detail, staff_id)
  values (v_event.business_id, p_event_id, 'card_link_sent', left('To ' || trim(p_to), 300), v_me);
  return v_id;
end;
$$;

-- The client's new card (service role, from the card link's page): kept on
-- the event, and anything that failed is due again today, for the app to
-- charge straight after. The link stays open until it expires, so another
-- card can be tried if that one fails too.
create function public.update_event_card(p_link_id uuid, p_card jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.event_links;
begin
  select * into v_link from public.event_links where id = p_link_id for update;
  if v_link.id is null or v_link.kind <> 'card' then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if v_link.status <> 'open' or v_link.expires_at <= now() then
    raise exception 'This link is no longer active' using errcode = '55000', hint = 'expired';
  end if;
  update public.events set card_provider = p_card ->> 'provider', card_ref = left(p_card ->> 'ref', 200), card_label = left(p_card ->> 'label', 60)
  where id = v_link.event_id;
  update public.event_payments set status = 'scheduled', charge_after = null, due_on = least(due_on, private.event_today(v_link.event_id))
  where event_id = v_link.event_id and status = 'failed';
  insert into public.event_history (business_id, event_id, kind, detail)
  values (v_link.business_id, v_link.event_id, 'card_updated', left('New card: ' || (p_card ->> 'label'), 300));
end;
$$;

-- ---------------------------------------------------------------------------
-- Charging the schedule (service role: lib/events/billing.ts)
-- ---------------------------------------------------------------------------

-- Scheduled payments due today or before (at the salon), on events still
-- booked with a card, claimed for an hour so two runs never charge one twice.
create function public.claim_event_payments(p_business_id uuid, p_payment_id uuid, p_limit integer)
returns table (payment_id uuid, business_id uuid, event_id uuid, kind text, amount_cents integer, attempt integer, provider text, payment_method_ref text, card_label text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select p.id from public.event_payments p
    join public.events e on e.id = p.event_id
    where p.status = 'scheduled' and p.kind <> 'member'
      and p.due_on <= private.event_today(e.id)
      and (p.charge_after is null or p.charge_after <= now())
      and e.status in ('booked', 'trial_done') and e.card_ref is not null
      and (p_business_id is null or p.business_id = p_business_id)
      and (p_payment_id is null or p.id = p_payment_id)
    order by p.due_on
    limit p_limit
    for update of p skip locked
  ),
  claimed as (
    update public.event_payments p set attempts = p.attempts + 1, charge_after = now() + interval '1 hour'
    from due where p.id = due.id
    returning p.*
  )
  select c.id, c.business_id, c.event_id, c.kind, c.amount_cents, c.attempts::int, e.card_provider, e.card_ref, e.card_label
  from claimed c join public.events e on e.id = c.event_id;
end;
$$;

-- What the provider said: paid, or failed (flagged to the owners,
-- managers and front desk, and on the Events page).
create function public.record_event_charge(p_payment_id uuid, p_attempt integer, p_result jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.event_payments;
  v_event public.events;
  v_client public.clients;
  v_staff uuid;
  v_reason text := left(coalesce(p_result ->> 'reason', 'The card was declined'), 200);
begin
  select * into v_payment from public.event_payments where id = p_payment_id for update;
  if v_payment.id is null or v_payment.status <> 'scheduled' or v_payment.attempts <> p_attempt then
    raise exception 'This payment isn''t waiting for this charge' using errcode = '55000';
  end if;
  select * into v_event from public.events where id = v_payment.event_id;
  if (p_result ->> 'ok')::boolean then
    update public.event_payments set status = 'paid', paid_at = now(), charge_after = null, failure_reason = null,
      provider = p_result ->> 'provider', provider_reference = left(p_result ->> 'reference', 200), card_label = v_event.card_label
    where id = v_payment.id;
    insert into public.event_history (business_id, event_id, kind, detail)
    values (v_payment.business_id, v_payment.event_id, 'payment_paid',
      concat(case v_payment.kind when 'second' then 'Second payment' else 'Balance' end, ' of ', to_char(v_payment.amount_cents / 100.0, 'FM$999,990.00'), ' charged to ', v_event.card_label));
    return 'paid';
  end if;

  update public.event_payments set status = 'failed', charge_after = null, failure_reason = v_reason, card_label = v_event.card_label where id = v_payment.id;
  insert into public.event_history (business_id, event_id, kind, detail)
  values (v_payment.business_id, v_payment.event_id, 'payment_failed',
    left(concat(case v_payment.kind when 'second' then 'Second payment' else 'Balance' end, ' of ', to_char(v_payment.amount_cents / 100.0, 'FM$999,990.00'), ' didn''t go through (', v_reason, ')'), 1000));
  select * into v_client from public.clients where id = v_event.client_id;
  for v_staff in select s.id from public.staff s where s.business_id = v_payment.business_id and s.is_active and s.role in ('owner', 'manager', 'front_desk') loop
    insert into public.notifications (business_id, location_id, staff_id, channel, template, body)
    values (v_payment.business_id, v_event.location_id, v_staff, 'email', 'event_payment_failed',
      left(concat('The ', to_char(v_payment.amount_cents / 100.0, 'FM$999,990.00'), ' payment for ', v_event.title, ' (', v_client.first_name, ' ', v_client.last_name,
        ') didn''t go through (', v_reason, '). Try the card again from the event, or ask them for another.'), 1000));
  end loop;
  return 'failed';
end;
$$;

-- Try a failed payment again (front of house): scheduled for today, then
-- charged straight away by the app.
create function public.retry_event_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.event_payments;
  v_me uuid;
begin
  select * into v_payment from public.event_payments where id = p_payment_id for update;
  if v_payment.id is null or not private.front_of_house(v_payment.business_id) then
    raise exception 'Only the front desk, managers and owners can do that' using errcode = '42501';
  end if;
  if v_payment.status <> 'failed' then
    raise exception 'This payment didn''t fail' using errcode = '55000';
  end if;
  select s.id into v_me from public.staff s where s.user_id = (select auth.uid()) and s.business_id = v_payment.business_id and s.is_active limit 1;
  update public.event_payments set status = 'scheduled', charge_after = null, due_on = least(due_on, private.event_today(v_payment.event_id))
  where id = p_payment_id;
  insert into public.event_history (business_id, event_id, kind, staff_id) values (v_payment.business_id, v_payment.event_id, 'payment_retried', v_me);
end;
$$;

revoke all on function private.event_member_share(integer, integer, integer) from public;
revoke all on function private.event_today(uuid) from public;
revoke all on function private.schedule_event_payments(uuid) from public;
revoke all on function private.after_event_saved(uuid) from public;
revoke all on function public.accept_event_proposal(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pay_event_member(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_event_payments(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_event_charge(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.set_event_status(uuid, public.event_status, text) from public, anon;
revoke all on function public.send_event_proposal(uuid, text, text, text, integer) from public, anon;
revoke all on function public.send_event_member_link(uuid, text, text, text, integer) from public, anon;
revoke all on function public.retry_event_payment(uuid) from public, anon;
revoke all on function public.send_event_card_link(uuid, text, text, text, integer) from public, anon;
revoke all on function public.update_event_card(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.accept_event_proposal(uuid, jsonb) to service_role;
grant execute on function public.pay_event_member(uuid, jsonb) to service_role;
grant execute on function public.claim_event_payments(uuid, uuid, integer) to service_role;
grant execute on function public.record_event_charge(uuid, integer, jsonb) to service_role;
grant execute on function public.set_event_status(uuid, public.event_status, text) to authenticated;
grant execute on function public.send_event_proposal(uuid, text, text, text, integer) to authenticated;
grant execute on function public.send_event_member_link(uuid, text, text, text, integer) to authenticated;
grant execute on function public.retry_event_payment(uuid) to authenticated;
grant execute on function public.send_event_card_link(uuid, text, text, text, integer) to authenticated;
grant execute on function public.update_event_card(uuid, jsonb) to service_role;

-- Existing events get their main client's part.
do $$
declare v_id uuid;
begin
  for v_id in select id from public.events loop
    perform private.price_event(v_id);
  end loop;
end;
$$;

-- Scheduled: reminders, scheduled payments and receipts, hourly at :45
-- (each salon's 9am–8pm sending hours checked in the app).
select cron.schedule('maestra-events', '45 * * * *', $$select private.run_scheduled_job('/api/cron/events')$$);
