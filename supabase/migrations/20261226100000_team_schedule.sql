-- The team schedule (Scheduling → Team schedule).
--
-- - Repeating patterns: a person's weekly hours can repeat over 2 to 4
--   weeks ("Tue–Sat 9–5, every other Saturday off"): staff_working_hours
--   rows carry the week of the cycle, and staff carry how many weeks it has
--   and the week it counts from.
-- - Days off in a published week: staff_days_off. Together with the
--   one-off changes (staff_schedule_overrides) they're a week's changes to
--   the pattern; the booking rules read them (lib/scheduling/load.ts).
-- - Drafts: owners and managers change a week in schedule_drafts (a whole
--   day's shifts at a time), which nothing else reads, until they publish
--   the week (publish_schedule_week): the changes become one-off changes
--   and days off, each person whose hours changed gets a notice in the app,
--   and the publish is recorded.
--
-- Times are wall-clock minutes on local dates, like the rest of the
-- schedule. Shifts are JSON lists of {"start", "end"} minutes, earliest
-- first, apart (a split shift is two).

-- ---------------------------------------------------------------------------
-- Repeating patterns
-- ---------------------------------------------------------------------------

alter table public.staff
  add column hours_cycle_weeks smallint not null default 1 check (hours_cycle_weeks between 1 and 4),
  -- A day in the cycle's first week (any day of it).
  add column hours_cycle_starts_on date,
  add constraint staff_hours_cycle_start check (hours_cycle_weeks = 1 or hours_cycle_starts_on is not null);

alter table public.staff_working_hours add column cycle_week smallint not null default 0 check (cycle_week between 0 and 3);

do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.staff_working_hours'::regclass and contype = 'x';
  execute format('alter table public.staff_working_hours drop constraint %I', v_name);
end;
$$;

alter table public.staff_working_hours add constraint staff_working_hours_no_overlap exclude using gist (
  staff_id with =,
  cycle_week with =,
  weekday with =,
  int4range(start_minute, end_minute) with &&
);

-- ---------------------------------------------------------------------------
-- Days off in a published week (a day the pattern has hours, now off)
-- ---------------------------------------------------------------------------

create table public.staff_days_off (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  staff_id     uuid not null,
  on_date      date not null,
  created_at   timestamptz not null default now(),
  -- Checked at the end of each statement, so dates can all move together.
  constraint staff_days_off_once unique (staff_id, on_date) deferrable,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);

create index staff_days_off_business_id_idx on public.staff_days_off (business_id);

alter table public.staff_days_off enable row level security;

create policy "Members can view days off"
  on public.staff_days_off for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners and managers can manage days off"
  on public.staff_days_off for all to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

-- ---------------------------------------------------------------------------
-- Drafts and publishes
-- ---------------------------------------------------------------------------

create table public.schedule_drafts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  location_id  uuid not null,
  staff_id     uuid not null,
  on_date      date not null,
  -- The whole day as it will be: [] is a day off.
  shifts       jsonb not null check (jsonb_typeof(shifts) = 'array'),
  updated_by   uuid not null,
  updated_at   timestamptz not null default now(),
  constraint schedule_drafts_once unique (staff_id, on_date) deferrable,
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (updated_by, business_id) references public.staff (id, business_id)
);

create index schedule_drafts_location_date_idx on public.schedule_drafts (location_id, on_date);
create index schedule_drafts_business_id_idx on public.schedule_drafts (business_id);

alter table public.schedule_drafts enable row level security;

-- Only owners and managers see drafts; nothing writes them directly.
create policy "Owners and managers can view drafts"
  on public.schedule_drafts for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create table public.schedule_publishes (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  location_id      uuid not null,
  week_start       date not null,
  published_by     uuid not null,
  published_at     timestamptz not null default now(),
  days_changed     integer not null check (days_changed >= 0),
  people_notified  integer not null check (people_notified >= 0),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (published_by, business_id) references public.staff (id, business_id)
);

create index schedule_publishes_location_week_idx on public.schedule_publishes (location_id, week_start, published_at desc);
create index schedule_publishes_business_id_idx on public.schedule_publishes (business_id);

alter table public.schedule_publishes enable row level security;

create policy "Members can view publishes"
  on public.schedule_publishes for select to authenticated
  using ((select private.is_business_member(business_id)));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Shifts checked and in order: up to 4 a day, on 5-minute steps, apart.
