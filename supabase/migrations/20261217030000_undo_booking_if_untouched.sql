-- Undoing a booking Denise made deleted the visit whatever had happened
-- to it since (notes, services, a card link or deposit, photos), taking
-- all of that with it. Now a booking that's been worked on since can't be
-- undone; it can be canceled like any other.

CREATE OR REPLACE FUNCTION public.undo_ai_action(p_action_id uuid, p_expected_version bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_action public.ai_actions;
  v_staff_id uuid;
  v_prev jsonb;
  v_item public.appointment_items;
  v_status public.appointment_status;
  v_created uuid;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null then
    raise exception 'Action not found' using errcode = 'P0002';
  end if;
  perform private.lock_calendar(v_action.location_id, p_expected_version);
  if v_action.status <> 'approved' then
    raise exception 'Only an applied action can be undone' using errcode = '55000';
  end if;
  v_staff_id := private.current_staff_id(v_action.business_id);

  for v_prev in select * from jsonb_array_elements(v_action.previous_state -> 'items') loop
    select * into v_item from public.appointment_items where id = (v_prev ->> 'item_id')::uuid for update;
    if v_item.id is null then
      raise exception 'An appointment it changed no longer exists' using errcode = '55000';
    end if;
    select a.status into v_status from public.appointments a where a.id = v_item.appointment_id for update;
    if v_status not in ('booked', 'confirmed')
       or (v_item.staff_id, v_item.resource_id, v_item.starts_at) is distinct from (
         (v_prev #>> '{applied,staff_id}')::uuid, (v_prev #>> '{applied,resource_id}')::uuid, (v_prev #>> '{applied,starts_at}')::timestamptz
       ) then
      raise exception 'It has changed since, so it can''t be undone' using errcode = '55000';
    end if;
    update public.appointment_items set
      staff_id = (v_prev ->> 'staff_id')::uuid,
      resource_id = (v_prev ->> 'resource_id')::uuid,
      starts_at = (v_prev ->> 'starts_at')::timestamptz,
      ends_at = (v_prev ->> 'ends_at')::timestamptz,
      price_cents = (v_prev ->> 'price_cents')::int
    where id = v_item.id;
    update public.appointments set updated_by = v_staff_id where id = v_item.appointment_id;
  end loop;

  -- A booking it made is removed, as if it never happened.
  v_created := (v_action.previous_state ->> 'created_appointment_id')::uuid;
  if v_created is not null then
    select a.status into v_status from public.appointments a where a.id = v_created for update;
    if v_status is null then
      raise exception 'The booking it made no longer exists' using errcode = '55000';
    end if;
    if v_status not in ('booked', 'confirmed') then
      raise exception 'The client has checked in, so it can''t be undone' using errcode = '55000';
    end if;
    -- Worked on since it was booked (notes, services, a card link or
    -- deposit, photos): removing it would lose that, so it stays.
    if exists (select 1 from public.appointments a where a.id = v_created and a.updated_at > v_action.decided_at)
       or exists (select 1 from public.appointment_items i where i.appointment_id = v_created and i.updated_at > v_action.decided_at)
       or exists (select 1 from public.card_requests c where c.appointment_id = v_created)
       or exists (select 1 from public.visit_photos p where p.appointment_id = v_created) then
      raise exception 'It has changed since, so it can''t be undone' using errcode = '55000';
    end if;
    delete from public.appointments where id = v_created;
  end if;

  update public.ai_actions set status = 'undone', undone_by = v_staff_id, undone_at = now()
  where id = v_action.id
  returning * into v_action;

  perform private.ai_action_undone(v_action);
end;
$function$;
