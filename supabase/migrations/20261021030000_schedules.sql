-- Staff schedules, time off, location opening hours, staff levels and
-- commission.
--
-- Schedule times are local wall-clock times at the location: minutes since
-- midnight (0-1440) on local dates. A 9:00 shift stays 9:00 across daylight
-- saving changes. Instants such as appointments are stored in UTC; the
-- scheduling code (lib/scheduling) converts using the location's timezone.
--
-- Weekdays are ISO: 1 = Monday ... 7 = Sunday.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Location opening hours (replaces locations.hours)
-- ---------------------------------------------------------------------------

alter table public.locations drop column hours;

create table public.location_hours (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  location_id   uuid not null,
  weekday       smallint not null check (weekday between 1 and 7),
  start_minute  smallint not null check (start_minute between 0 and 1435 and start_minute % 5 = 0),
  end_minute    smallint not null check (end_minute between 5 and 1440 and end_minute % 5 = 0),
  check (start_minute < end_minute),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  exclude using gist (
    location_id with =,
    weekday with =,
    int4range(start_minute, end_minute) with &&
  )
);

create index location_hours_business_id_idx on public.location_hours (business_id);

-- ---------------------------------------------------------------------------
-- Staff level
-- ---------------------------------------------------------------------------

create type public.staff_level as enum ('junior', 'senior', 'master');

alter table public.staff add column level public.staff_level;

-- ---------------------------------------------------------------------------
-- Weekly working hours. Several rows per day make a split shift.
-- ---------------------------------------------------------------------------

create table public.staff_working_hours (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  staff_id      uuid not null,
  weekday       smallint not null check (weekday between 1 and 7),
  start_minute  smallint not null check (start_minute between 0 and 1435 and start_minute % 5 = 0),
  end_minute    smallint not null check (end_minute between 5 and 1440 and end_minute % 5 = 0),
  check (start_minute < end_minute),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  exclude using gist (
    staff_id with =,
    weekday with =,
    int4range(start_minute, end_minute) with &&
  )
);

create index staff_working_hours_business_id_idx on public.staff_working_hours (business_id);

-- ---------------------------------------------------------------------------
-- One-off changes: on this date, these hours replace the weekly hours.
-- (A day off is time off, not an override.)
-- ---------------------------------------------------------------------------

create table public.staff_schedule_overrides (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  staff_id      uuid not null,
  on_date       date not null,
  start_minute  smallint not null check (start_minute between 0 and 1435 and start_minute % 5 = 0),
  end_minute    smallint not null check (end_minute between 5 and 1440 and end_minute % 5 = 0),
  created_at    timestamptz not null default now(),
  check (start_minute < end_minute),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  exclude using gist (
    staff_id with =,
    on_date with =,
    int4range(start_minute, end_minute) with &&
  )
);

create index staff_schedule_overrides_staff_date_idx on public.staff_schedule_overrides (staff_id, on_date);
create index staff_schedule_overrides_business_id_idx on public.staff_schedule_overrides (business_id);

-- ---------------------------------------------------------------------------
-- Time off. Whole days from starts_on to ends_on (inclusive), or part of a
-- single day when start_minute/end_minute are set. Only approved time off
-- blocks availability.
-- ---------------------------------------------------------------------------

create type public.time_off_reason as enum ('vacation', 'sick', 'personal', 'other');
create type public.time_off_status as enum ('requested', 'approved', 'declined');

create table public.staff_time_off (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  staff_id      uuid not null,
  starts_on     date not null,
  ends_on       date not null,
  start_minute  smallint check (start_minute between 0 and 1435 and start_minute % 5 = 0),
  end_minute    smallint check (end_minute between 5 and 1440 and end_minute % 5 = 0),
  reason        public.time_off_reason not null,
  note          text check (length(note) <= 500),
  status        public.time_off_status not null default 'requested',
  requested_by  uuid not null,
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (starts_on <= ends_on),
  check (ends_on - starts_on <= 366),
  -- Part-day time off: both times, on a single day.
  check (
    (start_minute is null and end_minute is null)
    or (start_minute is not null and end_minute is not null and start_minute < end_minute and starts_on = ends_on)
  ),
  -- A decision records who made it and when.
  check ((status = 'requested') = (decided_by is null and decided_at is null)),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (requested_by, business_id) references public.staff (id, business_id),
  foreign key (decided_by, business_id) references public.staff (id, business_id)
);

create index staff_time_off_staff_dates_idx on public.staff_time_off (staff_id, starts_on, ends_on);
create index staff_time_off_business_id_idx on public.staff_time_off (business_id, status);

create trigger staff_time_off_set_updated_at before update on public.staff_time_off
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Commission. Pay information, so only owners, managers and the staff
-- member themselves can read it.
-- ---------------------------------------------------------------------------

create table public.staff_compensation (
  staff_id                 uuid primary key,
  business_id              uuid not null,
  service_commission_pct   numeric(5, 2) not null default 0 check (service_commission_pct between 0 and 100),
  retail_commission_pct    numeric(5, 2) not null default 0 check (retail_commission_pct between 0 and 100),
  updated_at               timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);

