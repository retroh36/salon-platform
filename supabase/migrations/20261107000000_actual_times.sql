-- Actual times: when each service on a visit really started, went into
-- processing, came back to the chair and finished, and when the client
-- checked in and out. Denise learns from them (lib/insights/): how long
-- each stylist really takes for each service, how often clients are late.
--
-- Recorded with one tap at a time through record_item_time, by the
-- stylist doing the service or the front of house. Starting the first
-- service checks the client in.

alter table public.appointments
  add column checked_in_at timestamptz,
  add column checked_out_at timestamptz;

alter table public.appointment_items
  add column started_at timestamptz,
  add column processing_started_at timestamptz,
  add column processing_ended_at timestamptz,
  add column finished_at timestamptz,
  add constraint appointment_items_actual_order_check check (
    (processing_started_at is null or (started_at is not null and processing_started_at >= started_at))
    and (processing_ended_at is null or (processing_started_at is not null and processing_ended_at >= processing_started_at))
    and (finished_at is null or (started_at is not null and finished_at >= started_at))
  );

-- ---------------------------------------------------------------------------
-- set_appointment_status, as before, and stamping check-in and check-out.
-- ---------------------------------------------------------------------------

create or replace function public.set_appointment_status(p_appointment_id uuid, p_status public.appointment_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_item_id uuid;
begin
  select a.business_id into v_business_id from public.appointments a where a.id = p_appointment_id;
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

  if p_status = 'completed' then
    for v_item_id in select i.id from public.appointment_items i where i.appointment_id = p_appointment_id order by i.starts_at loop
      perform private.deduct_item_stock(v_item_id);
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_item_time: one tap on a service.
--   start       it's started (checks the client in, if they weren't)
--   processing  the color is on: the stylist is free
--   rinse       processing's over: back in the chair
--   finish      it's done
--   undo        takes back the last tap
-- Taps are in that order; a repeated tap keeps the first time.
-- ---------------------------------------------------------------------------

create function public.record_item_time(p_item_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.appointment_items;
  v_appointment public.appointments;
  v_staff_id uuid;
begin
  select * into v_item from public.appointment_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_appointment from public.appointments where id = v_item.appointment_id for update;
  v_staff_id := private.current_staff_id(v_item.business_id);
  if v_staff_id is null or not (
    private.has_business_role(v_item.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])
    or v_item.staff_id = v_staff_id
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_appointment.status not in ('booked', 'confirmed', 'checked_in', 'completed') then
    raise exception 'This visit was canceled or a no-show' using errcode = '55000';
  end if;

  if p_event = 'start' then
    if v_appointment.status = 'completed' then
      raise exception 'This visit is checked out' using errcode = '55000';
    end if;
    update public.appointment_items set started_at = coalesce(started_at, now()) where id = p_item_id;
    update public.appointments set
      status = case when status in ('booked', 'confirmed') then 'checked_in'::public.appointment_status else status end,
      checked_in_at = coalesce(checked_in_at, now())
    where id = v_appointment.id;
  elsif p_event = 'processing' then
    if v_item.started_at is null or v_item.finished_at is not null then
      raise exception 'Start the service first' using errcode = '55000';
    end if;
    update public.appointment_items set processing_started_at = coalesce(processing_started_at, now()) where id = p_item_id;
  elsif p_event = 'rinse' then
    if v_item.processing_started_at is null or v_item.finished_at is not null then
      raise exception 'Processing hasn''t started' using errcode = '55000';
    end if;
    update public.appointment_items set processing_ended_at = coalesce(processing_ended_at, now()) where id = p_item_id;
  elsif p_event = 'finish' then
    if v_item.started_at is null then
      raise exception 'Start the service first' using errcode = '55000';
    end if;
    update public.appointment_items set
      processing_ended_at = case when processing_started_at is not null then coalesce(processing_ended_at, now()) end,
      finished_at = coalesce(finished_at, now())
    where id = p_item_id;
  elsif p_event = 'undo' then
    update public.appointment_items set
      finished_at = null,
      processing_ended_at = case when finished_at is not null then processing_ended_at end,
      processing_started_at = case when finished_at is not null or processing_ended_at is not null then processing_started_at end,
      started_at = case when finished_at is not null or processing_ended_at is not null or processing_started_at is not null then started_at end
    where id = p_item_id;
  else
    raise exception 'Unknown event' using errcode = '22023';
  end if;

  -- So open calendars see the change (loadCalendarStamp).
  update public.appointments set updated_by = v_staff_id where id = v_appointment.id;
end;
$$;

revoke all on function public.record_item_time(uuid, text) from public, anon;
grant execute on function public.record_item_time(uuid, text) to authenticated;
