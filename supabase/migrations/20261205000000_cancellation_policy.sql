-- Cancellation and no-show policy, enforced automatically and fairly:
--
-- * policy_settings: when a card on file is needed to book (all bookings,
--   new clients, or some services or stylists), the cancellation window,
--   the late-cancel and no-show fees (fixed, a percent of the visit, or
--   the deposit), the long-held rule (the late-cancel fee only for visits
--   booked at least n days ahead), repeat offenders (n late cancels or
--   no-shows in m months → a deposit or prepayment for future bookings),
--   and who may waive a fee. staff_policies: a stylist's own, stricter
--   window and fees (the visit takes the strictest of all).
-- * policy_consents: exactly what a client agreed to and when, before any
--   card was saved. client_cards: the card on file (a provider token and
--   its label, never a number). card_requests: secure links staff send so
--   a client adds a card (and pays a deposit) themselves.
-- * policy_fees: every late cancellation and no-show, with its fee and
--   what happened to it (charged to the card after a short grace, from the
--   deposit, failed, waived with a reason, taken back), and
--   policy_fee_events: every step, with who and why.
--
-- The fee is worked out here when it happens (trigger
-- appointments_policy_fee, private.visit_terms), the same way as
-- lib/policy.ts. Charging goes through the payment provider layer in the
-- app (lib/policy-billing.ts, service role), recorded with
-- record_fee_charge; nothing here talks to a provider.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create type public.fee_kind as enum ('none', 'fixed', 'percent', 'deposit');

create table public.policy_settings (
  business_id             uuid primary key references public.businesses (id) on delete cascade,
  card_required           text not null default 'off' check (card_required in ('off', 'all', 'new_clients', 'some')),
  card_service_ids        uuid[] not null default '{}',
  card_staff_ids          uuid[] not null default '{}',
  cancel_window_hours     smallint not null default 24 check (cancel_window_hours between 1 and 168),
  -- fixed: cents; percent: 1 to 100; deposit and none: 0.
  late_cancel_fee_kind    public.fee_kind not null default 'none',
  late_cancel_fee_amount  integer not null default 0 check (late_cancel_fee_amount >= 0),
  no_show_fee_kind        public.fee_kind not null default 'none',
  no_show_fee_amount      integer not null default 0 check (no_show_fee_amount >= 0),
  long_hold_days          smallint check (long_hold_days between 1 and 365),
  repeat_count            smallint not null default 2 check (repeat_count between 1 and 10),
  repeat_months           smallint not null default 6 check (repeat_months between 1 and 24),
  repeat_action           text not null default 'off' check (repeat_action in ('off', 'deposit', 'prepay')),
  repeat_deposit_percent  smallint not null default 50 check (repeat_deposit_percent between 1 and 100),
  waive_roles             public.staff_role[] not null default array['owner', 'manager']::public.staff_role[],
  updated_by              uuid,
  updated_at              timestamptz not null default now(),
  check (late_cancel_fee_kind <> 'percent' or late_cancel_fee_amount between 1 and 100),
  check (no_show_fee_kind <> 'percent' or no_show_fee_amount between 1 and 100),
  check (late_cancel_fee_kind <> 'fixed' or late_cancel_fee_amount > 0),
  check (no_show_fee_kind <> 'fixed' or no_show_fee_amount > 0)
);

create table public.staff_policies (
  staff_id                uuid primary key,
  business_id             uuid not null references public.businesses (id) on delete cascade,
  cancel_window_hours     smallint check (cancel_window_hours between 1 and 168),
  late_cancel_fee_kind    public.fee_kind,
  late_cancel_fee_amount  integer check (late_cancel_fee_amount >= 0),
  no_show_fee_kind        public.fee_kind,
  no_show_fee_amount      integer check (no_show_fee_amount >= 0),
  updated_at              timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  check (late_cancel_fee_kind is distinct from 'percent' or late_cancel_fee_amount between 1 and 100),
  check (no_show_fee_kind is distinct from 'percent' or no_show_fee_amount between 1 and 100)
);

create index staff_policies_business_idx on public.staff_policies (business_id);

alter table public.policy_settings enable row level security;
alter table public.staff_policies enable row level security;

-- Everyone at the salon can see the policy (stylists tell clients about it).
create policy "Staff see the policy" on public.policy_settings for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Staff see stylists' policies" on public.staff_policies for select to authenticated
  using ((select private.is_business_member(business_id)));

-- ---------------------------------------------------------------------------
-- Consents, cards on file, card links
-- ---------------------------------------------------------------------------

create table public.policy_consents (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  client_id       uuid not null,
  appointment_id  uuid references public.appointments (id) on delete set null,
  -- The policy exactly as the client read it, and its terms.
  policy_text     text not null check (length(policy_text) between 1 and 4000),
  terms           jsonb not null,
  channel         text not null check (channel in ('online', 'link')),
  ip_hash         text check (ip_hash ~ '^[0-9a-f]{32,64}$'),
  agreed_at       timestamptz not null default now(),
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade
);

