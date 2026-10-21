-- Resources (chairs, rooms, stations), appointments and appointment items.
--
-- An appointment is one client visit. Its items are the services in it,
-- each with its own stylist, optional resource and start time, so one visit
-- can involve several stylists (color with one, blow-dry with another).
--
-- Each item keeps a copy of the service's timing and price when it was
-- booked, so later menu changes don't move existing appointments:
--   active_minutes      stylist busy
--   processing_minutes  stylist free (other clients can be booked in)
--   finishing_minutes   stylist busy again
-- The resource is held for the whole item, processing included.
--
-- Instants are UTC (timestamptz). The booking rules (who can be booked
-- when) live in lib/scheduling/booking.ts, not here.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.resource_kind as enum ('chair', 'room', 'station');

-- canceled and no_show appointments don't hold time on the calendar.
create type public.appointment_status as enum ('booked', 'confirmed', 'checked_in', 'completed', 'canceled', 'no_show');

create type public.appointment_source as enum ('front_desk', 'phone', 'online', 'walk_in', 'import');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.resources (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  location_id  uuid not null,
  name         text not null check (length(trim(name)) > 0),
  kind         public.resource_kind not null,
  -- Out of use (e.g. a broken chair) resources stay on past appointments
  -- but can't be booked.
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, business_id),
  unique (id, location_id),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade
);

create unique index resources_location_id_name_key on public.resources (location_id, lower(trim(name)));
create index resources_business_id_idx on public.resources (business_id);

create table public.appointments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  location_id    uuid not null,
  -- Null for a walk-in who didn't leave details.
  client_id      uuid,
  -- The span of the visit: earliest item start to latest item end. Kept in
  -- step with the items by a trigger.
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         public.appointment_status not null default 'booked',
  source         public.appointment_source not null default 'front_desk',
  deposit_cents  integer not null default 0 check (deposit_cents >= 0),
  notes          text check (length(notes) <= 2000),
  created_by     uuid,
  canceled_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (starts_at < ends_at),
  check ((status = 'canceled') = (canceled_at is not null)),
  -- Lets items enforce that they're in the same business and location.
  unique (id, business_id, location_id),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete set null (client_id),
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index appointments_location_starts_at_idx on public.appointments (location_id, starts_at);
create index appointments_client_id_idx on public.appointments (client_id, starts_at desc) where client_id is not null;
create index appointments_business_id_idx on public.appointments (business_id);

create table public.appointment_items (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  location_id         uuid not null,
  appointment_id      uuid not null,
  service_id          uuid not null,
  staff_id            uuid not null,
  resource_id         uuid,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  active_minutes      integer not null check (active_minutes > 0),
  processing_minutes  integer not null default 0 check (processing_minutes >= 0),
  finishing_minutes   integer not null default 0 check (finishing_minutes >= 0),
  price_cents         integer not null check (price_cents >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (ends_at = starts_at + make_interval(mins => active_minutes + processing_minutes + finishing_minutes)),
  check (processing_minutes > 0 or finishing_minutes = 0),
  foreign key (appointment_id, business_id, location_id)
    references public.appointments (id, business_id, location_id) on delete cascade,
  foreign key (service_id, business_id) references public.services (id, business_id),
  foreign key (staff_id, business_id) references public.staff (id, business_id),
  -- The resource must be at the appointment's location.
  foreign key (resource_id, location_id) references public.resources (id, location_id)
);

create index appointment_items_appointment_id_idx on public.appointment_items (appointment_id);
create index appointment_items_location_starts_at_idx on public.appointment_items (location_id, starts_at);
create index appointment_items_staff_starts_at_idx on public.appointment_items (staff_id, starts_at);
create index appointment_items_resource_starts_at_idx on public.appointment_items (resource_id, starts_at) where resource_id is not null;
create index appointment_items_service_id_idx on public.appointment_items (service_id);
create index appointment_items_business_id_idx on public.appointment_items (business_id);

create trigger resources_set_updated_at before update on public.resources
  for each row execute function public.set_updated_at();
create trigger appointments_set_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();
create trigger appointment_items_set_updated_at before update on public.appointment_items
  for each row execute function public.set_updated_at();

-- Keep each appointment's span equal to its items' span. An appointment
-- whose last item is removed keeps its old span.
create function private.sync_appointment_span()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'DELETE' then
    v_ids := array[old.appointment_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.appointment_id, new.appointment_id];
  else
    v_ids := array[new.appointment_id];
  end if;

  update public.appointments a
  set starts_at = span.starts_at, ends_at = span.ends_at
  from (
    select appointment_id, min(starts_at) as starts_at, max(ends_at) as ends_at
    from public.appointment_items
    where appointment_id = any (v_ids)
    group by appointment_id
  ) span
  where a.id = span.appointment_id
    and (a.starts_at, a.ends_at) is distinct from (span.starts_at, span.ends_at);
  return null;
end;
$$;

create trigger appointment_items_sync_span
  after insert or update of starts_at, ends_at, appointment_id or delete on public.appointment_items
  for each row execute function private.sync_appointment_span();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- resources: members read; owners and managers manage.
-- appointments and items: members read (everyone works from the calendar);
-- owners, managers and front desk book and change them. Appointments are
-- canceled rather than deleted; items can be removed while editing a visit.
-- ---------------------------------------------------------------------------

alter table public.resources enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_items enable row level security;

create policy "Members can view resources"
  on public.resources for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners and managers can manage resources"
  on public.resources for all to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Members can view appointments"
  on public.appointments for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Front of house can book appointments"
  on public.appointments for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can change appointments"
  on public.appointments for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

create policy "Members can view appointment items"
  on public.appointment_items for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Front of house can manage appointment items"
  on public.appointment_items for all to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