create function private.clean_shifts(p_shifts jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_shift jsonb;
  v_start integer;
  v_end integer;
  v_prev integer := -1;
  v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_shifts) is distinct from 'array' or jsonb_array_length(p_shifts) > 4 then
    raise exception 'A day has up to 4 shifts' using errcode = '22023';
  end if;
  for v_shift in select x from jsonb_array_elements(p_shifts) x order by (x ->> 'start')::integer loop
    v_start := (v_shift ->> 'start')::integer;
    v_end := (v_shift ->> 'end')::integer;
    if v_start is null or v_end is null or v_start < 0 or v_end > 1440 or v_start % 5 <> 0 or v_end % 5 <> 0 or v_start >= v_end then
      raise exception 'A shift needs a start before its end, on 5-minute steps' using errcode = '22023';
    end if;
    if v_start <= v_prev then
      raise exception 'Shifts on one day can''t overlap or touch' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('start', v_start, 'end', v_end));
    v_prev := v_end;
  end loop;
  return v_out;
end;
$$;

-- Their repeating pattern's shifts on a date (lib/scheduling/availability.ts
-- patternHours).
create function private.pattern_hours(p_staff_id uuid, p_date date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('start', h.start_minute, 'end', h.end_minute) order by h.start_minute), '[]'::jsonb)
  from public.staff s
  join public.staff_working_hours h on h.staff_id = s.id
  where s.id = p_staff_id
    and h.weekday = extract(isodow from p_date)
    and h.cycle_week = case
      when s.hours_cycle_weeks > 1 then
        ((((p_date - (extract(isodow from p_date)::integer - 1))
            - (s.hours_cycle_starts_on - (extract(isodow from s.hours_cycle_starts_on)::integer - 1))) / 7)
          % s.hours_cycle_weeks + s.hours_cycle_weeks) % s.hours_cycle_weeks
      else 0
    end;
$$;

-- Their published shifts on a date: a day off, else the one-off change, else
-- the pattern (availability.ts hoursOn).
create function private.live_hours(p_staff_id uuid, p_date date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.staff_days_off d where d.staff_id = p_staff_id and d.on_date = p_date) then '[]'::jsonb
    when exists (select 1 from public.staff_schedule_overrides o where o.staff_id = p_staff_id and o.on_date = p_date) then
      (select jsonb_agg(jsonb_build_object('start', o.start_minute, 'end', o.end_minute) order by o.start_minute)
       from public.staff_schedule_overrides o where o.staff_id = p_staff_id and o.on_date = p_date)
    else private.pattern_hours(p_staff_id, p_date)
  end;
$$;