create index policy_consents_client_idx on public.policy_consents (client_id, agreed_at desc);

create table public.client_cards (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  client_id           uuid not null,
  provider            text not null check (provider ~ '^[a-z]{1,20}$'),
  payment_method_ref  text not null check (length(payment_method_ref) between 1 and 200),
  label               text not null check (length(label) between 1 and 60),
  consent_id          uuid not null references public.policy_consents (id),
  created_at          timestamptz not null default now(),
  removed_at          timestamptz,
  removed_by          uuid,
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade
);

-- One card on file per client.
create unique index client_cards_one_idx on public.client_cards (client_id) where removed_at is null;

create table public.card_requests (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null references public.locations (id) on delete cascade,
  client_id       uuid not null,
  appointment_id  uuid references public.appointments (id) on delete cascade,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- A deposit to pay with it (0: only the card).
  deposit_cents   integer not null default 0 check (deposit_cents >= 0),
  status          text not null default 'open' check (status in ('open', 'done', 'canceled')),
  channel         text not null check (channel in ('sms', 'email')),
  sent_to         text not null check (length(sent_to) between 3 and 254),
  expires_at      timestamptz not null,
  done_at         timestamptz,
  created_by      uuid not null references public.staff (id),
  created_at      timestamptz not null default now(),
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade
);

