-- Undoing a no-show marked by mistake (or a client who turned up after
-- all): the visit goes back to what it was before, logged in
-- appointment_events with who did it. A no-show frees its time, so the app
-- checks the booking rules first (lib/scheduling/book.ts, undoNoShow) and
-- passes the calendar version it checked against; a booking made since
-- makes this fail (40001) and the app checks again.

alter table public.appointment_events drop constraint appointment_events_kind_check;
alter table public.appointment_events add constraint appointment_events_kind_check
  check (kind in ('check_in_undone', 'patch_test_override', 'no_show', 'no_show_undone'));

-- As before, and a no-show records what the visit was (booked or
-- confirmed), for undoing it.
create or replace function public.set_appointment_status(p_appointment_id uuid, p_status public.appointment_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_status public.appointment_status;
  v_item_id uuid;
begin
  select a.business_id, a.status into v_business_id, v_status from public.appointments a where a.id = p_appointment_id;
  if v_business_id is null
     or not private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to change this appointment' using errcode = '42501';
  end if;
  if p_status = 'canceled' and nullif(trim(p_reason), '') is null then
    raise exception 'A cancellation needs a reason' using errcode = '22023';
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
$$;

create function public.undo_no_show(p_appointment_id uuid, p_expected_version bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_from public.appointment_status;
  v_me uuid;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if v_appointment.id is null
     or not private.has_business_role(v_appointment.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to change this appointment' using errcode = '42501';
  end if;
  if v_appointment.status <> 'no_show' then
    raise exception 'Only a no-show can be taken back' using errcode = '55000';
  end if;
  -- Nothing booked since the app checked the time is still free.
  update public.locations set calendar_version = calendar_version + 1
  where id = v_appointment.location_id and calendar_version = p_expected_version;
  if not found then
    raise exception 'The calendar changed; check again' using errcode = '40001';
  end if;
  v_me := private.current_staff_id(v_appointment.business_id);

  select (e.detail ->> 'from')::public.appointment_status into v_from
  from public.appointment_events e
  where e.appointment_id = p_appointment_id and e.kind = 'no_show'
  order by e.created_at desc limit 1;
  v_from := coalesce(v_from, 'booked');

  update public.appointments set status = v_from, updated_by = v_me where id = p_appointment_id;

  insert into public.appointment_events (business_id, appointment_id, kind, detail, staff_id)
  values (v_appointment.business_id, p_appointment_id, 'no_show_undone', jsonb_build_object('to', v_from), v_me);
end;
$$;

revoke all on function public.undo_no_show(uuid, bigint) from public, anon;
grant execute on function public.undo_no_show(uuid, bigint) to authenticated;
