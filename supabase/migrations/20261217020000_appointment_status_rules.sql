-- set_appointment_status only makes the changes the app offers, under a
-- row lock: it trusted the caller, so a direct call could bring a canceled
-- visit back as booked (onto time that may be someone else's, with no
-- booking-rule check) or a stale Cancel could land on a visit the checkout
-- had just completed. A repeat of the same change is a no-op.

CREATE OR REPLACE FUNCTION public.set_appointment_status(p_appointment_id uuid, p_status appointment_status, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_business_id uuid;
  v_status public.appointment_status;
  v_item_id uuid;
begin
  select a.business_id, a.status into v_business_id, v_status from public.appointments a where a.id = p_appointment_id for update;
  if v_business_id is null
     or not private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to change this appointment' using errcode = '42501';
  end if;
  if p_status = 'canceled' and nullif(trim(p_reason), '') is null then
    raise exception 'A cancellation needs a reason' using errcode = '22023';
  end if;
  -- A repeat of the change just made (a double tap, two tabs) does nothing.
  if p_status = v_status then
    return;
  end if;
  -- Only the changes the app offers (lib/appointments.ts): upcoming visits
  -- are checked in, canceled or marked no-show; a checked-in one is checked
  -- out or canceled. Checked out, canceled and no-show are final here
  -- (undo_check_in and undo_no_show put those back, with their checks).
  if not (
    (v_status in ('booked', 'confirmed') and p_status in ('checked_in', 'canceled', 'no_show'))
    or (v_status = 'checked_in' and p_status in ('completed', 'canceled'))
  ) then
    raise exception 'This visit can''t go from % to %', v_status, p_status using errcode = '55000', hint = 'status';
  end if;

  update public.appointments set
    status = p_status,
    canceled_at = case when p_status = 'canceled' then now() end,
    cancel_reason = case when p_status = 'canceled' then trim(p_reason) end,
    checked_in_at = case when p_status = 'checked_in' then coalesce(checked_in_at, now()) else checked_in_at end,
    checked_out_at = case when p_status = 'completed' then now() else checked_out_at end,
    updated_by = private.current_staff_id(v_business_id)
  where id = p_appointment_id;

  if p_status = 'no_show' and v_status <> 'no_show' then
    insert into public.appointment_events (business_id, appointment_id, kind, detail, staff_id)
    values (v_business_id, p_appointment_id, 'no_show', jsonb_build_object('from', v_status), private.current_staff_id(v_business_id));
  end if;

  if p_status = 'completed' then
    for v_item_id in select i.id from public.appointment_items i where i.appointment_id = p_appointment_id order by i.starts_at loop
      perform private.deduct_item_stock(v_item_id);
    end loop;
  end if;
end;
$function$;
