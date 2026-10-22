-- Lengths per stylist, and Denise's duration suggestions.
--
-- A stylist can have their own length for a service (staff_services
-- active/processing/finishing minutes), set from Denise's suggestions on
-- the Durations page through the AI action log (apply_duration_action,
-- undo_duration_action). New bookings take the stylist's length; a single
-- booking can set its own (p_items' "timing"), e.g. "Bridget usually takes
-- 3 hours for this: book 3h 5m?".
--
-- Also: proposals can be recorded by the server itself (the morning risk
-- check in the nightly job) through record_ai_proposals_as_system, which
-- only the service role can call.

alter table public.staff_services
  add column active_minutes integer check (active_minutes between 5 and 480),
  add column processing_minutes integer check (processing_minutes between 0 and 480),
  add column finishing_minutes integer check (finishing_minutes between 0 and 480),
  add constraint staff_services_timing_check check (
    (active_minutes is null) = (processing_minutes is null) and (active_minutes is null) = (finishing_minutes is null)
    and (finishing_minutes is null or finishing_minutes = 0 or processing_minutes > 0)
    and (active_minutes is null or (active_minutes + processing_minutes + finishing_minutes <= 480
         and active_minutes % 5 = 0 and processing_minutes % 5 = 0 and finishing_minutes % 5 = 0))
  );

-- The stylist's own length for a service, else the menu's: {active,
-- processing, finishing}.
create function private.stylist_timing(p_staff_id uuid, p_service_id uuid)
returns int[]
language sql
stable
security definer
set search_path = ''
as $$
  select array[coalesce(ss.active_minutes, sv.active_minutes), coalesce(ss.processing_minutes, sv.processing_minutes), coalesce(ss.finishing_minutes, sv.finishing_minutes)]
  from public.services sv
  left join public.staff_services ss on ss.service_id = sv.id and ss.staff_id = p_staff_id
  where sv.id = p_service_id;
$$;

-- A booking's own length for an item: {"active": n, "processing": n,
-- "finishing": n}, all in 5-minute steps; null when not given.
create function private.item_timing(p_timing jsonb)
returns int[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v int[];
begin
  if p_timing is null or jsonb_typeof(p_timing) = 'null' then
    return null;
  end if;
  v := array[(p_timing ->> 'active')::int, (p_timing ->> 'processing')::int, (p_timing ->> 'finishing')::int];
  if v[1] is null or v[2] is null or v[3] is null or v[1] < 5 or v[2] < 0 or v[3] < 0
     or v[1] % 5 <> 0 or v[2] % 5 <> 0 or v[3] % 5 <> 0 or v[1] + v[2] + v[3] > 480 or (v[3] > 0 and v[2] = 0) then
    raise exception 'That length doesn''t work' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function private.stylist_timing(uuid, uuid) from public;
revoke all on function private.item_timing(jsonb) from public;

create or replace function private.write_appointment(
  p_location_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_notes text,
  p_items jsonb,
  p_expected_version bigint,
  p_source public.appointment_source,
  p_staff_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_appointment_id uuid;
  v_item jsonb;
  v_old public.appointment_items;
  v_service public.services;
  v_price integer;
  v_start timestamptz;
  v_kept_ids uuid[];
  v_timing int[];
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A visit needs at least one service' using errcode = '22023';
  end if;

  update public.locations set calendar_version = calendar_version + 1
  where id = p_location_id and calendar_version = p_expected_version;
  if not found then
    raise exception 'The calendar changed; check again' using errcode = '40001';
  end if;

  if p_appointment_id is null then
    insert into public.appointments (business_id, location_id, client_id, starts_at, ends_at, notes, source, created_by, updated_by)
    values (v_business_id, p_location_id, p_client_id, now(), now() + interval '1 minute', nullif(trim(p_notes), ''), p_source, p_staff_id, p_staff_id)
    returning id into v_appointment_id;
  else
    update public.appointments
    set client_id = p_client_id, notes = nullif(trim(p_notes), ''), updated_by = p_staff_id
    where id = p_appointment_id and location_id = p_location_id and status in ('booked', 'confirmed', 'checked_in')
    returning id into v_appointment_id;
    if v_appointment_id is null then
      raise exception 'Appointment not found or can''t be changed' using errcode = 'P0002';
    end if;
  end if;

  select coalesce(array_agg((i ->> 'id')::uuid), '{}') into v_kept_ids
  from jsonb_array_elements(p_items) i
  where i ->> 'id' is not null;

  delete from public.appointment_items where appointment_id = v_appointment_id and id <> all (v_kept_ids);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_start := (v_item ->> 'starts_at')::timestamptz;
    select * into v_service from public.services where id = (v_item ->> 'service_id')::uuid and business_id = v_business_id;
    v_price := private.stylist_price((v_item ->> 'staff_id')::uuid, v_service.id);
    if v_service.id is null or v_price is null then
      raise exception 'The stylist doesn''t offer that service' using errcode = '22023';
    end if;
    -- This booking's own length, if given; otherwise the stylist's.
    v_timing := private.item_timing(v_item -> 'timing');

    v_old := null;
    if v_item ->> 'id' is not null then
      select * into v_old from public.appointment_items
      where id = (v_item ->> 'id')::uuid and appointment_id = v_appointment_id;
      if v_old.id is null then
        raise exception 'Item not found on this appointment' using errcode = 'P0002';
      end if;
    end if;

    if v_old.id is not null and v_old.service_id = v_service.id then
      -- Same service: keep its timing (unless this booking sets one), and
      -- its price unless the stylist changed.
      update public.appointment_items set
        staff_id = (v_item ->> 'staff_id')::uuid,
        resource_id = (v_item ->> 'resource_id')::uuid,
        starts_at = v_start,
        active_minutes = coalesce(v_timing[1], active_minutes),
        processing_minutes = coalesce(v_timing[2], processing_minutes),
        finishing_minutes = coalesce(v_timing[3], finishing_minutes),
        ends_at = v_start + make_interval(mins => coalesce(v_timing[1] + v_timing[2] + v_timing[3], active_minutes + processing_minutes + finishing_minutes)),
        price_cents = case when staff_id = (v_item ->> 'staff_id')::uuid then price_cents else v_price end
      where id = v_old.id;
    elsif v_old.id is not null then
      v_timing := coalesce(v_timing, private.stylist_timing((v_item ->> 'staff_id')::uuid, v_service.id));
      update public.appointment_items set
        service_id = v_service.id,
        staff_id = (v_item ->> 'staff_id')::uuid,
        resource_id = (v_item ->> 'resource_id')::uuid,
        starts_at = v_start,
        ends_at = v_start + make_interval(mins => v_timing[1] + v_timing[2] + v_timing[3]),
        active_minutes = v_timing[1],
        processing_minutes = v_timing[2],
        finishing_minutes = v_timing[3],
        price_cents = v_price
      where id = v_old.id;
    else
      v_timing := coalesce(v_timing, private.stylist_timing((v_item ->> 'staff_id')::uuid, v_service.id));
      insert into public.appointment_items (
        business_id, location_id, appointment_id, service_id, staff_id, resource_id, starts_at, ends_at,
        active_minutes, processing_minutes, finishing_minutes, price_cents
      ) values (
        v_business_id, p_location_id, v_appointment_id, v_service.id, (v_item ->> 'staff_id')::uuid,
        (v_item ->> 'resource_id')::uuid, v_start, v_start + make_interval(mins => v_timing[1] + v_timing[2] + v_timing[3]),
        v_timing[1], v_timing[2], v_timing[3], v_price
      );
    end if;
  end loop;

  return v_appointment_id;
end;
$$;

create or replace function public.apply_ai_action(p_action_id uuid, p_expected_version bigint, p_client_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
  v_staff_id uuid;
  v_change jsonb;
  v_item public.appointment_items;
  v_status public.appointment_status;
  v_price integer;
  v_previous jsonb := '[]';
  v_book jsonb;
  v_client_id uuid;
  v_appointment_id uuid;
  v_line jsonb;
  v_service public.services;
  v_start timestamptz;
  v_others jsonb;
  v_timing int[];
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  perform private.lock_calendar(v_action.location_id, p_expected_version);
  if v_action.status <> 'proposed' then
    raise exception 'This proposal was already decided' using errcode = '55000';
  end if;
  v_staff_id := private.current_staff_id(v_action.business_id);

  -- Moves: each item must still be where the proposal found it, on a visit
  -- that hasn't started.
  for v_change in select * from jsonb_array_elements(coalesce(v_action.proposal -> 'changes', '[]')) loop
    select * into v_item from public.appointment_items
    where id = (v_change ->> 'item_id')::uuid and location_id = v_action.location_id
    for update;
    if v_item.id is null then
      raise exception 'An appointment in this proposal no longer exists' using errcode = '55000';
    end if;
    select a.status into v_status from public.appointments a where a.id = v_item.appointment_id for update;
    if v_status not in ('booked', 'confirmed') then
      raise exception 'Only visits that haven''t started can be moved' using errcode = '55000';
    end if;
    if (v_item.staff_id, v_item.resource_id, v_item.starts_at) is distinct from (
      (v_change #>> '{from,staff_id}')::uuid, (v_change #>> '{from,resource_id}')::uuid, (v_change #>> '{from,starts_at}')::timestamptz
    ) then
      raise exception 'The calendar changed since this was proposed' using errcode = '55000';
    end if;

    v_previous := v_previous || jsonb_build_object(
      'item_id', v_item.id,
      'appointment_id', v_item.appointment_id,
      'staff_id', v_item.staff_id,
      'resource_id', v_item.resource_id,
      'starts_at', v_item.starts_at,
      'ends_at', v_item.ends_at,
      'price_cents', v_item.price_cents,
      'applied', v_change -> 'to'
    );

    -- A new stylist charges their price for the service.
    v_price := v_item.price_cents;
    if (v_change #>> '{to,staff_id}')::uuid <> v_item.staff_id then
      v_price := private.stylist_price((v_change #>> '{to,staff_id}')::uuid, v_item.service_id);
      if v_price is null then
        raise exception 'The stylist doesn''t offer that service' using errcode = '22023';
      end if;
    end if;

    update public.appointment_items set
      staff_id = (v_change #>> '{to,staff_id}')::uuid,
      resource_id = (v_change #>> '{to,resource_id}')::uuid,
      starts_at = (v_change #>> '{to,starts_at}')::timestamptz,
      ends_at = (v_change #>> '{to,starts_at}')::timestamptz
        + make_interval(mins => active_minutes + processing_minutes + finishing_minutes),
      price_cents = v_price
    where id = v_item.id;
    update public.appointments set updated_by = v_staff_id where id = v_item.appointment_id;
  end loop;

  -- A new booking.
  v_book := v_action.proposal -> 'book';
  if jsonb_typeof(v_book) = 'object' then
    v_client_id := coalesce(p_client_id, (v_book ->> 'client_id')::uuid);
    if v_client_id is null then
      raise exception 'Choose a client for this booking' using errcode = '22023';
    end if;
    insert into public.appointments (business_id, location_id, client_id, starts_at, ends_at, source, created_by, updated_by)
    values (v_action.business_id, v_action.location_id, v_client_id, now(), now() + interval '1 minute', 'front_desk', v_staff_id, v_staff_id)
    returning id into v_appointment_id;
    for v_line in select * from jsonb_array_elements(v_book -> 'items') loop
      v_start := (v_line ->> 'starts_at')::timestamptz;
      select * into v_service from public.services where id = (v_line ->> 'service_id')::uuid and business_id = v_action.business_id;
      v_price := private.stylist_price((v_line ->> 'staff_id')::uuid, v_service.id);
      if v_service.id is null or v_price is null then
        raise exception 'The stylist doesn''t offer that service' using errcode = '22023';
      end if;
      v_timing := private.stylist_timing((v_line ->> 'staff_id')::uuid, v_service.id);
      insert into public.appointment_items (
        business_id, location_id, appointment_id, service_id, staff_id, resource_id, starts_at, ends_at,
        active_minutes, processing_minutes, finishing_minutes, price_cents
      ) values (
        v_action.business_id, v_action.location_id, v_appointment_id, v_service.id, (v_line ->> 'staff_id')::uuid,
        (v_line ->> 'resource_id')::uuid, v_start, v_start + make_interval(mins => v_timing[1] + v_timing[2] + v_timing[3]),
        v_timing[1], v_timing[2], v_timing[3], v_price
      );
    end loop;
  end if;

  -- The other options for the same problem are no longer needed.
  if v_action.subject is not null then
    select coalesce(jsonb_agg(o.summary order by o.rank), '[]') into v_others
    from public.ai_actions o
    where o.location_id = v_action.location_id and o.subject = v_action.subject and o.status = 'proposed' and o.id <> v_action.id;
    delete from public.ai_actions o
    where o.location_id = v_action.location_id and o.subject = v_action.subject and o.status = 'proposed' and o.id <> v_action.id;
  end if;

  update public.ai_actions set
    status = 'approved',
    decided_by = v_staff_id,
    decided_at = now(),
    previous_state = jsonb_build_object('items', v_previous, 'created_appointment_id', v_appointment_id),
    proposal = case when v_others is not null and jsonb_array_length(v_others) > 0
      then proposal || jsonb_build_object('other_options', v_others) else proposal end
  where id = v_action.id
  returning * into v_action;

  perform private.ai_action_applied(v_action);
end;
$$;

-- ---------------------------------------------------------------------------
-- Recording proposals: staff (front of house) as before, or the server.
-- ---------------------------------------------------------------------------

create function private.record_proposals(p_location_id uuid, p_feature text, p_subject text, p_options jsonb, p_staff_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_staff_id uuid;
  v_option jsonb;
  v_rank int := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  if v_business_id is null then
    raise exception 'Not allowed to record proposals here' using errcode = '42501';
  end if;
  if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) > 9 then
    raise exception 'Options must be a list of up to 9' using errcode = '22023';
  end if;
  v_staff_id := p_staff_id;

  if p_subject is not null then
    if exists (select 1 from public.ai_actions where location_id = p_location_id and subject = p_subject and status = 'rejected') then
      return v_ids;
    end if;
    delete from public.ai_actions
    where location_id = p_location_id and subject = p_subject and status = 'proposed' and rank > jsonb_array_length(p_options);
  end if;

  for v_option in select * from jsonb_array_elements(p_options) loop
    v_rank := v_rank + 1;
    v_id := null;
    if p_subject is not null then
      update public.ai_actions set
        feature = p_feature,
        summary = v_option ->> 'summary',
        reason = coalesce(v_option ->> 'reason', ''),
        proposal = v_option -> 'proposal'
      where location_id = p_location_id and subject = p_subject and status = 'proposed' and rank = v_rank
      returning id into v_id;
    end if;
    if v_id is null then
      insert into public.ai_actions (business_id, location_id, feature, subject, rank, summary, reason, proposal, proposed_by)
      values (v_business_id, p_location_id, p_feature, p_subject, v_rank, v_option ->> 'summary',
              coalesce(v_option ->> 'reason', ''), v_option -> 'proposal', v_staff_id)
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$$;

revoke all on function private.record_proposals(uuid, text, text, jsonb, uuid) from public;

create or replace function public.record_ai_proposals(p_location_id uuid, p_feature text, p_subject text, p_options jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  if v_business_id is null
     or not private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to record proposals here' using errcode = '42501';
  end if;
  return private.record_proposals(p_location_id, p_feature, p_subject, p_options, private.current_staff_id(v_business_id));
end;
$$;

create function public.record_ai_proposals_as_system(p_location_id uuid, p_feature text, p_subject text, p_options jsonb)
returns uuid[]
language sql
security definer
set search_path = ''
as $$
  select private.record_proposals(p_location_id, p_feature, p_subject, p_options, null);
$$;

revoke all on function public.record_ai_proposals_as_system(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_ai_proposals_as_system(uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Duration suggestions (feature 'duration'): proposal
--   {"staff_service": {"staff_id", "service_id",
--    "to": {"active", "processing", "finishing"}}}
-- Applying sets the stylist's length (owners and managers) and keeps the
-- previous one for undo.
-- ---------------------------------------------------------------------------

create function public.apply_duration_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
  v_target jsonb;
  v_to int[];
  v_old public.staff_services;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null or not private.has_business_role(v_action.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_action.feature <> 'duration' or v_action.status <> 'proposed' then
    raise exception 'This suggestion was already decided' using errcode = '55000';
  end if;
  v_target := v_action.proposal -> 'staff_service';
  v_to := private.item_timing(v_target -> 'to');
  select * into v_old from public.staff_services
  where staff_id = (v_target ->> 'staff_id')::uuid and service_id = (v_target ->> 'service_id')::uuid and business_id = v_action.business_id
  for update;
  if v_old.staff_id is null then
    raise exception 'The stylist no longer offers this service' using errcode = '55000';
  end if;

  update public.staff_services set active_minutes = v_to[1], processing_minutes = v_to[2], finishing_minutes = v_to[3]
  where staff_id = v_old.staff_id and service_id = v_old.service_id;
  update public.ai_actions set
    status = 'approved',
    decided_by = private.current_staff_id(business_id),
    decided_at = now(),
    previous_state = jsonb_build_object('staff_id', v_old.staff_id, 'service_id', v_old.service_id, 'active', v_old.active_minutes, 'processing', v_old.processing_minutes, 'finishing', v_old.finishing_minutes)
  where id = v_action.id;
end;
$$;

create function public.undo_duration_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null or not private.has_business_role(v_action.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_action.feature <> 'duration' or v_action.status <> 'approved' then
    raise exception 'Only an applied suggestion can be undone' using errcode = '55000';
  end if;
  update public.staff_services set
    active_minutes = (v_action.previous_state ->> 'active')::int,
    processing_minutes = (v_action.previous_state ->> 'processing')::int,
    finishing_minutes = (v_action.previous_state ->> 'finishing')::int
  where staff_id = (v_action.previous_state ->> 'staff_id')::uuid and service_id = (v_action.previous_state ->> 'service_id')::uuid;
  update public.ai_actions set status = 'undone', undone_by = private.current_staff_id(business_id), undone_at = now()
  where id = v_action.id;
end;
$$;

revoke all on function public.apply_duration_action(uuid) from public, anon;
revoke all on function public.undo_duration_action(uuid) from public, anon;
grant execute on function public.apply_duration_action(uuid) to authenticated;
grant execute on function public.undo_duration_action(uuid) to authenticated;
