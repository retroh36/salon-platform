-- Several visits saved as one change, all or nothing: a new series or group
-- with every visit, or an edit or move of the visits in scope. Each visit is
-- written as save_appointment writes one (the app has checked the booking
-- rules for all of them together, and the database's own rules hold them
-- to it); if any one fails, none is saved and no empty series or group is
-- left behind. The calendar version must match once, at the start.
--
-- p_visits: [{appointment_id, client_id, notes, items}] in order; with
-- p_new_series ({client_id, interval_weeks, occurrences, ends_on}) each is
-- linked to it in that order, with p_new_group ({label}) each joins it.
-- Returns {appointment_ids, series_id, group_id}.
create function public.save_appointments(p_location_id uuid, p_visits jsonb, p_expected_version bigint, p_new_series jsonb default null, p_new_group jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_business_id uuid;
  v_staff_id uuid;
  v_visit jsonb;
  v_version bigint := p_expected_version;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_series_id uuid;
  v_group_id uuid;
  v_index integer := 0;
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  if v_business_id is null
     or not private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to book at this location' using errcode = '42501';
  end if;
  if jsonb_typeof(p_visits) is distinct from 'array' or jsonb_array_length(p_visits) = 0 then
    raise exception 'Nothing to save' using errcode = '22023';
  end if;
  v_staff_id := private.current_staff_id(v_business_id);

  if p_new_series is not null then
    insert into public.appointment_series (business_id, location_id, client_id, interval_weeks, occurrences, ends_on, created_by)
    values (v_business_id, p_location_id, (p_new_series ->> 'client_id')::uuid, (p_new_series ->> 'interval_weeks')::smallint,
            (p_new_series ->> 'occurrences')::smallint, (p_new_series ->> 'ends_on')::date, v_staff_id)
    returning id into v_series_id;
  end if;
  if p_new_group is not null then
    insert into public.appointment_groups (business_id, location_id, label, created_by)
    values (v_business_id, p_location_id, trim(p_new_group ->> 'label'), v_staff_id)
    returning id into v_group_id;
  end if;

  for v_visit in select * from jsonb_array_elements(p_visits) loop
    if v_series_id is not null and (v_visit ->> 'client_id')::uuid is distinct from (p_new_series ->> 'client_id')::uuid then
      raise exception 'A series is for one client' using errcode = '22023';
    end if;
    -- Each write moves the calendar on by one; the first must match.
    v_id := private.write_appointment(p_location_id, (v_visit ->> 'appointment_id')::uuid, (v_visit ->> 'client_id')::uuid,
                                      coalesce(v_visit ->> 'notes', ''), v_visit -> 'items', v_version, 'front_desk', v_staff_id);
    v_version := v_version + 1;
    v_index := v_index + 1;
    if v_series_id is not null then
      update public.appointments set series_id = v_series_id, series_index = v_index where id = v_id;
    end if;
    if v_group_id is not null then
      update public.appointments set group_id = v_group_id where id = v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('appointment_ids', to_jsonb(v_ids), 'series_id', v_series_id, 'group_id', v_group_id);
end;
$$;

revoke execute on function public.save_appointments(uuid, jsonb, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.save_appointments(uuid, jsonb, bigint, jsonb, jsonb) to authenticated;
