-- Service bundles: "Highlight + Gloss + Cut" made from menu services, in
-- order, with a gap before each part after the first (time the client
-- processes while the stylist is free). A bundle is booked as one, but each
-- part is an ordinary appointment item: its own service, stylist (the same
-- by default), price, commission and tip at checkout, so payroll and
-- reports see separate services. Each part keeps its service's own steps.
--
-- `appointment_items.bundle_id` says which bundle an item was booked from,
-- so the calendar moves the parts together and booking details names it.
-- Staff can change, add or remove a part, or its gap (its start time),
-- like any service on a visit.

create table public.service_bundles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  description text check (description is null or length(description) <= 500),
  -- Offered on the booking site.
  online boolean not null default true,
  position smallint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);
create unique index service_bundles_name on public.service_bundles (business_id, lower(trim(name))) where archived_at is null;
create index service_bundles_business on public.service_bundles (business_id, position);

create table public.service_bundle_parts (
  bundle_id uuid not null,
  business_id uuid not null,
  position smallint not null check (position between 0 and 5),
  service_id uuid not null,
  -- Minutes between the part before ending and this one starting (0 first).
  gap_minutes smallint not null default 0 check (gap_minutes between 0 and 240 and gap_minutes % 5 = 0),
  primary key (bundle_id, position),
  foreign key (bundle_id, business_id) references public.service_bundles(id, business_id) on delete cascade,
  foreign key (service_id, business_id) references public.services(id, business_id),
  check (position > 0 or gap_minutes = 0)
);
create index service_bundle_parts_service on public.service_bundle_parts (service_id);

alter table public.service_bundles enable row level security;
alter table public.service_bundle_parts enable row level security;

create policy "Members read bundles" on public.service_bundles for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Members read bundle parts" on public.service_bundle_parts for select to authenticated
  using ((select private.is_business_member(business_id)));
-- Written only by save_service_bundle and archive_service_bundle.

alter table public.appointment_items add column bundle_id uuid;
alter table public.appointment_items
  add constraint appointment_items_bundle foreign key (bundle_id, business_id) references public.service_bundles(id, business_id);
create index appointment_items_bundle on public.appointment_items (bundle_id) where bundle_id is not null;

-- Saves a bundle and its parts as a whole: {id?, name, description,
-- online, parts: [{service_id, gap_minutes}]}. Owners and managers, like
-- the rest of the menu. Hints: name, parts (2 to 6), gap, service.
create function public.save_service_bundle(p_business_id uuid, p_bundle jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := (p_bundle ->> 'id')::uuid;
  v_name text := btrim(coalesce(p_bundle ->> 'name', ''));
  v_parts jsonb := p_bundle -> 'parts';
  v_part jsonb;
  v_n int := 0;
  v_gap int;
begin
  if not private.has_business_role(p_business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers change the menu' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 60 then
    raise exception 'Give the bundle a name' using errcode = '22023', hint = 'name';
  end if;
  if jsonb_typeof(v_parts) is distinct from 'array' or jsonb_array_length(v_parts) not between 2 and 6 then
    raise exception 'A bundle has 2 to 6 services' using errcode = '22023', hint = 'parts';
  end if;
  for v_part in select value from jsonb_array_elements(v_parts) loop
    v_gap := coalesce((v_part ->> 'gap_minutes')::int, 0);
    if v_gap < 0 or v_gap > 240 or v_gap % 5 <> 0 then
      raise exception 'Gaps are 0 to 240 minutes, in fives' using errcode = '22023', hint = 'gap';
    end if;
    if not exists (select 1 from public.services s where s.id = (v_part ->> 'service_id')::uuid and s.business_id = p_business_id and s.archived_at is null) then
      raise exception 'Choose services on the menu' using errcode = '22023', hint = 'service';
    end if;
  end loop;

  if v_id is null then
    insert into public.service_bundles (business_id, name, description, online, position)
    values (p_business_id, v_name, nullif(btrim(p_bundle ->> 'description'), ''), coalesce((p_bundle ->> 'online')::boolean, true),
            coalesce((select max(position) + 1 from public.service_bundles where business_id = p_business_id), 0))
    returning id into v_id;
  else
    update public.service_bundles
    set name = v_name, description = nullif(btrim(p_bundle ->> 'description'), ''),
        online = coalesce((p_bundle ->> 'online')::boolean, online), updated_at = now()
    where id = v_id and business_id = p_business_id;
    if not found then
      raise exception 'Bundle not found' using errcode = 'P0002';
    end if;
    delete from public.service_bundle_parts where bundle_id = v_id;
  end if;

  for v_part in select value from jsonb_array_elements(v_parts) loop
    insert into public.service_bundle_parts (bundle_id, business_id, position, service_id, gap_minutes)
    values (v_id, p_business_id, v_n, (v_part ->> 'service_id')::uuid, case when v_n = 0 then 0 else coalesce((v_part ->> 'gap_minutes')::int, 0) end);
    v_n := v_n + 1;
  end loop;
  return v_id;
end;
$$;

-- Archived bundles leave the menu; visits booked from them keep their name.
create function public.archive_service_bundle(p_bundle_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.service_bundles where id = p_bundle_id;
  if v_business is null or not private.has_business_role(v_business, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers change the menu' using errcode = '42501';
  end if;
  update public.service_bundles set archived_at = case when p_archived then now() end, updated_at = now() where id = p_bundle_id;
end;
$$;

revoke all on function public.save_service_bundle(uuid, jsonb) from public, anon;
grant execute on function public.save_service_bundle(uuid, jsonb) to authenticated;
revoke all on function public.archive_service_bundle(uuid, boolean) from public, anon;
grant execute on function public.archive_service_bundle(uuid, boolean) to authenticated;

-- write_appointment as before, and each item's bundle: `bundle_id` when the
-- item says (null to take it out of its bundle), kept when it doesn't.
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
        bundle_id = case when v_item ? 'bundle_id' then (v_item ->> 'bundle_id')::uuid else bundle_id end
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
        bundle_id = case when v_item ? 'bundle_id' then (v_item ->> 'bundle_id')::uuid else bundle_id end
      where id = v_old.id;
    else
      v_timing := coalesce(v_timing, private.stylist_timing((v_item ->> 'staff_id')::uuid, v_service.id));
      insert into public.appointment_items (
        business_id, location_id, appointment_id, service_id, staff_id, resource_id, starts_at, ends_at,
        active_minutes, processing_minutes, finishing_minutes, price_cents, overbooked, bundle_id
      ) values (
        v_business_id, p_location_id, v_appointment_id, v_service.id, (v_item ->> 'staff_id')::uuid,
        (v_item ->> 'resource_id')::uuid, v_start, v_start + make_interval(mins => v_timing[1] + v_timing[2] + v_timing[3]),
        v_timing[1], v_timing[2], v_timing[3], v_price, v_anyway, (v_item ->> 'bundle_id')::uuid
      );
    end if;
  end loop;

  return v_appointment_id;
end;
$$;

