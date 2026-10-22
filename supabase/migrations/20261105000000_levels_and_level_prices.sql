-- Stylist levels are now Artisan, Senior and Master (Artisan replaces
-- Junior), and each service can have a price per level.
--
-- A stylist's price for a service is, in order:
--   1. their own custom price (staff_services.price_cents),
--   2. the service's price for their level (service_level_prices),
--   3. the menu price (services.price_cents).
-- private.stylist_price works it out; booking (save_appointment) and
-- Denise's fixes (apply_ai_action) use it when a stylist takes on a service.

alter type public.staff_level rename value 'junior' to 'artisan';

create table public.service_level_prices (
  service_id   uuid not null,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  level        public.staff_level not null,
  price_cents  integer not null check (price_cents >= 0),
  primary key (service_id, level),
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);

create index service_level_prices_business_id_idx on public.service_level_prices (business_id);

alter table public.service_level_prices enable row level security;

create policy "Members can view level prices"
  on public.service_level_prices for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Owners and managers can add level prices"
  on public.service_level_prices for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Owners and managers can update level prices"
  on public.service_level_prices for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Owners and managers can remove level prices"
  on public.service_level_prices for delete to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

-- Sets a service's level prices: p_prices is {"artisan": cents | null,
-- "senior": ..., "master": ...}; a missing or null level uses the menu
-- price. Runs as the caller, so the policies above decide.
create function public.set_service_level_prices(p_service_id uuid, p_prices jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  if jsonb_typeof(p_prices) is distinct from 'object' then
    raise exception 'p_prices must be a JSON object' using errcode = '22023';
  end if;
  select business_id into v_business_id from public.services where id = p_service_id;
  if v_business_id is null then
    raise exception 'Service not found' using errcode = '42501';
  end if;

  delete from public.service_level_prices lp
  where lp.service_id = p_service_id
    and coalesce(p_prices ->> lp.level::text, '') = '';

  insert into public.service_level_prices (service_id, business_id, level, price_cents)
  select p_service_id, v_business_id, l.level, (p_prices ->> l.level::text)::integer
  from unnest(enum_range(null::public.staff_level)) as l (level)
  where coalesce(p_prices ->> l.level::text, '') <> ''
  on conflict (service_id, level) do update
    set price_cents = excluded.price_cents
    where public.service_level_prices.price_cents is distinct from excluded.price_cents;
end;
$$;

revoke all on function public.set_service_level_prices(uuid, jsonb) from public, anon;
grant execute on function public.set_service_level_prices(uuid, jsonb) to authenticated;

-- The stylist's price for a service, or null if they don't offer it.
create function private.stylist_price(p_staff_id uuid, p_service_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(ss.price_cents, lp.price_cents, sv.price_cents)
  from public.staff_services ss
  join public.services sv on sv.id = ss.service_id
  join public.staff st on st.id = ss.staff_id
  left join public.service_level_prices lp on lp.service_id = sv.id and lp.level = st.level
  where ss.staff_id = p_staff_id and ss.service_id = p_service_id;
$$;

revoke all on function private.stylist_price(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- save_appointment and apply_ai_action, as before, with the price from
-- private.stylist_price.
-- ---------------------------------------------------------------------------

create or replace function public.save_appointment(
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
    v_price := private.stylist_price((v_item ->> 'staff_id')::uuid, v_service.id);
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
      insert into public.appointment_items (
        business_id, location_id, appointment_id, service_id, staff_id, resource_id, starts_at, ends_at,
        active_minutes, processing_minutes, finishing_minutes, price_cents
      ) values (
        v_action.business_id, v_action.location_id, v_appointment_id, v_service.id, (v_line ->> 'staff_id')::uuid,
        (v_line ->> 'resource_id')::uuid, v_start, v_start + make_interval(mins => v_service.duration_minutes),
        v_service.active_minutes, v_service.processing_minutes, v_service.finishing_minutes, v_price
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
