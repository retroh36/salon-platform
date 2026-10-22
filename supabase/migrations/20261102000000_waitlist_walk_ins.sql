-- The waitlist and walk-ins.
--
-- A waitlist entry is a client who'd like services in a date range, with
-- any or some stylists, at some times of day. When time opens up (a
-- cancellation, a no-show, or a Denise fix that moves someone), Denise
-- matches entries to it (lib/scheduling/waitlist.ts) and staff book them
-- through the booking rules; staff, not Denise, contact the client.
--
-- A walk-in is someone at the front desk now: a name, a phone number and
-- the service they want, queued until they're booked or leave.

create type public.waitlist_status as enum ('waiting', 'booked', 'removed');

create table public.waitlist_entries (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null,
  client_id       uuid not null,
  service_ids     uuid[] not null check (cardinality(service_ids) between 1 and 5),
  -- Empty: any stylist who does the services.
  staff_ids       uuid[] not null default '{}',
  from_date       date not null,
  to_date         date not null,
  -- Times of day: 'morning', 'afternoon', 'evening'. Empty: any time.
  windows         text[] not null default '{}' check (windows <@ array['morning', 'afternoon', 'evening']),
  notes           text check (length(notes) <= 500),
  status          public.waitlist_status not null default 'waiting',
  appointment_id  uuid,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 92),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade,
  foreign key (appointment_id, business_id, location_id) references public.appointments (id, business_id, location_id) on delete set null (appointment_id),
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index waitlist_entries_waiting_idx on public.waitlist_entries (location_id, to_date) where status = 'waiting';
create index waitlist_entries_business_id_idx on public.waitlist_entries (business_id);
create index waitlist_entries_client_idx on public.waitlist_entries (client_id);

create type public.walk_in_status as enum ('waiting', 'booked', 'left');

create table public.walk_ins (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null,
  name            text not null check (length(trim(name)) > 0 and length(name) <= 100),
  phone           text check (length(phone) <= 40),
  service_id      uuid not null,
  client_id       uuid,
  status          public.walk_in_status not null default 'waiting',
  appointment_id  uuid,
  arrived_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (service_id, business_id) references public.services (id, business_id),
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete set null (client_id),
  foreign key (appointment_id, business_id, location_id) references public.appointments (id, business_id, location_id) on delete set null (appointment_id),
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index walk_ins_waiting_idx on public.walk_ins (location_id, arrived_at) where status = 'waiting';
create index walk_ins_business_id_idx on public.walk_ins (business_id);

create trigger waitlist_entries_set_updated_at before update on public.waitlist_entries
  for each row execute function public.set_updated_at();
create trigger walk_ins_set_updated_at before update on public.walk_ins
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: everyone sees them; front of house (owners, managers,
-- front desk) adds and updates them, as with booking.
-- ---------------------------------------------------------------------------

alter table public.waitlist_entries enable row level security;
alter table public.walk_ins enable row level security;

create policy "Members can view the waitlist"
  on public.waitlist_entries for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Front of house can add to the waitlist"
  on public.waitlist_entries for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can update the waitlist"
  on public.waitlist_entries for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

create policy "Members can view walk-ins"
  on public.walk_ins for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Front of house can add walk-ins"
  on public.walk_ins for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can update walk-ins"
  on public.walk_ins for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
