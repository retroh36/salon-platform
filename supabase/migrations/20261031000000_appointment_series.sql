-- Recurring appointments: a series of visits every so many weeks, with the
-- same stylists and services, for a number of visits or until a date.
--
-- Each visit is an ordinary appointment (booked through save_appointment,
-- after the booking rules), linked to its series with its place in it.
-- Changing or canceling "this and following" or "all" is done visit by
-- visit in the app (lib/scheduling/series.ts), each checked against the
-- rules.

create table public.appointment_series (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null,
  client_id       uuid,
  interval_weeks  smallint not null check (interval_weeks between 1 and 52),
  -- How it ends: after a number of visits, or on a date.
  occurrences     smallint check (occurrences between 2 and 52),
  ends_on         date,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  check ((occurrences is null) <> (ends_on is null)),
  unique (id, business_id),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete set null (client_id),
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index appointment_series_business_id_idx on public.appointment_series (business_id);
create index appointment_series_location_id_idx on public.appointment_series (location_id);

alter table public.appointments
  add column series_id uuid,
  -- Its place in the series (1 = first); kept, but meaningless, if the
  -- series is deleted.
  add column series_index smallint check (series_index >= 1),
  add foreign key (series_id, business_id) references public.appointment_series (id, business_id) on delete set null (series_id);

create index appointments_series_idx on public.appointments (series_id, series_index) where series_id is not null;

alter table public.appointment_series enable row level security;

create policy "Members can view series"
  on public.appointment_series for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Front of house can start series"
  on public.appointment_series for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- Links a booked visit to its series (front of house, same client).
create function public.set_appointment_series(p_appointment_id uuid, p_series_id uuid, p_index integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_series public.appointment_series;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  select * into v_series from public.appointment_series where id = p_series_id;
  if v_appointment.id is null or v_series.id is null or v_series.business_id <> v_appointment.business_id
     or not private.has_business_role(v_appointment.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_series.client_id is distinct from v_appointment.client_id then
    raise exception 'A series is for one client' using errcode = '22023';
  end if;
  update public.appointments set series_id = p_series_id, series_index = p_index where id = p_appointment_id;
end;
$$;

revoke all on function public.set_appointment_series(uuid, uuid, integer) from public, anon;
grant execute on function public.set_appointment_series(uuid, uuid, integer) to authenticated;
