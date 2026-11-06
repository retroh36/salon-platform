-- Shifts carry a working role (migration …_working_roles.sql): "9–1 Wash
-- House, 2–6 Beauty Bar". A shift in JSON is {"start", "end"} and, when it
-- has one, "role" (the working role's id); patterns and one-off changes
-- keep it in role_id. A shift without a role works as before: all the
-- person's services, online, at their usual pay.
--
-- Everything that moves shifts around (drafts, publishing, patterns, swaps
-- through private.set_live_day) carries the role with it. Drafts and
-- patterns only take a role the person works (staff_working_roles), checked
-- by private.check_shift_roles.

alter table public.staff_working_hours add column role_id uuid references public.working_roles (id) on delete set null;
alter table public.staff_schedule_overrides add column role_id uuid references public.working_roles (id) on delete set null;
create index staff_working_hours_role_idx on public.staff_working_hours (role_id) where role_id is not null;
create index staff_schedule_overrides_role_idx on public.staff_schedule_overrides (role_id) where role_id is not null;

-- A shift as JSON: its role only when it has one.
create function private.shift_json(p_start integer, p_end integer, p_role uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_role is null then jsonb_build_object('start', p_start, 'end', p_end)
              else jsonb_build_object('start', p_start, 'end', p_end, 'role', p_role) end;
$$;

-- Shifts checked and in order: up to 4 a day, on 5-minute steps, apart,
-- each with its role if it has one.
create or replace function private.clean_shifts(p_shifts jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_shift jsonb;
  v_start integer;
  v_end integer;
  v_role uuid;
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
    begin
      v_role := nullif(v_shift ->> 'role', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'That role isn''t one of the salon''s' using errcode = '22023';
    end;
    v_out := v_out || jsonb_build_array(private.shift_json(v_start, v_end, v_role));
    v_prev := v_end;
  end loop;
  return v_out;
end;
$$;

-- Refuses a role the person doesn't work (or one not in use).
create function private.check_shift_roles(p_staff_id uuid, p_roles uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(p_roles) r
    where r is not null
      and not exists (
        select 1 from public.staff_working_roles sr
        join public.working_roles w on w.id = sr.role_id
        where sr.staff_id = p_staff_id and sr.role_id = r and w.archived_at is null
      )
  ) then
    raise exception 'They don''t work that role' using errcode = '22023', hint = 'not_their_role';
  end if;
end;
$$;

create or replace function private.pattern_hours(p_staff_id uuid, p_date date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.shift_json(h.start_minute, h.end_minute, h.role_id) order by h.start_minute), '[]'::jsonb)
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

create or replace function private.live_hours(p_staff_id uuid, p_date date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.staff_days_off d where d.staff_id = p_staff_id and d.on_date = p_date) then '[]'::jsonb
    when exists (select 1 from public.staff_schedule_overrides o where o.staff_id = p_staff_id and o.on_date = p_date) then
      (select jsonb_agg(private.shift_json(o.start_minute, o.end_minute, o.role_id) order by o.start_minute)
       from public.staff_schedule_overrides o where o.staff_id = p_staff_id and o.on_date = p_date)
    else private.pattern_hours(p_staff_id, p_date)
  end;
$$;

-- Sets one day's published shifts. A role the person doesn't work (a swap
-- handing one person's day to another) isn't kept.
create or replace function private.set_live_day(p_business_id uuid, p_staff_id uuid, p_date date, p_shifts jsonb)
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
    insert into public.staff_schedule_overrides (business_id, staff_id, on_date, start_minute, end_minute, role_id)
    select p_business_id, p_staff_id, p_date, (s ->> 'start')::smallint, (s ->> 'end')::smallint, sr.role_id
    from jsonb_array_elements(p_shifts) s
    left join public.staff_working_roles sr on sr.staff_id = p_staff_id and sr.role_id = (s ->> 'role')::uuid;
  end if;
end;
$$;

-- As before, and each shift's role must be one the person works.
create or replace function public.save_schedule_drafts(p_location_id uuid, p_days jsonb)
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
    perform private.check_shift_roles(v_staff, array(select (s ->> 'role')::uuid from jsonb_array_elements(v_shifts) s));
    delete from public.schedule_drafts where staff_id = v_staff and on_date = v_date;
    if v_shifts is distinct from private.live_hours(v_staff, v_date) then
      insert into public.schedule_drafts (business_id, location_id, staff_id, on_date, shifts, updated_by)
      values (v_business, p_location_id, v_staff, v_date, v_shifts, v_me);
    end if;
  end loop;
end;
$$;

-- As before, with each shift's role (`role_id`, one the person works).
create or replace function public.set_staff_pattern(p_staff_id uuid, p_weeks integer, p_starts_on date, p_hours jsonb)
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
  perform private.check_shift_roles(p_staff_id, array(select nullif(h ->> 'role_id', '')::uuid from jsonb_array_elements(p_hours) h));

  delete from public.staff_working_hours where staff_id = p_staff_id;
  insert into public.staff_working_hours (business_id, staff_id, cycle_week, weekday, start_minute, end_minute, role_id)
  select v_staff.business_id, p_staff_id, (h ->> 'cycle_week')::smallint, (h ->> 'weekday')::smallint, (h ->> 'start_minute')::smallint, (h ->> 'end_minute')::smallint,
         nullif(h ->> 'role_id', '')::uuid
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

-- Taking someone off a role takes it off their shifts still to come (their
-- pattern and published days from today), so no shift keeps a role they
-- no longer work.
create function private.staff_role_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.staff_working_hours set role_id = null where staff_id = old.staff_id and role_id = old.role_id;
  update public.staff_schedule_overrides set role_id = null
  where staff_id = old.staff_id and role_id = old.role_id and on_date >= (now() at time zone 'utc')::date - 1;
  update public.schedule_drafts d
  set shifts = (select jsonb_agg(case when s ->> 'role' = old.role_id::text then s - 'role' else s end order by (s ->> 'start')::integer) from jsonb_array_elements(d.shifts) s)
  where d.staff_id = old.staff_id and d.shifts @> jsonb_build_array(jsonb_build_object('role', old.role_id));
  return old;
end;
$$;

create trigger staff_working_roles_removed
  after delete on public.staff_working_roles
  for each row execute function private.staff_role_removed();

revoke all on function private.shift_json(integer, integer, uuid) from public;
revoke all on function private.check_shift_roles(uuid, uuid[]) from public;
revoke all on function private.staff_role_removed() from public;