create unique index card_requests_one_open_idx on public.card_requests (client_id, coalesce(appointment_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open';

alter table public.policy_consents enable row level security;
alter table public.client_cards enable row level security;
alter table public.card_requests enable row level security;

create policy "Front of house see consents" on public.policy_consents for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house see cards on file" on public.client_cards for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house see card links" on public.card_requests for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- Deposits taken ahead of a visit (online, or by a card link), and what
-- became of them: applied at checkout, kept for a late cancel or no-show,
-- or refunded (refund_due until the provider has given it back).
alter table public.appointments
  add column deposit_paid_cents integer not null default 0 check (deposit_paid_cents >= 0),
  add column deposit_provider text,
  add column deposit_reference text check (length(deposit_reference) <= 200),
  add column deposit_outcome text check (deposit_outcome in ('applied', 'kept', 'refund_due', 'refunded'));

-- ---------------------------------------------------------------------------
-- Fees
-- ---------------------------------------------------------------------------

create table public.policy_fees (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses (id) on delete cascade,
  location_id              uuid not null references public.locations (id) on delete cascade,
  appointment_id           uuid not null references public.appointments (id) on delete cascade,
  client_id                uuid not null,
  kind                     text not null check (kind in ('late_cancel', 'no_show')),
  -- The whole fee; the deposit covers part (or all) of it.
  fee_cents                integer not null check (fee_cents >= 0),
  from_deposit_cents       integer not null default 0 check (from_deposit_cents >= 0 and from_deposit_cents <= fee_cents),
  status                   text not null check (status in ('none', 'no_card', 'pending', 'charged', 'failed', 'waived', 'voided')),
  charge_after             timestamptz,
  attempts                 smallint not null default 0,
  provider                 text,
  provider_reference       text check (length(provider_reference) <= 200),
  card_label               text,
  failure_reason           text check (length(failure_reason) <= 200),
  charged_at               timestamptz,
  waived_at                timestamptz,
  waived_by                uuid,
  waive_reason             text check (length(waive_reason) <= 300),
  -- Waived after it was charged: given back through the provider.
  refund_due               boolean not null default false,
  refunded_at              timestamptz,
  receipt_sent_at          timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade,
  check (status <> 'waived' or (waived_at is not null and waive_reason is not null))
);

-- One per visit (a no-show taken back and marked again reuses it).
create unique index policy_fees_appointment_idx on public.policy_fees (appointment_id);
create index policy_fees_business_idx on public.policy_fees (business_id, created_at desc);
create index policy_fees_client_idx on public.policy_fees (client_id, created_at desc);
create index policy_fees_due_idx on public.policy_fees (charge_after) where status = 'pending';

create table public.policy_fee_events (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  fee_id       uuid not null references public.policy_fees (id) on delete cascade,
  kind         text not null check (kind in ('assessed', 'charged', 'failed', 'retried', 'waived', 'refunded', 'refund_failed', 'voided', 'receipt')),
  amount_cents integer,
  detail       text check (length(detail) <= 300),
  staff_id     uuid,
  created_at   timestamptz not null default now()
);

create index policy_fee_events_fee_idx on public.policy_fee_events (fee_id, created_at);

alter table public.policy_fees enable row level security;
alter table public.policy_fee_events enable row level security;

create policy "Front of house see fees" on public.policy_fees for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house see fee history" on public.policy_fee_events for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

create trigger policy_fees_set_updated_at before update on public.policy_fees
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The rules (as lib/policy.ts)
-- ---------------------------------------------------------------------------

create function private.fee_cents(p_kind public.fee_kind, p_amount integer, p_visit integer, p_deposit integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'fixed' then least(p_amount, p_visit)
    when 'percent' then round(p_visit * p_amount / 100.0)::integer
    when 'deposit' then p_deposit
    else 0 end;
$$;

-- A visit's terms: the longest window and highest fees among the salon and
-- the stylists on it; a paid deposit is always kept.
create function private.visit_terms(p_appointment_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with a as (
    select a.id, a.business_id, a.deposit_paid_cents as deposit,
           coalesce((select sum(i.price_cents) from public.appointment_items i where i.appointment_id = a.id), 0)::integer as visit
    from public.appointments a where a.id = p_appointment_id
  ),
  rules as (
    select ps.cancel_window_hours as w, ps.late_cancel_fee_kind as lk, ps.late_cancel_fee_amount as la, ps.no_show_fee_kind as nk, ps.no_show_fee_amount as na
    from public.policy_settings ps join a on ps.business_id = a.business_id
    union all
    select sp.cancel_window_hours, sp.late_cancel_fee_kind, sp.late_cancel_fee_amount, sp.no_show_fee_kind, sp.no_show_fee_amount
    from public.staff_policies sp
    where sp.staff_id in (select i.staff_id from public.appointment_items i where i.appointment_id = p_appointment_id)
  )
  select jsonb_build_object(
    'window_hours', coalesce((select max(w) from rules), 24),
    'late_cents', greatest(a.deposit, coalesce((select max(private.fee_cents(lk, coalesce(la, 0), a.visit, a.deposit)) from rules where lk is not null), 0)),
    'no_show_cents', greatest(a.deposit, coalesce((select max(private.fee_cents(nk, coalesce(na, 0), a.visit, a.deposit)) from rules where nk is not null), 0)),
    'long_hold_days', (select ps.long_hold_days from public.policy_settings ps where ps.business_id = a.business_id),
    'visit_cents', a.visit,
    'deposit_cents', a.deposit
  )
  from a;
$$;

create function private.is_client_cancel(p_reason text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_reason = any (array['Client canceled', 'Client is sick', 'Canceled online by the client'])
    or p_reason like 'Client canceled:%' or p_reason like 'Client is sick:%' or p_reason like 'Canceled online by the client:%', false);
$$;

-- Late cancellations and no-shows that count against a client.
create function private.client_strikes(p_client_id uuid, p_months integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.policy_fees f
  where f.client_id = p_client_id and f.status not in ('waived', 'voided')
    and f.created_at > now() - make_interval(months => p_months);
$$;

-- A client's standing under the policy: their strikes and what the salon
-- asks of them (off, deposit or prepay). Front of house, or the service
-- role (the booking site).
create function public.client_policy_standing(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.clients where id = p_client_id);
  v_p public.policy_settings;
  v_strikes integer;
begin
  if v_business is null then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not private.has_business_role(v_business, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_p from public.policy_settings where business_id = v_business;
  v_strikes := private.client_strikes(p_client_id, coalesce(v_p.repeat_months, 6));
  return jsonb_build_object(
    'strikes', v_strikes,
    'months', coalesce(v_p.repeat_months, 6),
    'action', case when coalesce(v_p.repeat_action, 'off') <> 'off' and v_strikes >= v_p.repeat_count then v_p.repeat_action else 'off' end,
    'has_card', exists (select 1 from public.client_cards c where c.client_id = p_client_id and c.removed_at is null)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- When it happens: a no-show, or a cancellation by the client inside the
-- window. Before the update, so the deposit's outcome is set with it.
-- ---------------------------------------------------------------------------

create function private.assess_policy_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms jsonb;
  v_kind text;
  v_fee integer;
  v_from_deposit integer;
  v_status text;
  v_card public.client_cards;
  v_id uuid;
  v_existing public.policy_fees;
begin
  -- A no-show taken back: its fee goes too (unless it was already charged:
  -- then staff waive it, which refunds it).
  if old.status = 'no_show' and new.status in ('booked', 'confirmed') then
    select * into v_existing from public.policy_fees where appointment_id = new.id and kind = 'no_show';
    if v_existing.id is not null and v_existing.status in ('none', 'no_card', 'pending', 'failed') then
      update public.policy_fees set status = 'voided', charge_after = null where id = v_existing.id;
      insert into public.policy_fee_events (business_id, fee_id, kind, detail, staff_id)
      values (new.business_id, v_existing.id, 'voided', 'No-show taken back', private.current_staff_id(new.business_id));
      if new.deposit_outcome = 'kept' then
        new.deposit_outcome := null;
      end if;
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status or old.status not in ('booked', 'confirmed') or new.status not in ('no_show', 'canceled') then
    return new;
  end if;
  v_terms := private.visit_terms(new.id);

  if new.status = 'canceled' then
    if not private.is_client_cancel(new.cancel_reason)
       or new.canceled_at <= new.starts_at - make_interval(hours => (v_terms ->> 'window_hours')::int) then
      -- In good time, or the salon canceled: nothing to pay, and a deposit
      -- goes back.
      if new.deposit_paid_cents > 0 and new.deposit_outcome is null then
        new.deposit_outcome := 'refund_due';
      end if;
      return new;
    end if;
    v_kind := 'late_cancel';
    v_fee := (v_terms ->> 'late_cents')::int;
    if v_terms ->> 'long_hold_days' is not null
       and new.starts_at - new.created_at < make_interval(days => (v_terms ->> 'long_hold_days')::int) then
      v_fee := new.deposit_paid_cents;
    end if;
  else
    v_kind := 'no_show';
    v_fee := (v_terms ->> 'no_show_cents')::int;
  end if;

  if new.client_id is null then
    return new;
  end if;
  v_from_deposit := least(new.deposit_paid_cents, v_fee);
  if new.deposit_paid_cents > 0 then
    new.deposit_outcome := 'kept';
  end if;
  select * into v_card from public.client_cards where client_id = new.client_id and removed_at is null;
  v_status := case
    when v_fee = 0 then 'none'
    when v_fee = v_from_deposit then 'charged'
    when v_card.id is null then 'no_card'
    else 'pending' end;

  insert into public.policy_fees (business_id, location_id, appointment_id, client_id, kind, fee_cents, from_deposit_cents, status, charge_after, card_label, charged_at, attempts)
  values (new.business_id, new.location_id, new.id, new.client_id, v_kind, v_fee, v_from_deposit, v_status,
          case when v_status = 'pending' then now() + interval '10 minutes' end, v_card.label,
          case when v_status = 'charged' then now() end, 0)
  on conflict (appointment_id) do update set
    kind = excluded.kind, fee_cents = excluded.fee_cents, from_deposit_cents = excluded.from_deposit_cents, status = excluded.status,
    charge_after = excluded.charge_after, card_label = excluded.card_label, charged_at = excluded.charged_at,
    attempts = 0, failure_reason = null, provider = null, provider_reference = null, created_at = now()
  where public.policy_fees.status = 'voided'
  returning id into v_id;

  if v_id is not null then
    insert into public.policy_fee_events (business_id, fee_id, kind, amount_cents, detail, staff_id)
    values (new.business_id, v_id, 'assessed', v_fee,
            case when v_from_deposit > 0 then 'Deposit kept: ' || to_char(v_from_deposit / 100.0, 'FM$999,990.00') end,
            private.current_staff_id(new.business_id));
  end if;
  return new;
end;
$$;

create trigger appointments_policy_fee before update of status on public.appointments
  for each row execute function private.assess_policy_fee();

-- ---------------------------------------------------------------------------
-- Staff: settings, waivers, retries, cards
-- ---------------------------------------------------------------------------

create function public.save_policy_settings(p_business_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners set the policy' using errcode = '42501';
  end if;
  insert into public.policy_settings as ps (
    business_id, card_required, card_service_ids, card_staff_ids, cancel_window_hours,
    late_cancel_fee_kind, late_cancel_fee_amount, no_show_fee_kind, no_show_fee_amount, long_hold_days,
    repeat_count, repeat_months, repeat_action, repeat_deposit_percent, waive_roles, updated_by, updated_at)
  values (
    p_business_id, p ->> 'card_required',
    coalesce(array(select s.id from public.services s where s.business_id = p_business_id and s.id::text in (select jsonb_array_elements_text(coalesce(p -> 'card_service_ids', '[]')))), '{}'),
    coalesce(array(select s.id from public.staff s where s.business_id = p_business_id and s.id::text in (select jsonb_array_elements_text(coalesce(p -> 'card_staff_ids', '[]')))), '{}'),
    (p ->> 'cancel_window_hours')::smallint,
    (p ->> 'late_cancel_fee_kind')::public.fee_kind, (p ->> 'late_cancel_fee_amount')::int,
    (p ->> 'no_show_fee_kind')::public.fee_kind, (p ->> 'no_show_fee_amount')::int,
    (p ->> 'long_hold_days')::smallint,
    (p ->> 'repeat_count')::smallint, (p ->> 'repeat_months')::smallint, p ->> 'repeat_action', (p ->> 'repeat_deposit_percent')::smallint,
    coalesce(array(select r::public.staff_role from jsonb_array_elements_text(p -> 'waive_roles') r where r in ('owner', 'manager', 'front_desk')),
             array['owner', 'manager']::public.staff_role[]) || array['owner']::public.staff_role[],
    private.current_staff_id(p_business_id), now())
  on conflict (business_id) do update set
    card_required = excluded.card_required, card_service_ids = excluded.card_service_ids, card_staff_ids = excluded.card_staff_ids,
    cancel_window_hours = excluded.cancel_window_hours, late_cancel_fee_kind = excluded.late_cancel_fee_kind,
    late_cancel_fee_amount = excluded.late_cancel_fee_amount, no_show_fee_kind = excluded.no_show_fee_kind,
    no_show_fee_amount = excluded.no_show_fee_amount, long_hold_days = excluded.long_hold_days,
    repeat_count = excluded.repeat_count, repeat_months = excluded.repeat_months, repeat_action = excluded.repeat_action,
    repeat_deposit_percent = excluded.repeat_deposit_percent,
    waive_roles = array(select distinct unnest(excluded.waive_roles)), updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- A stylist's own rules (all null: the salon's).
create function public.save_staff_policy(p_staff_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.staff where id = p_staff_id);
begin
  if v_business is null or not private.has_business_role(v_business, array['owner']::public.staff_role[]) then
    raise exception 'Only owners set the policy' using errcode = '42501';
  end if;
  if p ->> 'cancel_window_hours' is null and p ->> 'late_cancel_fee_kind' is null and p ->> 'no_show_fee_kind' is null then
    delete from public.staff_policies where staff_id = p_staff_id;
    return;
  end if;
  insert into public.staff_policies (staff_id, business_id, cancel_window_hours, late_cancel_fee_kind, late_cancel_fee_amount, no_show_fee_kind, no_show_fee_amount)
  values (p_staff_id, v_business, (p ->> 'cancel_window_hours')::smallint,
          (p ->> 'late_cancel_fee_kind')::public.fee_kind, (p ->> 'late_cancel_fee_amount')::int,
          (p ->> 'no_show_fee_kind')::public.fee_kind, (p ->> 'no_show_fee_amount')::int)
  on conflict (staff_id) do update set
    cancel_window_hours = excluded.cancel_window_hours, late_cancel_fee_kind = excluded.late_cancel_fee_kind,
    late_cancel_fee_amount = excluded.late_cancel_fee_amount, no_show_fee_kind = excluded.no_show_fee_kind,
    no_show_fee_amount = excluded.no_show_fee_amount, updated_at = now();
end;
$$;

-- Waives a fee, before or after it's charged, with a reason (the roles the
-- salon allows). One already charged is marked to be given back
-- (refund_due), which the app does through the provider.
create function public.waive_policy_fee(p_fee_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.policy_fees;
  v_roles public.staff_role[];
  v_me uuid;
  v_refund boolean;
begin
  select * into v_fee from public.policy_fees where id = p_fee_id for update;
  if v_fee.id is null then
    raise exception 'Fee not found' using errcode = 'P0002';
  end if;
  v_roles := coalesce((select waive_roles from public.policy_settings where business_id = v_fee.business_id), array['owner', 'manager']::public.staff_role[]);
  if not private.has_business_role(v_fee.business_id, v_roles) then
    raise exception 'Not allowed to waive fees' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) > 300 then
    raise exception 'Say why the fee is waived' using errcode = '22023';
  end if;
  if v_fee.status in ('waived', 'voided', 'none') then
    raise exception 'There''s no fee to waive' using errcode = '55000';
  end if;
  v_me := private.current_staff_id(v_fee.business_id);
  v_refund := v_fee.status = 'charged';
  update public.policy_fees set status = 'waived', waived_at = now(), waived_by = v_me, waive_reason = trim(p_reason),
    charge_after = null, refund_due = v_refund
  where id = v_fee.id;
  insert into public.policy_fee_events (business_id, fee_id, kind, amount_cents, detail, staff_id)
  values (v_fee.business_id, v_fee.id, 'waived', v_fee.fee_cents, trim(p_reason), v_me);
  return jsonb_build_object('refund_due', v_refund);
end;
$$;

-- Tries a failed charge again (or one with no card, now there is one).
create function public.retry_policy_fee(p_fee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.policy_fees;
  v_card public.client_cards;
begin
  select * into v_fee from public.policy_fees where id = p_fee_id for update;
  if v_fee.id is null or not private.has_business_role(v_fee.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_fee.status not in ('failed', 'no_card') then
    raise exception 'Only a fee that didn''t go through can be tried again' using errcode = '55000';
  end if;
  select * into v_card from public.client_cards where client_id = v_fee.client_id and removed_at is null;
  if v_card.id is null then
    raise exception 'There''s no card on file' using errcode = '55000', hint = 'no_card';
  end if;
  update public.policy_fees set status = 'pending', charge_after = now(), card_label = v_card.label where id = v_fee.id;
  insert into public.policy_fee_events (business_id, fee_id, kind, detail, staff_id)
  values (v_fee.business_id, v_fee.id, 'retried', v_card.label, private.current_staff_id(v_fee.business_id));
end;
$$;

create function public.remove_client_card(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.clients where id = p_client_id);
begin
  if v_business is null or not private.has_business_role(v_business, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.client_cards set removed_at = now(), removed_by = private.current_staff_id(v_business)
  where client_id = p_client_id and removed_at is null;
  update public.policy_fees set status = 'no_card', charge_after = null where client_id = p_client_id and status = 'pending';
end;
$$;

-- A secure link for the client to add a card (and pay a deposit).
create function public.create_card_request(p_client_id uuid, p_appointment_id uuid, p_token_hash text, p_deposit_cents integer, p_channel text, p_to text, p_hours integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_location uuid;
  v_id uuid;
begin
  select * into v_client from public.clients where id = p_client_id;
  if v_client.id is null or not private.has_business_role(v_client.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_appointment_id is not null then
    select location_id into v_location from public.appointments
    where id = p_appointment_id and client_id = p_client_id and status in ('booked', 'confirmed');
    if v_location is null then
      raise exception 'That visit can''t take a deposit now' using errcode = '55000';
    end if;
  else
    v_location := (select id from public.locations where business_id = v_client.business_id order by created_at limit 1);
  end if;
  if p_hours not between 1 and 168 or p_deposit_cents < 0 then
    raise exception 'Check the link' using errcode = '22023';
  end if;
  update public.card_requests set status = 'canceled'
  where client_id = p_client_id and appointment_id is not distinct from p_appointment_id and status = 'open';
  insert into public.card_requests (business_id, location_id, client_id, appointment_id, token_hash, deposit_cents, channel, sent_to, expires_at, created_by)
  values (v_client.business_id, v_location, p_client_id, p_appointment_id, p_token_hash, p_deposit_cents, p_channel, trim(p_to),
          now() + make_interval(hours => p_hours), private.current_staff_id(v_client.business_id))
  returning id into v_id;
  return v_id;
end;
$$;

-- Saves a card with the consent that came first (service role: the
-- booking site and the card link page). Replaces any card on file.
create function private.save_card(p_business_id uuid, p_client_id uuid, p_appointment_id uuid, p_card jsonb, p_consent jsonb, p_channel text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consent uuid;
  v_card uuid;
begin
  if p_consent ->> 'policy_text' is null or p_consent -> 'terms' is null then
    raise exception 'A card is saved only after the client agrees to the policy' using errcode = '22023';
  end if;
  insert into public.policy_consents (business_id, client_id, appointment_id, policy_text, terms, channel, ip_hash)
  values (p_business_id, p_client_id, p_appointment_id, p_consent ->> 'policy_text', p_consent -> 'terms', p_channel, p_consent ->> 'ip_hash')
  returning id into v_consent;
  if p_card is null then
    return null;
  end if;
  update public.client_cards set removed_at = now() where client_id = p_client_id and removed_at is null;
  insert into public.client_cards (business_id, client_id, provider, payment_method_ref, label, consent_id)
  values (p_business_id, p_client_id, p_card ->> 'provider', p_card ->> 'ref', p_card ->> 'label', v_consent)
  returning id into v_card;
  -- Fees waiting for a card can now be tried.
  update public.policy_fees set status = 'pending', charge_after = now(), card_label = p_card ->> 'label'
  where client_id = p_client_id and status = 'no_card';
  return v_card;
end;
$$;

-- A deposit taken by the provider for a visit.
create function private.record_deposit(p_appointment_id uuid, p_deposit jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_deposit is null or coalesce((p_deposit ->> 'amount_cents')::int, 0) <= 0 then
    return;
  end if;
  update public.appointments set
    deposit_paid_cents = (p_deposit ->> 'amount_cents')::int,
    deposit_provider = p_deposit ->> 'provider',
    deposit_reference = left(p_deposit ->> 'reference', 200),
    deposit_outcome = null
  where id = p_appointment_id and deposit_paid_cents = 0;
  if not found then
    raise exception 'This visit already has a deposit' using errcode = '55000', hint = 'deposit_paid';
  end if;
end;
$$;

-- The booking site: the card and consent (and deposit) for a booking just
-- made. Service role.
create function public.record_online_card(p_appointment_id uuid, p_card jsonb, p_consent jsonb, p_deposit jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments;
begin
  select * into v_a from public.appointments where id = p_appointment_id;
  if v_a.id is null or v_a.client_id is null then
    raise exception 'Visit not found' using errcode = 'P0002';
  end if;
  perform private.save_card(v_a.business_id, v_a.client_id, v_a.id, p_card, p_consent, 'online');
  perform private.record_deposit(v_a.id, p_deposit);
end;
$$;

-- The card link page: the client agreed, the card is saved and any
-- deposit taken. Once only, and not after it expires. Service role.
create function public.complete_card_request(p_request_id uuid, p_card jsonb, p_consent jsonb, p_deposit jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.card_requests;
begin
  select * into v_r from public.card_requests where id = p_request_id for update;
  if v_r.id is null then
    raise exception 'Link not found' using errcode = 'P0002';
  end if;
  if v_r.status <> 'open' then
    raise exception 'This link was already used' using errcode = '55000', hint = 'used';
  end if;
  if v_r.expires_at <= now() then
    raise exception 'This link has expired' using errcode = '55000', hint = 'expired';
  end if;
  if v_r.deposit_cents > 0 and coalesce((p_deposit ->> 'amount_cents')::int, 0) <> v_r.deposit_cents then
    raise exception 'The deposit doesn''t match' using errcode = '22023';
  end if;
  perform private.save_card(v_r.business_id, v_r.client_id, v_r.appointment_id, p_card, p_consent, 'link');
  if v_r.appointment_id is not null and v_r.deposit_cents > 0 then
    perform private.record_deposit(v_r.appointment_id, p_deposit);
  end if;
  update public.card_requests set status = 'done', done_at = now() where id = v_r.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The charging run (service role): what the provider said.
-- ---------------------------------------------------------------------------

-- Due fees, claimed for charging (so two runs never charge one twice): the
-- attempt number is bumped and the card returned.
create function public.claim_policy_fees(p_business_id uuid, p_fee_id uuid, p_limit integer)
returns table (fee_id uuid, business_id uuid, appointment_id uuid, client_id uuid, kind text, amount_cents integer, attempt integer, provider text, payment_method_ref text, card_label text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select f.id from public.policy_fees f
    where f.status = 'pending' and f.charge_after <= now()
      and (p_business_id is null or f.business_id = p_business_id)
      and (p_fee_id is null or f.id = p_fee_id)
    order by f.charge_after
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.policy_fees f set attempts = f.attempts + 1, charge_after = now() + interval '1 hour'
    from due where f.id = due.id
    returning f.*
  )
  select c.id, c.business_id, c.appointment_id, c.client_id, c.kind, c.fee_cents - c.from_deposit_cents, c.attempts::int,
         cc.provider, cc.payment_method_ref, cc.label
  from claimed c
  join public.client_cards cc on cc.client_id = c.client_id and cc.removed_at is null;
end;
$$;

create function public.record_fee_charge(p_fee_id uuid, p_attempt integer, p_result jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.policy_fees;
  v_client public.clients;
  v_staff uuid;
  v_reason text := left(coalesce(p_result ->> 'reason', 'The card was declined'), 200);
begin
  select * into v_fee from public.policy_fees where id = p_fee_id for update;
  if v_fee.id is null or v_fee.status <> 'pending' or v_fee.attempts <> p_attempt then
    raise exception 'This fee isn''t waiting for this charge' using errcode = '55000';
  end if;
  if (p_result ->> 'ok')::boolean then
    update public.policy_fees set status = 'charged', charged_at = now(), charge_after = null, failure_reason = null,
      provider = p_result ->> 'provider', provider_reference = left(p_result ->> 'reference', 200)
    where id = v_fee.id;
    insert into public.policy_fee_events (business_id, fee_id, kind, amount_cents, detail)
    values (v_fee.business_id, v_fee.id, 'charged', v_fee.fee_cents - v_fee.from_deposit_cents, v_fee.card_label);
    return 'charged';
  end if;

  update public.policy_fees set status = 'failed', charge_after = null, failure_reason = v_reason where id = v_fee.id;
  insert into public.policy_fee_events (business_id, fee_id, kind, amount_cents, detail)
  values (v_fee.business_id, v_fee.id, 'failed', v_fee.fee_cents - v_fee.from_deposit_cents, v_reason);
  -- Flagged to the owners, managers and front desk (recorded until texts
  -- and email are connected; the Dashboard and the policy page show it).
  select * into v_client from public.clients where id = v_fee.client_id;
  for v_staff in select s.id from public.staff s where s.business_id = v_fee.business_id and s.is_active and s.role in ('owner', 'manager', 'front_desk') loop
    insert into public.notifications (business_id, location_id, appointment_id, staff_id, channel, template, body)
    values (v_fee.business_id, v_fee.location_id, v_fee.appointment_id, v_staff, 'email', 'policy_fee_failed',
      left(concat(v_client.first_name, ' ', v_client.last_name, '''s ', case v_fee.kind when 'no_show' then 'no-show' else 'late-cancellation' end,
        ' fee of ', to_char((v_fee.fee_cents - v_fee.from_deposit_cents) / 100.0, 'FM$999,990.00'), ' didn''t go through (', v_reason,
        '). Try the card again or ask them for another from the policy page.'), 1000));
  end loop;
  return 'failed';
end;
$$;

-- A waived fee given back (or a deposit refunded), as the provider said.
create function public.record_fee_refund(p_fee_id uuid, p_ok boolean, p_detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.policy_fees;
begin
  select * into v_fee from public.policy_fees where id = p_fee_id for update;
  if v_fee.id is null or not v_fee.refund_due then
    raise exception 'Nothing to refund' using errcode = '55000';
  end if;
  if p_ok then
    update public.policy_fees set refund_due = false, refunded_at = now() where id = v_fee.id;
    if v_fee.from_deposit_cents > 0 then
      update public.appointments set deposit_outcome = 'refunded' where id = v_fee.appointment_id;
    end if;
  end if;
  insert into public.policy_fee_events (business_id, fee_id, kind, amount_cents, detail)
  values (v_fee.business_id, v_fee.id, case when p_ok then 'refunded' else 'refund_failed' end, v_fee.fee_cents, left(p_detail, 300));
end;
$$;

create function public.record_deposit_refund(p_appointment_id uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update public.appointments set deposit_outcome = 'refunded' where id = p_appointment_id and deposit_outcome = 'refund_due';
  end if;
end;
$$;

create function public.record_fee_receipt(p_fee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.policy_fees set receipt_sent_at = now() where id = p_fee_id and receipt_sent_at is null;
  if found then
    insert into public.policy_fee_events (business_id, fee_id, kind)
    select business_id, id, 'receipt' from public.policy_fees where id = p_fee_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checkout: a deposit paid ahead comes off the bill, as a card payment
-- "Deposit paid online" taken by the provider. Only the visit's own
-- deposit, once.
-- ---------------------------------------------------------------------------

create function private.apply_deposit_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments;
begin
  if new.method <> 'card' or new.reference is distinct from 'Deposit paid online' then
    return new;
  end if;
  -- The sale voided: the deposit can be applied again.
  if new.amount_cents < 0 then
    update public.appointments a set deposit_outcome = null from public.sales s
    where s.id = new.sale_id and a.id = s.appointment_id and a.deposit_outcome = 'applied';
    return new;
  end if;
  select a.* into v_a from public.appointments a join public.sales s on s.appointment_id = a.id where s.id = new.sale_id for update of a;
  if v_a.id is null or v_a.deposit_paid_cents <> new.amount_cents or v_a.deposit_outcome is not null then
    raise exception 'There''s no deposit to apply on this visit' using errcode = '22023';
  end if;
  new.processor := v_a.deposit_provider;
  new.processor_reference := v_a.deposit_reference;
  update public.appointments set deposit_outcome = 'applied' where id = v_a.id;
  return new;
end;
$$;

create trigger payments_apply_deposit before insert on public.payments
  for each row execute function private.apply_deposit_payment();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.fee_cents(public.fee_kind, integer, integer, integer) from public;
revoke all on function private.visit_terms(uuid) from public;
revoke all on function private.is_client_cancel(text) from public;
revoke all on function private.client_strikes(uuid, integer) from public;
revoke all on function private.assess_policy_fee() from public;
revoke all on function private.save_card(uuid, uuid, uuid, jsonb, jsonb, text) from public;
revoke all on function private.record_deposit(uuid, jsonb) from public;
revoke all on function private.apply_deposit_payment() from public;

revoke all on function public.client_policy_standing(uuid) from public, anon;
revoke all on function public.save_policy_settings(uuid, jsonb) from public, anon;
revoke all on function public.save_staff_policy(uuid, jsonb) from public, anon;
revoke all on function public.waive_policy_fee(uuid, text) from public, anon;
revoke all on function public.retry_policy_fee(uuid) from public, anon;
revoke all on function public.remove_client_card(uuid) from public, anon;
revoke all on function public.create_card_request(uuid, uuid, text, integer, text, text, integer) from public, anon;
revoke all on function public.record_online_card(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.complete_card_request(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.claim_policy_fees(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_fee_charge(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.record_fee_refund(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.record_deposit_refund(uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_fee_receipt(uuid) from public, anon, authenticated;

grant execute on function public.client_policy_standing(uuid) to authenticated, service_role;
grant execute on function public.save_policy_settings(uuid, jsonb) to authenticated;
grant execute on function public.save_staff_policy(uuid, jsonb) to authenticated;
grant execute on function public.waive_policy_fee(uuid, text) to authenticated;
grant execute on function public.retry_policy_fee(uuid) to authenticated;
grant execute on function public.remove_client_card(uuid) to authenticated;
grant execute on function public.create_card_request(uuid, uuid, text, integer, text, text, integer) to authenticated;
grant execute on function public.record_online_card(uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.complete_card_request(uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.claim_policy_fees(uuid, uuid, integer) to service_role;
grant execute on function public.record_fee_charge(uuid, integer, jsonb) to service_role;
grant execute on function public.record_fee_refund(uuid, boolean, text) to service_role;
grant execute on function public.record_deposit_refund(uuid, boolean) to service_role;
grant execute on function public.record_fee_receipt(uuid) to service_role;

-- Fees due are charged every 15 minutes (UTC, like the other jobs).
select cron.schedule('maestra-policy-fees', '*/15 * * * *', $$select private.run_scheduled_job('/api/cron/fees')$$);
