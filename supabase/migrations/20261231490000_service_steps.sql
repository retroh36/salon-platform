-- Services built from steps: highlight, processing, gloss, processing, cut,
-- booked as one, with each processing step free time for the stylist.
--
-- A service's steps (`services.steps`, null for a plain three-part service)
-- set its three totals, which everything else keeps reading: the stylist's
-- time before the first processing step (active), all processing, and the
-- stylist's time after it (finishing). An item keeps its own steps
-- (`appointment_items.steps`): the service's, fitted to the item's own
-- totals (a stylist's own length, a booking made longer) by
-- private.fit_steps, the same rule as fitSteps in lib/scheduling/steps.ts,
-- whenever it's booked or its service or totals change; or a visit's own,
-- changed only through set_item_steps. The double-booking guard reads the
-- steps, so the stylist is busy only in their own steps.

-- Why a step list can't be used, or null (stepsProblem in TS).
create function private.steps_problem(p_steps jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n int;
  v_step jsonb;
  v_prev boolean := false;
  v_i int := 0;
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    return 'count';
  end if;
  v_n := jsonb_array_length(p_steps);
  if v_n < 2 or v_n > 12 then
    return 'count';
  end if;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_step -> 'name') <> 'string' or length(btrim(v_step ->> 'name')) not between 1 and 40 then
      return 'name';
    end if;
    if jsonb_typeof(v_step -> 'minutes') <> 'number' or (v_step ->> 'minutes')::numeric % 5 <> 0
       or (v_step ->> 'minutes')::numeric not between 5 and 600 then
      return 'minutes';
    end if;
    if jsonb_typeof(v_step -> 'processing') <> 'boolean' then
      return 'minutes';
    end if;
    if (v_step ->> 'processing')::boolean and (v_i = 1 or v_i = v_n) then
      return 'first_or_last';
    end if;
    if (v_step ->> 'processing')::boolean and v_prev then
      return 'processing_twice';
    end if;
    v_prev := (v_step ->> 'processing')::boolean;
  end loop;
  return null;
end;
$$;

-- The three totals of a step list: {active, processing, finishing}.
create function private.steps_totals(p_steps jsonb)
returns int[]
language sql
immutable
set search_path = ''
as $$
  with s as (
    select ordinality as i, (value ->> 'minutes')::int as minutes, (value ->> 'processing')::boolean as processing
    from jsonb_array_elements(p_steps) with ordinality
  ), f as (select min(i) as first from s where processing)
  select array[
    coalesce(sum(minutes) filter (where not processing and (f.first is null or i < f.first)), 0)::int,
    coalesce(sum(minutes) filter (where processing), 0)::int,
    coalesce(sum(minutes) filter (where not processing and f.first is not null and i > f.first), 0)::int]
  from s, f;
$$;

-- A service's steps fitted to an item's totals: the difference in active
-- time on the last step before the first processing step, in processing on
-- the last processing step, in finishing on the last step. A step of the
-- stylist's never below 5 minutes; a processing step at 0 is dropped. Null
-- when the totals can't be met that way (the item keeps three parts).
create function private.fit_steps(p_steps jsonb, p_active int, p_processing int, p_finishing int)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_have int[];
  v_n int;
  v_first int;
  v_last_processing int;
  v_out jsonb;
  v_at int;
  v_by int;
  v_min int;
  v_part int;
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    return null;
  end if;
  v_have := private.steps_totals(p_steps);
  v_n := jsonb_array_length(p_steps);
  select min(ordinality) - 1, max(ordinality) - 1 into v_first, v_last_processing
  from jsonb_array_elements(p_steps) with ordinality where (value ->> 'processing')::boolean;
  v_out := p_steps;
  for v_part in 1..3 loop
    if v_part = 1 then
      v_at := case when v_first is null then v_n - 1 else v_first - 1 end;
      v_by := p_active - v_have[1];
      v_min := 5;
    elsif v_part = 2 then
      v_at := v_last_processing;
      v_by := p_processing - v_have[2];
      v_min := 0;
    else
      v_at := case when v_first is null then null else v_n - 1 end;
      v_by := p_finishing - v_have[3];
      v_min := 5;
    end if;
    continue when v_by = 0;
    if v_at is null then
      return null;
    end if;
    v_out := jsonb_set(v_out, array[v_at::text, 'minutes'], to_jsonb((v_out -> v_at ->> 'minutes')::int + v_by));
    if (v_out -> v_at ->> 'minutes')::int < v_min then
      return null;
    end if;
  end loop;
  select jsonb_agg(value order by ordinality) into v_out
  from jsonb_array_elements(v_out) with ordinality
  where not ((value ->> 'processing')::boolean and (value ->> 'minutes')::int = 0);
  if private.steps_totals(v_out) <> array[p_active, p_processing, p_finishing] then
    return null;
  end if;
  return v_out;
end;
$$;

-- When the stylist is with the client: their steps, or the service and
-- finishing parts.
create function private.item_busy(p_start timestamptz, p_active integer, p_processing integer, p_finishing integer, p_steps jsonb)
returns tstzmultirange
language sql
immutable
set search_path to ''
as $$
  select case
    -- Written out rather than calling the four-part version: a SQL
    -- function's body is looked up as whoever saves the item.
    when p_steps is null then tstzmultirange(
      tstzrange(p_start, p_start + make_interval(mins => p_active)),
      tstzrange(p_start + make_interval(mins => p_active + p_processing), p_start + make_interval(mins => p_active + p_processing + p_finishing)))
    else (
      select coalesce(range_agg(tstzrange(p_start + make_interval(mins => s.before), p_start + make_interval(mins => s.before + s.minutes))) filter (where not s.processing), '{}'::tstzmultirange)
      from (
        select (value ->> 'minutes')::int as minutes, (value ->> 'processing')::boolean as processing,
          coalesce(sum((value ->> 'minutes')::int) over (order by ordinality rows between unbounded preceding and 1 preceding), 0)::int as before
        from jsonb_array_elements(p_steps) with ordinality
      ) s)
  end;
$$;

alter table public.services add column steps jsonb;
alter table public.appointment_items add column steps jsonb;

-- A service's steps set its totals.
create function private.service_steps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
  v_totals int[];
begin
  if new.steps is not null then
    v_problem := private.steps_problem(new.steps);
    if v_problem is not null then
      raise exception 'These steps can''t be saved' using errcode = '22023', hint = v_problem;
    end if;
    select jsonb_agg(jsonb_build_object('name', btrim(value ->> 'name'), 'minutes', (value ->> 'minutes')::int, 'processing', (value ->> 'processing')::boolean) order by ordinality)
    into new.steps from jsonb_array_elements(new.steps) with ordinality;
    v_totals := private.steps_totals(new.steps);
    new.active_minutes := v_totals[1];
    new.processing_minutes := v_totals[2];
    new.finishing_minutes := v_totals[3];
  end if;
  return new;
end;
$$;

create trigger services_steps before insert or update of steps, active_minutes, processing_minutes, finishing_minutes on public.services
  for each row execute function private.service_steps();

-- An item's steps: its service's, fitted to its totals, whenever it's
-- booked or its service or totals change; kept when only its time, stylist
-- or chair change. set_item_steps sets its own (maestra.item_steps on).
create function private.item_steps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.steps is distinct from old.steps then
    if coalesce(current_setting('maestra.item_steps', true), '') <> 'on' then
      raise exception 'A visit''s steps change only through set_item_steps' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.service_id is distinct from old.service_id
     or (new.active_minutes, new.processing_minutes, new.finishing_minutes) is distinct from (old.active_minutes, old.processing_minutes, old.finishing_minutes) then
    new.steps := private.fit_steps((select s.steps from public.services s where s.id = new.service_id), new.active_minutes, new.processing_minutes, new.finishing_minutes);
  end if;
  return new;
end;
$$;

create trigger appointment_items_steps before insert or update on public.appointment_items
  for each row execute function private.item_steps();

-- The guard reads the steps: rebuilt with the new busy time.
alter table public.appointment_items drop constraint appointment_items_no_double_booking;
alter table public.appointment_items drop column staff_busy;
alter table public.appointment_items
  add column staff_busy tstzmultirange generated always as (private.item_busy(starts_at, active_minutes, processing_minutes, finishing_minutes, steps)) stored;
alter table public.appointment_items
  add constraint appointment_items_no_double_booking
    exclude using gist (staff_id with =, staff_busy with &&) where (holds_time and not imported and not overbooked) deferrable initially deferred;

-- A visit's own steps for one service (each step longer or shorter, a step
-- added or taken out), by whoever books: the totals follow, the calendar
-- version is checked (the app checks the booking rules first) and the
-- guard checks the new busy time at commit.
create function public.set_item_steps(p_location_id uuid, p_calendar_version bigint, p_item_id uuid, p_steps jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_problem text;
  v_totals int[];
begin
  select i.id, a.business_id, a.location_id, a.status into v_item
  from public.appointment_items i join public.appointments a on a.id = i.appointment_id
  where i.id = p_item_id for update of i;
  if v_item.id is null or v_item.location_id <> p_location_id or not private.front_of_house(v_item.business_id) then
    raise exception 'Only the front of house changes a visit''s steps' using errcode = '42501';
  end if;
  if v_item.status not in ('booked', 'confirmed', 'checked_in') then
    raise exception 'This visit can''t be changed now' using errcode = '55000', hint = 'status';
  end if;
  v_problem := private.steps_problem(p_steps);
  if v_problem is not null then
    raise exception 'These steps can''t be saved' using errcode = '22023', hint = v_problem;
  end if;
  perform 1 from public.locations where id = p_location_id and calendar_version = p_calendar_version for update;
  if not found then
    raise exception 'The calendar changed; check again' using errcode = '40001';
  end if;
  select jsonb_agg(jsonb_build_object('name', btrim(value ->> 'name'), 'minutes', (value ->> 'minutes')::int, 'processing', (value ->> 'processing')::boolean) order by ordinality)
  into p_steps from jsonb_array_elements(p_steps) with ordinality;
  v_totals := private.steps_totals(p_steps);
  perform set_config('maestra.item_steps', 'on', true);
  update public.appointment_items
  set steps = p_steps, active_minutes = v_totals[1], processing_minutes = v_totals[2], finishing_minutes = v_totals[3],
    ends_at = starts_at + make_interval(mins => v_totals[1] + v_totals[2] + v_totals[3])
  where id = p_item_id;
  -- The visit spans its services.
  update public.appointments a
  set starts_at = s.first_start, ends_at = s.last_end
  from (select min(starts_at) as first_start, max(ends_at) as last_end from public.appointment_items where appointment_id = (select appointment_id from public.appointment_items where id = p_item_id)) s
  where a.id = (select appointment_id from public.appointment_items where id = p_item_id);
  perform set_config('maestra.item_steps', 'off', true);
  update public.locations set calendar_version = calendar_version + 1 where id = p_location_id;
end;
$$;

revoke all on function private.steps_problem(jsonb) from public, anon, authenticated;
revoke all on function private.steps_totals(jsonb) from public, anon, authenticated;
revoke all on function private.fit_steps(jsonb, int, int, int) from public, anon, authenticated;
revoke all on function private.item_steps() from public, anon, authenticated;
revoke all on function private.service_steps() from public, anon, authenticated;
revoke all on function public.set_item_steps(uuid, bigint, uuid, jsonb) from public, anon;
grant execute on function public.set_item_steps(uuid, bigint, uuid, jsonb) to authenticated;