create index staff_compensation_business_id_idx on public.staff_compensation (business_id);

create trigger staff_compensation_set_updated_at before update on public.staff_compensation
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.location_hours enable row level security;
alter table public.staff_working_hours enable row level security;
alter table public.staff_schedule_overrides enable row level security;
alter table public.staff_time_off enable row level security;
alter table public.staff_compensation enable row level security;

-- Opening hours, weekly hours and one-off changes: members read (booking
-- needs them); owners and managers manage.

create policy "Members can view opening hours"
  on public.location_hours for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners and managers can manage opening hours"
  on public.location_hours for all to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Members can view working hours"
  on public.staff_working_hours for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners and managers can manage working hours"
  on public.staff_working_hours for all to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Members can view schedule changes"
  on public.staff_schedule_overrides for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners and managers can manage schedule changes"
  on public.staff_schedule_overrides for all to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

-- Time off: everyone sees approved time off; requests and declined requests
-- are visible to the requester and to owners and managers.
create policy "Members can view approved time off, and their own requests"
  on public.staff_time_off for select to authenticated
  using (
    (select private.is_business_member(business_id))
    and (
      status = 'approved'
      or (select private.is_current_staff(business_id, staff_id))
      or (select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]))
    )
  );

-- Staff request time off for themselves; owners and managers add any.
create policy "Staff can request time off; managers can add it"
  on public.staff_time_off for insert to authenticated
  with check (
    (select private.is_current_staff(business_id, requested_by))
    and (decided_by is null or (select private.is_current_staff(business_id, decided_by)))
    and (
      (select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]))
      or (
        staff_id = requested_by
        and status = 'requested'
      )
    )
  );

create policy "Owners and managers can decide and edit time off"
  on public.staff_time_off for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check (
    (select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]))
    and (decided_by is null or (select private.is_current_staff(business_id, decided_by)))
  );

-- Staff can withdraw their own pending request; owners and managers can
-- remove any time off.
create policy "Staff can withdraw pending requests; managers can remove time off"
  on public.staff_time_off for delete to authenticated
  using (
    (select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]))
    or (status = 'requested' and (select private.is_current_staff(business_id, staff_id)))
  );

create policy "Managers and the staff member can view commission"
  on public.staff_compensation for select to authenticated
  using (
    (select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]))
    or (select private.is_current_staff(business_id, staff_id))
  );
create policy "Owners and managers can manage commission"
  on public.staff_compensation for all to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

-- ---------------------------------------------------------------------------
-- Replace a whole set of hours in one transaction. security invoker: RLS
-- decides whether the caller may do it. p_hours is a JSON array of
-- {"weekday": 1-7, "start_minute": int, "end_minute": int} (or "on_date"
-- instead of "weekday" for a one-off change).
-- ---------------------------------------------------------------------------

create function public.set_staff_weekly_hours(p_business_id uuid, p_staff_id uuid, p_hours jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_hours) is distinct from 'array' then
    raise exception 'p_hours must be a JSON array' using errcode = '22023';
  end if;

  delete from public.staff_working_hours where staff_id = p_staff_id and business_id = p_business_id;

  insert into public.staff_working_hours (business_id, staff_id, weekday, start_minute, end_minute)
  select p_business_id, p_staff_id, (h ->> 'weekday')::smallint, (h ->> 'start_minute')::smallint, (h ->> 'end_minute')::smallint
  from jsonb_array_elements(p_hours) h;
end;
$$;

create function public.set_location_hours(p_business_id uuid, p_location_id uuid, p_hours jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_hours) is distinct from 'array' then
    raise exception 'p_hours must be a JSON array' using errcode = '22023';
  end if;

  delete from public.location_hours where location_id = p_location_id and business_id = p_business_id;

  insert into public.location_hours (business_id, location_id, weekday, start_minute, end_minute)
  select p_business_id, p_location_id, (h ->> 'weekday')::smallint, (h ->> 'start_minute')::smallint, (h ->> 'end_minute')::smallint
  from jsonb_array_elements(p_hours) h;
end;
$$;

-- An empty array removes the change, so the weekly hours apply again.
create function public.set_staff_day_override(p_business_id uuid, p_staff_id uuid, p_on_date date, p_hours jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_hours) is distinct from 'array' then
    raise exception 'p_hours must be a JSON array' using errcode = '22023';
  end if;

  delete from public.staff_schedule_overrides
  where staff_id = p_staff_id and business_id = p_business_id and on_date = p_on_date;

  insert into public.staff_schedule_overrides (business_id, staff_id, on_date, start_minute, end_minute)
  select p_business_id, p_staff_id, p_on_date, (h ->> 'start_minute')::smallint, (h ->> 'end_minute')::smallint
  from jsonb_array_elements(p_hours) h;
end;
$$;

revoke all on function public.set_staff_weekly_hours(uuid, uuid, jsonb) from public, anon;
revoke all on function public.set_location_hours(uuid, uuid, jsonb) from public, anon;
revoke all on function public.set_staff_day_override(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.set_staff_weekly_hours(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_location_hours(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_staff_day_override(uuid, uuid, date, jsonb) to authenticated;
