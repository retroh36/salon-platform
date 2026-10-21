-- Booking and editing appointments.
--
-- Appointments and their items are now written only through the functions
-- below, never directly:
--   save_appointment         book a visit, or change its client, notes and
--                            items (services, stylists, chairs, times)
--   set_appointment_status   check in, check out, cancel, no-show
--   set_appointment_notes    notes (stylists can edit their own visits')
-- Each records who made the change.
--
-- The booking rules (lib/scheduling/booking.ts) run in the app before
-- save_appointment. To stop two people booking the same slot at the same
-- moment, each location has a calendar_version: the app reads it before
-- checking the rules and passes it in, save_appointment bumps it, and a
-- save made with an out-of-date version is refused (SQLSTATE 40001) so the
-- app re-checks against the new calendar.

alter table public.locations add column calendar_version bigint not null default 0;

alter table public.appointments
  add column updated_by uuid,
  add column cancel_reason text check (length(cancel_reason) <= 500),
  add foreign key (updated_by, business_id) references public.staff (id, business_id) on delete set null (updated_by);

drop policy "Front of house can book appointments" on public.appointments;
drop policy "Front of house can change appointments" on public.appointments;
drop policy "Front of house can manage appointment items" on public.appointment_items;

-- The current user's active staff id in the business, or null.
create function private.current_staff_id(target_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff s
  where s.business_id = target_business_id
    and s.user_id = (select auth.uid())
    and s.is_active
  limit 1;
$$;

revoke all on function private.current_staff_id(uuid) from public;
grant execute on function private.current_staff_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- save_appointment
--
-- p_items is a JSON array of
--   {"id": uuid | null, "service_id": uuid, "staff_id": uuid,
--    "resource_id": uuid | null, "starts_at": timestamptz}
-- and becomes the visit's full list of items: items not listed are removed.
-- An item that keeps its service keeps the timing it was booked with; a new
-- service takes the menu's current timing. The price is the stylist's price
-- for the service (or the menu price), set when the item is added or its
-- service or stylist changes.
--
-- Only visits that are booked, confirmed or checked in can be changed.
-- ---------------------------------------------------------------------------

create function public.save_appointment(
  p_location_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_notes text,
  p_items jsonb,
  p_expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_staff_id uuid;
  v_appointment_id uuid;
  v_item jsonb;
  v_old public.appointment_items;
  v_service public.services;
  v_price integer;
  v_start timestamptz;
  v_kept_ids uuid[];
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  if v_business_id is null
     or not private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to book at this location' using errcode = '42501';
  end if;
  v_staff_id := private.current_staff_id(v_business_id);

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
    values (v_business_id, p_location_id, p_client_id, now(), now() + interval '1 minute', nullif(trim(p_notes), ''), 'front_desk', v_staff_id, v_staff_id)
    returning id into v_appointment_id;
  else
    update public.appointments
    set client_id = p_client_id, notes = nullif(trim(p_notes), ''), updated_by = v_staff_id
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
    select coalesce(ss.price_cents, v_service.price_cents) into v_price
    from public.staff_services ss
    where ss.service_id = v_service.id and ss.staff_id = (v_item ->> 'staff_id')::uuid;
    if v_service.id is null or v_price is null then
      raise exception 'The stylist doesn''t offer that service' using errcode = '22023';
    end if;

    v_old := null;
    if v_item ->> 'id' is not null then
      select * into v_old from public.appointment_items
      where id = (v_item ->> 'id')::uuid and appointment_id = v_appointment_id;
      if v_old.id is null then
        raise exception 'Item not found on this appointment' using errcode = 'P0002';
      end if;
    end if;

    if v_old.id is not null and v_old.service_id = v_service.id then
      -- Same service: keep its timing, and its price unless the stylist changed.
      update public.appointment_items set
        staff_id = (v_item ->> 'staff_id')::uuid,
        resource_id = (v_item ->> 'resource_id')::uuid,
        starts_at = v_start,
        ends_at = v_start + make_interval(mins => active_minutes + processing_minutes + finishing_minutes),
        price_cents = case when staff_id = (v_item ->> 'staff_id')::uuid then price_cents else v_price end
      where id = v_old.id;
    elsif v_old.id is not null then
      update public.appointment_items set
        service_id = v_service.id,
        staff_id = (v_item ->> 'staff_id')::uuid,
        resource_id = (v_item ->> 'resource_id')::uuid,
        starts_at = v_start,
        ends_at = v_start + make_interval(mins => v_service.duration_minutes),
        active_minutes = v_service.active_minutes,
        processing_minutes = v_service.processing_minutes,
        finishing_minutes = v_service.finishing_minutes,
        price_cents = v_price
      where id = v_old.id;
    else
      insert into public.appointment_items (
        business_id, location_id, appointment_id, service_id, staff_id, resource_id, starts_at, ends_at,
        active_minutes, processing_minutes, finishing_minutes, price_cents
      ) values (
        v_business_id, p_location_id, v_appointment_id, v_service.id, (v_item ->> 'staff_id')::uuid,
        (v_item ->> 'resource_id')::uuid, v_start, v_start + make_interval(mins => v_service.duration_minutes),
        v_service.active_minutes, v_service.processing_minutes, v_service.finishing_minutes, v_price
      );
    end if;
  end loop;

  return v_appointment_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_appointment_status: which changes are allowed (e.g. only a checked-in
-- client can be checked out) is decided in lib/appointments.ts.
-- ---------------------------------------------------------------------------

create function public.set_appointment_status(p_appointment_id uuid, p_status public.appointment_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
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
    updated_by = private.current_staff_id(v_business_id)
  where id = p_appointment_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_appointment_notes: front of house for any visit; stylists for visits
-- they're on.
-- ---------------------------------------------------------------------------

create function public.set_appointment_notes(p_appointment_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_staff_id uuid;
begin
  select a.business_id into v_business_id from public.appointments a where a.id = p_appointment_id;
  v_staff_id := private.current_staff_id(v_business_id);
  if v_staff_id is null or not (
    private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])
    or exists (select 1 from public.appointment_items i where i.appointment_id = p_appointment_id and i.staff_id = v_staff_id)
  ) then
    raise exception 'Not allowed to change this appointment' using errcode = '42501';
  end if;

  update public.appointments set notes = nullif(trim(p_notes), ''), updated_by = v_staff_id
  where id = p_appointment_id;
end;
$$;

revoke all on function public.save_appointment(uuid, uuid, uuid, text, jsonb, bigint) from public, anon;
revoke all on function public.set_appointment_status(uuid, public.appointment_status, text) from public, anon;
revoke all on function public.set_appointment_notes(uuid, text) from public, anon;
grant execute on function public.save_appointment(uuid, uuid, uuid, text, jsonb, bigint) to authenticated;
grant execute on function public.set_appointment_status(uuid, public.appointment_status, text) to authenticated;
grant execute on function public.set_appointment_notes(uuid, text) to authenticated;
