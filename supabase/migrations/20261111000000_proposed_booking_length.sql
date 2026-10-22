-- Bookings Denise proposes from "Ask Denise" can carry their own length:
-- the stylist's usual time for the service, which she searched with
-- (p_items "timing", as in save_appointment). apply_ai_action as before,
-- using it when it's there.

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
      -- The length Denise proposed (the stylist's usual time), else the stylist's.
      v_timing := coalesce(private.item_timing(v_line -> 'timing'), private.stylist_timing((v_line ->> 'staff_id')::uuid, v_service.id));
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
