-- Online booking: each salon's public booking site at /book/<slug>, where
-- clients choose services, a stylist and a time, confirm who they are with
-- a one-time code, and book. They can then view, cancel or reschedule with
-- a private link.
--
-- The site runs on the server with the service role (the public never
-- reads these tables directly). It checks the booking rules in
-- lib/scheduling/ first, like the calendar, then saves through
-- save_online_appointment, which only the service role can call. Codes,
-- rate limits and the outbox are server-only tables (RLS on, no policies).

-- ---------------------------------------------------------------------------
-- The salon's booking site and its rules
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column slug text unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60);

create table public.online_booking_settings (
  business_id              uuid primary key references public.businesses (id) on delete cascade,
  enabled                  boolean not null default false,
  -- How far ahead clients can book, and the least notice.
  window_days              smallint not null default 60 check (window_days between 1 and 365),
  notice_minutes           integer not null default 120 check (notice_minutes between 0 and 10080),
  allow_new_clients        boolean not null default true,
  -- Clients can cancel or reschedule online until this many hours before.
  cancel_cutoff_hours      smallint not null default 24 check (cancel_cutoff_hours between 0 and 168),
  cancellation_policy      text not null default '' check (length(cancellation_policy) <= 2000),
  -- What "Request a consultation" books, for services that need one first.
  consultation_service_id  uuid,
  -- The site's look: the salon's color for buttons and highlights (white
  -- text on it must pass WCAG AA; checked in the app) and a welcome line.
  accent_color             text check (accent_color ~ '^#[0-9a-f]{6}$'),
  welcome                  text check (length(welcome) <= 280),
  updated_at               timestamptz not null default now(),
  foreign key (consultation_service_id, business_id) references public.services (id, business_id) on delete set null (consultation_service_id)
);

create trigger online_booking_settings_set_updated_at before update on public.online_booking_settings
  for each row execute function public.set_updated_at();

alter table public.online_booking_settings enable row level security;

create policy "Members can view online booking settings"
  on public.online_booking_settings for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners can set up online booking"
  on public.online_booking_settings for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));
