-- A client who asked for their stylist: each service on a visit can be
-- requested (the client chose that stylist for it: online when they picked
-- one, at the desk with the booking form's tick, through Denise when the
-- request names the stylist). Denise's fixes never move a requested
-- service to another stylist.
--
-- Stored as the stylist asked for (`requested_staff_id`), so the request
-- belongs to that stylist: a service moved to someone else isn't requested
-- there, and undoing the move makes it requested again, with nothing for
-- apply_ai_action, undo_ai_action or Mark out to keep up.

-- No foreign key: a second link to staff would make every staff(...) embed
-- from appointment_items ambiguous. Staff are never deleted, only made
-- inactive.
alter table public.appointment_items add column requested_staff_id uuid;

comment on column public.appointment_items.requested_staff_id is
  'The stylist the client asked for on this service; requested while it equals staff_id.';

-- write_appointment as before, and each item's request: `requested` true
-- or false when the item says (for its stylist), kept when it doesn't.
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
  v_anyway boolean;
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
    -- Confirmed by staff: the item may go where the rules would refuse it.
    v_anyway := coalesce((v_item ->> 'anyway')::boolean, false);
    v_price := private.stylist_price((v_item ->> 'staff_id')::uuid, v_service.id);
    if v_price is null and v_anyway then
      v_price := private.fallback_price((v_item ->> 'staff_id')::uuid, v_service.id);
    end if;
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
        price_cents = case when staff_id = (v_item ->> 'staff_id')::uuid then price_cents else v_price end,
        overbooked = coalesce((v_item ->> 'anyway')::boolean, overbooked),
        bundle_id = case when v_item ? 'bundle_id' then (v_item ->> 'bundle_id')::uuid else bundle_id end,
        requested_staff_id = case when v_item ? 'requested' then
          case when (v_item ->> 'requested')::boolean then (v_item ->> 'staff_id')::uuid end
          else requested_staff_id end
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
        price_cents = v_price,
        overbooked = coalesce((v_item ->> 'anyway')::boolean, overbooked),
        bundle_id = case when v_item ? 'bundle_id' then (v_item ->> 'bundle_id')::uuid else bundle_id end,
        requested_staff_id = case when v_item ? 'requested' then
          case when (v_item ->> 'requested')::boolean then (v_item ->> 'staff_id')::uuid end
          else requested_staff_id end
      where id = v_old.id;
    else
      v_timing := coalesce(v_timing, private.stylist_timing((v_item ->> 'staff_id')::uuid, v_service.id));
      insert into public.appointment_items (
        business_id, location_id, appointment_id, service_id, staff_id, resource_id, starts_at, ends_at,
        active_minutes, processing_minutes, finishing_minutes, price_cents, overbooked, bundle_id, requested_staff_id
      ) values (
        v_business_id, p_location_id, v_appointment_id, v_service.id, (v_item ->> 'staff_id')::uuid,
        (v_item ->> 'resource_id')::uuid, v_start, v_start + make_interval(mins => v_timing[1] + v_timing[2] + v_timing[3]),
        v_timing[1], v_timing[2], v_timing[3], v_price, v_anyway, (v_item ->> 'bundle_id')::uuid,
        case when coalesce((v_item ->> 'requested')::boolean, false) then (v_item ->> 'staff_id')::uuid end
      );
    end if;
  end loop;

  return v_appointment_id;
end;
$$;