-- "9am", "9:30am", "noon", "midnight" (lib/scheduling/time.ts formatMinute).
create function private.say_minute(p_minute integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_minute in (0, 1440) then 'midnight'
    when p_minute = 720 then 'noon'
    else (case when (p_minute / 60) % 12 = 0 then 12 else (p_minute / 60) % 12 end)::text
      || case when p_minute % 60 <> 0 then ':' || lpad((p_minute % 60)::text, 2, '0') else '' end
      || case when p_minute / 60 < 12 then 'am' else 'pm' end
  end;
$$;

-- "9am–1pm, 2pm–6pm", or "off".
create function private.say_shifts(p_shifts jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    string_agg(private.say_minute((s ->> 'start')::integer) || '–' || private.say_minute((s ->> 'end')::integer), ', ' order by (s ->> 'start')::integer),
    'off')
  from jsonb_array_elements(p_shifts) s;
$$;

-- Sets one day's published shifts (whatever's there: a day off, a change
-- or the pattern).
create function private.set_live_day(p_business_id uuid, p_staff_id uuid, p_date date, p_shifts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.staff_schedule_overrides where staff_id = p_staff_id and on_date = p_date;
  delete from public.staff_days_off where staff_id = p_staff_id and on_date = p_date;
  if p_shifts = private.pattern_hours(p_staff_id, p_date) then
    return;
  elsif jsonb_array_length(p_shifts) = 0 then
    insert into public.staff_days_off (business_id, staff_id, on_date) values (p_business_id, p_staff_id, p_date);
  else
    insert into public.staff_schedule_overrides (business_id, staff_id, on_date, start_minute, end_minute)
    select p_business_id, p_staff_id, p_date, (s ->> 'start')::smallint, (s ->> 'end')::smallint
    from jsonb_array_elements(p_shifts) s;
  end if;
end;
$$;

revoke all on function private.clean_shifts(jsonb) from public;
revoke all on function private.pattern_hours(uuid, date) from public;
revoke all on function private.live_hours(uuid, date) from public;
revoke all on function private.say_minute(integer) from public;
revoke all on function private.say_shifts(jsonb) from public;
revoke all on function private.set_live_day(uuid, uuid, date, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Saving drafts
-- ---------------------------------------------------------------------------

-- Saves whole days to the draft: [{staff_id, on_date, shifts}]. A day the
-- same as what's published leaves the draft. Owners and managers.
create function public.save_schedule_drafts(p_location_id uuid, p_days jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_me uuid;
  v_day jsonb;
  v_staff uuid;
  v_date date;
  v_shifts jsonb;
begin
  select business_id into v_business from public.locations where id = p_location_id;
  if v_business is null or not private.has_business_role(v_business, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can change the schedule' using errcode = '42501';
  end if;
  v_me := private.current_staff_id(v_business);
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) > 400 then
    raise exception 'p_days must be a list' using errcode = '22023';
  end if;

  for v_day in select * from jsonb_array_elements(p_days) loop
    v_staff := (v_day ->> 'staff_id')::uuid;
    v_date := (v_day ->> 'on_date')::date;
    if not exists (select 1 from public.staff where id = v_staff and location_id = p_location_id and is_active) then
      raise exception 'Not someone on this team' using errcode = '22023';
    end if;
    v_shifts := private.clean_shifts(v_day -> 'shifts');
    delete from public.schedule_drafts where staff_id = v_staff and on_date = v_date;
    if v_shifts is distinct from private.live_hours(v_staff, v_date) then
      insert into public.schedule_drafts (business_id, location_id, staff_id, on_date, shifts, updated_by)
      values (v_business, p_location_id, v_staff, v_date, v_shifts, v_me);
    end if;
  end loop;
end;
$$;

-- Throws away a week's draft.
create function public.discard_schedule_drafts(p_location_id uuid, p_week_start date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.locations where id = p_location_id;
  if v_business is null or not private.has_business_role(v_business, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can change the schedule' using errcode = '42501';
  end if;
  delete from public.schedule_drafts where location_id = p_location_id and on_date between p_week_start and p_week_start + 6;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publishing a week
-- ---------------------------------------------------------------------------

-- Publishes the week's draft: each changed day becomes what everyone sees
-- (the calendar, online booking, My day), each person whose hours changed
-- gets a notice in the app (a fixed template), and the publish is
-- recorded. Returns {days_changed, people_notified}.
create function public.publish_schedule_week(p_location_id uuid, p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_me uuid;
  v_week date := p_week_start - (extract(isodow from p_week_start)::integer - 1);
  v_draft record;
  v_old jsonb;
  v_days integer := 0;
  v_people integer := 0;
  v_person record;
begin
  select business_id into v_business from public.locations where id = p_location_id;
  if v_business is null or not private.has_business_role(v_business, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can publish the schedule' using errcode = '42501';
  end if;
  v_me := private.current_staff_id(v_business);

  drop table if exists pg_temp.published_changes;
  create temp table published_changes (staff_id uuid, on_date date, line text) on commit drop;

  for v_draft in
    select * from public.schedule_drafts
    where location_id = p_location_id and on_date between v_week and v_week + 6
    order by staff_id, on_date
    for update
  loop
    v_old := private.live_hours(v_draft.staff_id, v_draft.on_date);
    if v_old is distinct from v_draft.shifts then
      perform private.set_live_day(v_business, v_draft.staff_id, v_draft.on_date, v_draft.shifts);
      insert into published_changes values (
        v_draft.staff_id,
        v_draft.on_date,
        to_char(v_draft.on_date, 'Dy, Mon FMDD') || ': ' || private.say_shifts(v_draft.shifts) || ' (was ' || private.say_shifts(v_old) || ')');
      v_days := v_days + 1;
    end if;
    delete from public.schedule_drafts where id = v_draft.id;
  end loop;

  for v_person in
    select c.staff_id,
           string_agg(c.line, '; ' order by c.on_date) filter (where c.n <= 7) as lines,
           count(*) as days
    from (select *, row_number() over (partition by staff_id order by on_date) as n from published_changes) c
    group by c.staff_id
  loop
    insert into public.notifications (business_id, location_id, staff_id, channel, status, template, body)
    values (
      v_business, p_location_id, v_person.staff_id, 'app', 'sent', 'schedule_changed',
      'Your hours changed for the week of ' || to_char(v_week, 'Mon FMDD') || '. ' || v_person.lines
        || case when v_person.days > 7 then ' and ' || (v_person.days - 7) || ' more days.' else '.' end);
    v_people := v_people + 1;
  end loop;

  insert into public.schedule_publishes (business_id, location_id, week_start, published_by, days_changed, people_notified)
  values (v_business, p_location_id, v_week, v_me, v_days, v_people);

  -- Bookings checked against the old hours are checked again.
  if v_days > 0 then
    update public.locations set calendar_version = calendar_version + 1 where id = p_location_id;
  end if;

  return jsonb_build_object('days_changed', v_days, 'people_notified', v_people);
end;
$$;

-- ---------------------------------------------------------------------------
-- Repeating patterns
-- ---------------------------------------------------------------------------

-- Sets someone's repeating pattern: p_weeks weeks (1 to 4) counted from the
-- week of p_starts_on, each with its shifts: [{cycle_week, weekday,
-- start_minute, end_minute}]. Future weeks follow it at once (it's what
-- everyone sees, apart from changes published for single days), so they
-- get a notice. Owners and managers.
create function public.set_staff_pattern(p_staff_id uuid, p_weeks integer, p_starts_on date, p_hours jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff record;
begin
  select id, business_id, location_id into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null or not private.has_business_role(v_staff.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can change the schedule' using errcode = '42501';
  end if;
  if p_weeks not between 1 and 4 or (p_weeks > 1 and p_starts_on is null) then
    raise exception 'A pattern repeats every 1 to 4 weeks' using errcode = '22023';
  end if;
  if jsonb_typeof(p_hours) is distinct from 'array' then
    raise exception 'p_hours must be a JSON array' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_hours) h where (h ->> 'cycle_week')::integer not between 0 and p_weeks - 1) then
    raise exception 'A shift is outside the pattern''s weeks' using errcode = '22023';
  end if;

  delete from public.staff_working_hours where staff_id = p_staff_id;
  insert into public.staff_working_hours (business_id, staff_id, cycle_week, weekday, start_minute, end_minute)
  select v_staff.business_id, p_staff_id, (h ->> 'cycle_week')::smallint, (h ->> 'weekday')::smallint, (h ->> 'start_minute')::smallint, (h ->> 'end_minute')::smallint
  from jsonb_array_elements(p_hours) h;

  update public.staff
  set hours_cycle_weeks = p_weeks, hours_cycle_starts_on = case when p_weeks > 1 then p_starts_on end
  where id = p_staff_id;

  insert into public.notifications (business_id, location_id, staff_id, channel, status, template, body)
  values (v_staff.business_id, v_staff.location_id, p_staff_id, 'app', 'sent', 'schedule_pattern_changed',
          'Your regular hours changed. Your schedule shows the weeks ahead.');

  update public.locations set calendar_version = calendar_version + 1 where id = v_staff.location_id;
end;
$$;

-- Weekly hours from the person's Schedule page replace the pattern with a
-- one-week one.
create or replace function public.set_staff_weekly_hours(p_business_id uuid, p_staff_id uuid, p_hours jsonb)
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

  update public.staff set hours_cycle_weeks = 1, hours_cycle_starts_on = null
  where id = p_staff_id and business_id = p_business_id and hours_cycle_weeks <> 1;
end;
$$;

-- A one-off change replaces a day off on that date too.
create or replace function public.set_staff_day_override(p_business_id uuid, p_staff_id uuid, p_on_date date, p_hours jsonb)
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
  delete from public.staff_days_off
  where staff_id = p_staff_id and business_id = p_business_id and on_date = p_on_date;

  insert into public.staff_schedule_overrides (business_id, staff_id, on_date, start_minute, end_minute)
  select p_business_id, p_staff_id, p_on_date, (h ->> 'start_minute')::smallint, (h ->> 'end_minute')::smallint
  from jsonb_array_elements(p_hours) h;
end;
$$;

revoke all on function public.save_schedule_drafts(uuid, jsonb) from public, anon;
revoke all on function public.discard_schedule_drafts(uuid, date) from public, anon;
revoke all on function public.publish_schedule_week(uuid, date) from public, anon;
revoke all on function public.set_staff_pattern(uuid, integer, date, jsonb) from public, anon;
grant execute on function public.save_schedule_drafts(uuid, jsonb) to authenticated;
grant execute on function public.discard_schedule_drafts(uuid, date) to authenticated;
grant execute on function public.publish_schedule_week(uuid, date) to authenticated;
grant execute on function public.set_staff_pattern(uuid, integer, date, jsonb) to authenticated;