create policy "Owners can change online booking"
  on public.online_booking_settings for update to authenticated
  using ((select private.has_business_role(business_id, array['owner']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));

-- Per service: bookable online, only after a consultation, or not online;
-- and a deposit (a fixed amount in cents, or a percentage of the price).
create type public.online_service_mode as enum ('bookable', 'consultation', 'off');
create type public.deposit_kind as enum ('none', 'fixed', 'percent');

alter table public.services
  add column online_booking public.online_service_mode not null default 'bookable',
  add column deposit_kind public.deposit_kind not null default 'none',
  add column deposit_amount integer not null default 0 check (deposit_amount >= 0),
  add constraint services_deposit_percent_check check (deposit_kind <> 'percent' or deposit_amount between 1 and 100);

-- A visit booked online gets its deposit (appointments.deposit_cents) from
-- these settings; payment comes later (Stripe). And the sha256 (hex) of the
-- client's private "manage my booking" link.
alter table public.appointments
  add column manage_token_hash text unique check (manage_token_hash ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------
-- Stylist photos, shown on the booking site: the public `staff-photos`
-- bucket under <business_id>/. Owners and managers manage them.
-- ---------------------------------------------------------------------------

alter table public.staff
  add column photo_path text check (photo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-photos', 'staff-photos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "Owners and managers can add staff photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-photos' and (select private.has_business_role(private.logo_business(name), array['owner', 'manager']::public.staff_role[])));
create policy "Owners and managers can replace staff photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'staff-photos' and (select private.has_business_role(private.logo_business(name), array['owner', 'manager']::public.staff_role[])))
  with check (bucket_id = 'staff-photos' and (select private.has_business_role(private.logo_business(name), array['owner', 'manager']::public.staff_role[])));
create policy "Owners and managers can remove staff photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'staff-photos' and (select private.has_business_role(private.logo_business(name), array['owner', 'manager']::public.staff_role[])));
create policy "Members can see their salon's staff photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'staff-photos' and (select private.is_business_member(private.logo_business(name))));

-- ---------------------------------------------------------------------------
-- One-time codes. A client confirms a phone number or email with a 6-digit
-- code; the browser then holds a session secret for that confirmation
-- (only its hash is kept) to book with.
-- ---------------------------------------------------------------------------

create table public.online_verifications (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  channel       text not null check (channel in ('sms', 'email')),
  -- Phone digits or a lowercase email.
  destination   text not null check (length(destination) between 3 and 254),
  code_hash     text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  session_hash  text unique check (session_hash ~ '^[0-9a-f]{64}$'),
  attempts      smallint not null default 0,
  expires_at    timestamptz not null,
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index online_verifications_business_id_idx on public.online_verifications (business_id, destination);

-- Messages that would be sent (codes now; texts and emails later). Shown
-- on the dev outbox page until a real provider is connected.
create table public.outbox_messages (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses (id) on delete cascade,
  channel      text not null check (channel in ('sms', 'email')),
  to_address   text not null,
  subject      text,
  body         text not null,
  created_at   timestamptz not null default now()
);

create index outbox_messages_created_at_idx on public.outbox_messages (created_at desc);

-- Every online booking, change and cancellation.
create table public.online_booking_log (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  appointment_id  uuid references public.appointments (id) on delete set null,
  client_id       uuid references public.clients (id) on delete set null,
  action          text not null check (action in ('booked', 'rescheduled', 'canceled')),
  -- A keyed hash of the IP address, so repeat visitors can be spotted
  -- without storing the address.
  ip_hash         text,
  user_agent      text check (length(user_agent) <= 300),
  created_at      timestamptz not null default now()
);

create index online_booking_log_business_id_idx on public.online_booking_log (business_id, created_at desc);

-- Requests per key (an IP hash, a phone number...) per time window.
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);

alter table public.online_verifications enable row level security;
alter table public.outbox_messages enable row level security;
alter table public.online_booking_log enable row level security;
alter table public.rate_limits enable row level security;

create policy "Owners and managers can view the online booking log"
  on public.online_booking_log for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

-- Counts a request and says whether it's within the limit.
create function public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  -- Now and then, forget old windows.
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Saving appointments. save_appointment (staff) and save_online_appointment
-- (the booking site) share private.write_appointment, which is
-- save_appointment's body as before, with where the booking came from and
-- who made it as arguments.
-- ---------------------------------------------------------------------------

create function private.write_appointment(
  p_location_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_notes text,
  p_items jsonb,
  p_expected_version bigint,
  p_source public.appointment_source,
  p_staff_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_appointment_id uuid;
  v_item jsonb;
  v_old public.appointment_items;
  v_service public.services;
  v_price integer;
  v_start timestamptz;
  v_kept_ids uuid[];
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A visit needs at least one service' using errcode = '22023';
  end if;

  update public.locations set calendar_version = calendar_version + 1
  where id = p_location_id and calendar_version = p_expected_version;
  if not found then
    raise exception 'The calendar changed; check again' using errcode = '40001';
  end if;

  if p_appointment_id is null then
    insert into public.appointments (business_id, location_id, client_id, starts_at, ends_at, notes, source, created_by, updated_by)
    values (v_business_id, p_location_id, p_client_id, now(), now() + interval '1 minute', nullif(trim(p_notes), ''), p_source, p_staff_id, p_staff_id)
    returning id into v_appointment_id;
  else
    update public.appointments
    set client_id = p_client_id, notes = nullif(trim(p_notes), ''), updated_by = p_staff_id
    where id = p_appointment_id and location_id = p_location_id and status in ('booked', 'confirmed', 'checked_in')
    returning id into v_appointment_id;
    if v_appointment_id is null then
      raise exception 'Appointment not found or can''t be changed' using errcode = 'P0002';
    end if;
  end if;

  select coalesce(array_agg((i ->> 'id')::uuid), '{}') into v_kept_ids
  from jsonb_array_elements(p_items) i
  where i ->> 'id' is not null;

  delete from public.appointment_items where appointment_id = v_appointment_id and id <> all (v_kept_ids);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_start := (v_item ->> 'starts_at')::timestamptz;
    select * into v_service from public.services where id = (v_item ->> 'service_id')::uuid and business_id = v_business_id;
    v_price := private.stylist_price((v_item ->> 'staff_id')::uuid, v_service.id);
    if v_service.id is null or v_price is null then
      raise exception 'The stylist doesn''t offer that service' using errcode = '22023';
    end if;

    v_old := null;
    if v_item ->> 'id' is not null then
      select * into v_old from public.appointment_items
      where id = (v_item ->> 'id')::uuid and appointment_id = v_appointment_id;
      if v_old.id is null then
        raise exception 'Item not found on this appointment' using errcode = 'P0002';
      end if;
    end if;

    if v_old.id is not null and v_old.service_id = v_service.id then
      -- Same service: keep its timing, and its price unless the stylist changed.
      update public.appointment_items set
        staff_id = (v_item ->> 'staff_id')::uuid,
        resource_id = (v_item ->> 'resource_id')::uuid,
        starts_at = v_start,
        ends_at = v_start + make_interval(mins => active_minutes + processing_minutes + finishing_minutes),
        price_cents = case when staff_id = (v_item ->> 'staff_id')::uuid then price_cents else v_price end
      where id = v_old.id;
    elsif v_old.id is not null then
      update public.appointment_items set
        service_id = v_service.id,
        staff_id = (v_item ->> 'staff_id')::uuid,
        resource_id = (v_item ->> 'resource_id')::uuid,
        starts_at = v_start,
        ends_at = v_start + make_interval(mins => v_service.duration_minutes),
        active_minutes = v_service.active_minutes,
        processing_minutes = v_service.processing_minutes,
        finishing_minutes = v_service.finishing_minutes,
        price_cents = v_price
      where id = v_old.id;
    else
      insert into public.appointment_items (
        business_id, location_id, appointment_id, service_id, staff_id, resource_id, starts_at, ends_at,
        active_minutes, processing_minutes, finishing_minutes, price_cents
      ) values (
        v_business_id, p_location_id, v_appointment_id, v_service.id, (v_item ->> 'staff_id')::uuid,
        (v_item ->> 'resource_id')::uuid, v_start, v_start + make_interval(mins => v_service.duration_minutes),
        v_service.active_minutes, v_service.processing_minutes, v_service.finishing_minutes, v_price
      );
    end if;
  end loop;

  return v_appointment_id;
end;
$$;

revoke all on function private.write_appointment(uuid, uuid, uuid, text, jsonb, bigint, public.appointment_source, uuid) from public;

create or replace function public.save_appointment(
  p_location_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_notes text,
  p_items jsonb,
  p_expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  if v_business_id is null
     or not private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to book at this location' using errcode = '42501';
  end if;
  return private.write_appointment(
    p_location_id, p_appointment_id, p_client_id, p_notes, p_items, p_expected_version,
    'front_desk', private.current_staff_id(v_business_id)
  );
end;
$$;

-- The booking site's save (service role only): books a visit made online,
-- or reschedules one (found by its manage link). A new booking gets the
-- hash of its manage link; its deposit comes from its services' deposit
-- settings and the prices it was booked at.
create function public.save_online_appointment(
  p_location_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_notes text,
  p_items jsonb,
  p_expected_version bigint,
  p_manage_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment_id uuid;
begin
  if p_client_id is null then
    raise exception 'An online booking needs a client' using errcode = '22023';
  end if;
  if p_appointment_id is not null and not exists (
    select 1 from public.appointments a
    where a.id = p_appointment_id and a.manage_token_hash = p_manage_token_hash and a.client_id = p_client_id
      and a.status in ('booked', 'confirmed')
  ) then
    raise exception 'Appointment not found or can''t be changed' using errcode = 'P0002';
  end if;

  v_appointment_id := private.write_appointment(p_location_id, p_appointment_id, p_client_id, p_notes, p_items, p_expected_version, 'online', null);

  update public.appointments a set
    manage_token_hash = p_manage_token_hash,
    deposit_cents = coalesce((
      select sum(case s.deposit_kind
                   when 'fixed' then least(s.deposit_amount, i.price_cents)
                   when 'percent' then round(i.price_cents * s.deposit_amount / 100.0)::integer
                   else 0 end)
      from public.appointment_items i join public.services s on s.id = i.service_id
      where i.appointment_id = a.id
    ), 0)
  where a.id = v_appointment_id;
  return v_appointment_id;
end;
$$;

-- A client cancels their own online booking (service role only; the site
-- checks the salon's cancellation cutoff first).
create function public.cancel_online_appointment(p_appointment_id uuid, p_manage_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.appointments set
    status = 'canceled',
    canceled_at = now(),
    cancel_reason = 'Canceled online by the client',
    updated_by = null
  where id = p_appointment_id and manage_token_hash = p_manage_token_hash and status in ('booked', 'confirmed');
  if not found then
    raise exception 'Appointment not found or can''t be canceled' using errcode = 'P0002';
  end if;
end;
$$;

-- The client with this phone number (compared by its last 10 digits) or
-- email at the salon, or a new client with the details given when there's
-- none and p_first_name is set (service role only).
create function public.find_online_client(
  p_business_id uuid,
  p_phone_digits text,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_digits text := right(regexp_replace(coalesce(p_phone_digits, ''), '\D', '', 'g'), 10);
begin
  select c.id into v_client_id
  from public.clients c
  where c.business_id = p_business_id
    and (
      (length(v_digits) = 10 and right(c.phone_digits, 10) = v_digits)
      or (nullif(trim(p_email), '') is not null and lower(c.email) = lower(trim(p_email)))
    )
  order by c.created_at
  limit 1;

  if v_client_id is null and nullif(trim(p_first_name), '') is not null then
    insert into public.clients (business_id, first_name, last_name, phone, email)
    values (p_business_id, trim(p_first_name), coalesce(trim(p_last_name), ''), nullif(trim(p_phone), ''), nullif(lower(trim(p_email)), ''))
    returning id into v_client_id;
  end if;
  return v_client_id;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.save_online_appointment(uuid, uuid, uuid, text, jsonb, bigint, text) from public, anon, authenticated;
revoke all on function public.cancel_online_appointment(uuid, text) from public, anon, authenticated;
revoke all on function public.find_online_client(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
grant execute on function public.save_online_appointment(uuid, uuid, uuid, text, jsonb, bigint, text) to service_role;
grant execute on function public.cancel_online_appointment(uuid, text) to service_role;
grant execute on function public.find_online_client(uuid, text, text, text, text, text) to service_role;
