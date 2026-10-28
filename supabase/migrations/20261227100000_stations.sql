-- Chairs and stations: the salon's chairs, color bar, shampoo bowls and
-- rooms (resources), each stylist's home chair, a chair lent to someone else
-- for a shift on a day its stylist is off, and services that need a room.
--
-- The new resource kinds are added here and first used by later statements
-- in other migrations or by the app, never in this file (a new enum value
-- can't be used in the transaction that adds it).

alter type public.resource_kind add value if not exists 'color_bar';
alter type public.resource_kind add value if not exists 'shampoo';

-- Where in the salon it is, optional ("Upstairs", "Back room").
alter table public.resources
  add column area text check (area is null or length(trim(area)) between 1 and 60);

-- A service done in a room (a facial, a smoothing treatment): booking it
-- reserves a free room, and it can't be booked when none is free.
alter table public.services
  add column needs_room boolean not null default false;

-- ---------------------------------------------------------------------------
-- Home chairs
-- ---------------------------------------------------------------------------

alter table public.staff
  add column home_resource_id uuid references public.resources (id) on delete set null;

-- One person's home at a time.
create unique index staff_home_resource_key on public.staff (home_resource_id) where home_resource_id is not null and is_active;

-- ---------------------------------------------------------------------------
-- Lending a chair for a shift
-- ---------------------------------------------------------------------------

create table public.station_assignments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  location_id   uuid not null,
  resource_id   uuid not null,
  staff_id      uuid not null,
  on_date       date not null,
  start_minute  integer not null check (start_minute between 0 and 1439),
  end_minute    integer not null check (end_minute between 1 and 1440 and end_minute > start_minute),
  note          text check (note is null or length(note) <= 200),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (resource_id, location_id) references public.resources (id, location_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  -- Two people can't have the same station at the same time. Deferrable,
  -- so moving every date at once (the week test's time machine) is checked
  -- at the end of the statement.
  constraint station_assignments_no_overlap exclude using gist (
    resource_id with =, on_date with =, int4range(start_minute, end_minute) with &&
  ) deferrable initially immediate
);

create index station_assignments_staff_idx on public.station_assignments (staff_id, on_date);
create index station_assignments_location_idx on public.station_assignments (location_id, on_date);

alter table public.station_assignments enable row level security;

create policy "Members can view station assignments"
  on public.station_assignments for select to authenticated
  using ((select private.is_business_member(business_id)));
-- Written only through assign_station / unassign_station.

-- When someone works on a day: their live hours less approved full-day time
-- off, as [start, end) minutes (null when they're off).
create function private.working_span(p_staff_id uuid, p_date date)
returns int4range
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.staff_time_off t
      where t.staff_id = p_staff_id and t.status = 'approved' and p_date between t.starts_on and t.ends_on and t.start_minute is null
    ) then null
    -- No hours that day: null (a range of no rows would be unbounded).
    else (
      select case when count(*) > 0 then int4range(min((h ->> 'start')::int), max((h ->> 'end')::int)) end
      from jsonb_array_elements(private.live_hours(p_staff_id, p_date)) h
    )
  end;
$$;

revoke all on function private.working_span(uuid, date) from public;

-- Lends a station to someone for a shift on one day (owners and managers):
-- by default the whole of their working day. A home chair can only be lent
-- while its own stylist isn't working; an overlap with another loan is
-- refused by the constraint (23P01).
create function public.assign_station(p_resource_id uuid, p_staff_id uuid, p_on_date date, p_start integer default null, p_end integer default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource public.resources;
  v_staff public.staff;
  v_owner public.staff;
  v_span int4range;
  v_owner_span int4range;
  v_start integer := p_start;
  v_end integer := p_end;
  v_id uuid;
begin
  select * into v_resource from public.resources where id = p_resource_id;
  if v_resource.id is null or not private.has_business_role(v_resource.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can assign stations.' using errcode = '42501';
  end if;
  if not v_resource.is_active then
    raise exception '% is out of use.', v_resource.name using errcode = '22023';
  end if;
  select * into v_staff from public.staff where id = p_staff_id and business_id = v_resource.business_id and location_id = v_resource.location_id and is_active;
  if v_staff.id is null then
    raise exception 'That person isn''t on the team here.' using errcode = '22023';
  end if;
  if v_staff.home_resource_id = p_resource_id then
    raise exception '% is already %''s chair.', v_resource.name, v_staff.first_name using errcode = '22023';
  end if;

  v_span := private.working_span(p_staff_id, p_on_date);
  if v_start is null or v_end is null then
    if v_span is null then
      raise exception '% isn''t working that day.', v_staff.first_name using errcode = '22023';
    end if;
    v_start := coalesce(v_start, lower(v_span));
    v_end := coalesce(v_end, upper(v_span));
  end if;
  if v_start < 0 or v_end > 1440 or v_end <= v_start or v_start % 5 <> 0 or v_end % 5 <> 0 then
    raise exception 'Choose a start and end on 5-minute steps, the end after the start.' using errcode = '22023';
  end if;

  select * into v_owner from public.staff where home_resource_id = p_resource_id and is_active;
  if v_owner.id is not null then
    v_owner_span := private.working_span(v_owner.id, p_on_date);
    if v_owner_span is not null and v_owner_span && int4range(v_start, v_end) then
      raise exception '% is %''s chair, and % is working then.', v_resource.name, v_owner.first_name, v_owner.first_name using errcode = '22023';
    end if;
  end if;

  insert into public.station_assignments (business_id, location_id, resource_id, staff_id, on_date, start_minute, end_minute, note, created_by)
  values (v_resource.business_id, v_resource.location_id, p_resource_id, p_staff_id, p_on_date, v_start, v_end, nullif(trim(p_note), ''),
          private.current_staff_id(v_resource.business_id))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.unassign_station(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.station_assignments where id = p_assignment_id;
  if v_business is null or not private.has_business_role(v_business, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can assign stations.' using errcode = '42501';
  end if;
  delete from public.station_assignments where id = p_assignment_id;
end;
$$;

-- Sets (or clears) someone's home chair (owners and managers): a chair (or
-- another station, like a barber's) at their location, nobody else's.
create function public.set_home_station(p_staff_id uuid, p_resource_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
  v_resource public.resources;
  v_other text;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null or not private.has_business_role(v_staff.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can set home chairs.' using errcode = '42501';
  end if;
  if p_resource_id is not null then
    select * into v_resource from public.resources where id = p_resource_id and location_id = v_staff.location_id;
    if v_resource.id is null or v_resource.kind::text not in ('chair', 'station') then
      raise exception 'Choose a chair at their location.' using errcode = '22023';
    end if;
    select first_name into v_other from public.staff where home_resource_id = p_resource_id and is_active and id <> p_staff_id;
    if v_other is not null then
      raise exception '% is already %''s chair.', v_resource.name, v_other using errcode = '22023';
    end if;
  end if;
  update public.staff set home_resource_id = p_resource_id where id = p_staff_id;
end;
$$;

grant execute on function public.assign_station(uuid, uuid, date, integer, integer, text) to authenticated;
grant execute on function public.unassign_station(uuid) to authenticated;
grant execute on function public.set_home_station(uuid, uuid) to authenticated;
revoke execute on function public.assign_station(uuid, uuid, date, integer, integer, text) from anon;
revoke execute on function public.unassign_station(uuid) from anon;
revoke execute on function public.set_home_station(uuid, uuid) from anon;
