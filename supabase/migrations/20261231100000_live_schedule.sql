-- Schedule changes reach every open calendar.
--
-- 1. Any change to the hours people can be booked (weekly hours, one-off
--    changes, days off, time off, a repeating pattern, the salon's opening
--    hours) moves the location's calendar version, whatever made it: a
--    published week, an approved request or swap, a pattern, Settings.
--    Bookings checked against the old hours are then checked again, and the
--    calendar's stamp changes. Drafts (schedule_drafts) change nothing.
-- 2. Locations are published to Supabase Realtime, so every signed-in
--    calendar and My day hears that the version moved within a second or
--    two and loads the day again (RLS: only the salon's own staff hear it).

-- The locations of the rows a statement changed (in the transition table
-- `changed`), by their staff or their own location.
create function private.bump_calendar_for_staff_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.locations l set calendar_version = l.calendar_version + 1
  where l.id in (select s.location_id from changed c join public.staff s on s.id = c.staff_id);
  return null;
end;
$$;

create function private.bump_calendar_for_location_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.locations l set calendar_version = l.calendar_version + 1
  where l.id in (select c.location_id from changed c);
  return null;
end;
$$;

do $$
declare
  v_table text;
  v_fn text;
begin
  foreach v_table in array array['staff_working_hours', 'staff_schedule_overrides', 'staff_days_off', 'staff_time_off', 'location_hours'] loop
    v_fn := case when v_table = 'location_hours' then 'private.bump_calendar_for_location_rows' else 'private.bump_calendar_for_staff_rows' end;
    execute format('create trigger %I after insert on public.%I referencing new table as changed for each statement execute function %s()', v_table || '_calendar_insert', v_table, v_fn);
    execute format('create trigger %I after update on public.%I referencing new table as changed for each statement execute function %s()', v_table || '_calendar_update', v_table, v_fn);
    execute format('create trigger %I after delete on public.%I referencing old table as changed for each statement execute function %s()', v_table || '_calendar_delete', v_table, v_fn);
  end loop;
end;
$$;

-- A repeating pattern's length or start (set_staff_pattern), or someone
-- moving location or leaving.
create function private.bump_calendar_for_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.locations l set calendar_version = l.calendar_version + 1
  where l.id in (select c.location_id from changed c join prior p on p.id = c.id
                 where c.hours_cycle_weeks is distinct from p.hours_cycle_weeks
                    or c.hours_cycle_starts_on is distinct from p.hours_cycle_starts_on
                    or c.is_active is distinct from p.is_active
                    or c.location_id is distinct from p.location_id
                 union
                 select p.location_id from changed c join prior p on p.id = c.id
                 where c.location_id is distinct from p.location_id);
  return null;
end;
$$;

create trigger staff_calendar_update after update on public.staff
  referencing old table as prior new table as changed
  for each statement execute function private.bump_calendar_for_staff();

revoke all on function private.bump_calendar_for_staff_rows() from public, anon, authenticated;
revoke all on function private.bump_calendar_for_location_rows() from public, anon, authenticated;
revoke all on function private.bump_calendar_for_staff() from public, anon, authenticated;

alter publication supabase_realtime add table public.locations;
