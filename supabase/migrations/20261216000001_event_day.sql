-- Bridal and events, stage 3: planning and the day of.
--
-- * The calendar: a booked event holds each team member's time as blocked
--   time of kind 'event' (time_blocks.event_id), from their call time to
--   their last person, plus travel each way for on-location events. The
--   booking rules treat it like any block, so nobody can be booked over
--   it. Only the event writes these (private.sync_event_blocks, whenever a
--   booked event is saved or its status changes); a trigger refuses any
--   other change.
-- * Trials: a visit booked through the booking rules, linked to the event
--   (appointments.event_id). Checking it out moves a booked event to Trial
--   done. The look: notes and photos on the event.
-- * Completing an event: one sale, so the work flows into commission, tips
--   and payroll: each person's package split between their hair and makeup
--   artists by minutes, the team's share of the service charge and travel
--   fee as tips (the service charge by each artist's work, travel evenly),
--   the salon's share, travel and early-start fees as lines without a
--   stylist, the event's tax, and every payment the event took.

alter table public.time_blocks
  add column event_id uuid,
  add constraint time_blocks_event_fk foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade,
  add constraint time_blocks_event_kind check ((event_id is not null) = (kind = 'event'));

create index time_blocks_event_idx on public.time_blocks (event_id) where event_id is not null;

-- Event holds change only with their event.
create function private.guard_event_blocks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The event itself being deleted takes its holds with it.
  if tg_op = 'DELETE' and old.event_id is not null and not exists (select 1 from public.events where id = old.event_id) then
    return old;
  end if;
  if (case when tg_op = 'DELETE' then old.event_id else coalesce(new.event_id, old.event_id) end) is not null
     and coalesce(current_setting('maestra.event_sync', true), '') <> 'on' then
    raise exception 'Event time changes with its event' using errcode = '42501', hint = 'event';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger time_blocks_guard_events before insert or update or delete on public.time_blocks
  for each row execute function private.guard_event_blocks();

-- The holds for an event, written again from its timeline: one per team
-- member, from their call time (15 minutes before their first person, less
-- travel on location) to their last person (plus travel), in 5-minute
-- steps on the event's date. Only booked events hold time.
create function private.sync_event_blocks(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_tz text;
  v_travel integer;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    return;
  end if;
  perform set_config('maestra.event_sync', 'on', true);
  delete from public.time_blocks where event_id = p_event_id;
  if v_event.status in ('booked', 'trial_done') then
    select timezone into v_tz from public.locations where id = v_event.location_id;
    v_travel := case when v_event.on_location then v_event.travel_minutes else 0 end;
    insert into public.time_blocks (business_id, location_id, staff_id, kind, note, start_minute, end_minute, on_date, event_id)
    select v_event.business_id, v_event.location_id, t.staff_id, 'event', left(v_event.title, 300),
      greatest(0, (floor((extract(epoch from (min(t.starts_at) at time zone v_tz)::time) / 60 - 15 - v_travel) / 5) * 5)::int),
      least(1440, (ceil((extract(epoch from (max(t.ends_at) at time zone v_tz)::time) / 60 + v_travel) / 5) * 5)::int),
      v_event.event_date, v_event.id
    from public.event_tasks t
    where t.event_id = p_event_id and t.staff_id is not null
    group by t.staff_id;
  end if;
  perform set_config('maestra.event_sync', 'off', true);
  update public.locations set calendar_version = calendar_version + 1 where id = v_event.location_id;
end;
$$;

create or replace function private.after_event_saved(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.schedule_event_payments(p_event_id);
  perform private.sync_event_blocks(p_event_id);
end;
$$;

-- Booked (the client agreed), lost or reopened: the holds follow.
create function private.on_event_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_event_blocks(new.id);
  return null;
end;
$$;

create trigger events_sync_blocks after update of status on public.events
  for each row when (old.status is distinct from new.status) execute function private.on_event_status();

-- ---------------------------------------------------------------------------
-- Trials and the look
-- ---------------------------------------------------------------------------

alter table public.appointments add column event_id uuid,
  add constraint appointments_event_fk foreign key (event_id) references public.events (id) on delete set null;
create index appointments_event_idx on public.appointments (event_id) where event_id is not null;

alter table public.events add column look_notes text check (length(look_notes) <= 4000);

-- A visit (booked through the booking rules) is this event's trial (front
-- of house): the event's own client, not canceled.
create function public.link_event_trial(p_event_id uuid, p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_appointment public.appointments;
  v_me uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null or not private.front_of_house(v_event.business_id) then
    raise exception 'Only the front desk, managers and owners can book trials' using errcode = '42501';
  end if;
  select * into v_appointment from public.appointments where id = p_appointment_id and business_id = v_event.business_id;
  if v_appointment.id is null or v_appointment.client_id is distinct from v_event.client_id or v_appointment.status = 'canceled' then
    raise exception 'That visit isn''t this client''s' using errcode = '22023';
  end if;
  update public.appointments set event_id = p_event_id where id = p_appointment_id;
  select s.id into v_me from public.staff s where s.user_id = (select auth.uid()) and s.business_id = v_event.business_id and s.is_active limit 1;
  insert into public.event_history (business_id, event_id, kind, detail, staff_id)
  values (v_event.business_id, p_event_id, 'trial_booked', to_char(v_appointment.starts_at at time zone (select timezone from public.locations where id = v_event.location_id), 'Dy, Mon FMDD at FMHH12:MIam'), v_me);
end;
$$;

-- A trial checked out moves its booked event to Trial done.
create function private.on_trial_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.events set status = 'trial_done', status_changed_at = now() where id = new.event_id and status = 'booked';
  if found then
    insert into public.event_history (business_id, event_id, kind) select business_id, id, 'trial_done' from public.events where id = new.event_id;
  end if;
  return null;
end;
$$;

create trigger appointments_trial_done after update of status on public.appointments
  for each row when (new.event_id is not null and new.status = 'completed' and old.status is distinct from new.status)
  execute function private.on_trial_done();

-- The look (front of house, and stylists on the event).
create function public.save_event_look(p_event_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_me uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null or not private.sees_event(v_event.business_id, v_event.id) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  update public.events set look_notes = nullif(left(trim(coalesce(p_notes, '')), 4000), '') where id = p_event_id;
  select s.id into v_me from public.staff s where s.user_id = (select auth.uid()) and s.business_id = v_event.business_id and s.is_active limit 1;
  insert into public.event_history (business_id, event_id, kind, staff_id) values (v_event.business_id, p_event_id, 'look_saved', v_me);
end;
$$;

-- The event in an event-photos path (<business>/<event>/<file>), or null.
create function private.event_from_path(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 2)::uuid end;
$$;

create policy "Stylists on an event can see its photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'event-photos' and (select private.sees_event(private.logo_business(name), private.event_from_path(name))));
create policy "Stylists on an event can add photos of the look"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'event-photos' and (select private.sees_event(private.logo_business(name), private.event_from_path(name))));

-- A photo of the look, once its file is there (front of house, and
-- stylists on the event).
create function public.add_event_photo(p_event_id uuid, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_me uuid;
  v_id uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null or not private.sees_event(v_event.business_id, v_event.id) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if split_part(p_path, '/', 1) <> v_event.business_id::text or private.event_from_path(p_path) is distinct from p_event_id
     or not exists (select 1 from storage.objects where bucket_id = 'event-photos' and name = p_path) then
    raise exception 'Upload the photo first' using errcode = '22023';
  end if;
  if (select count(*) from public.event_photos where event_id = p_event_id and kind = 'look') >= 12 then
    raise exception 'An event can have up to 12 photos of the look' using errcode = '22023';
  end if;
  select s.id into v_me from public.staff s where s.user_id = (select auth.uid()) and s.business_id = v_event.business_id and s.is_active limit 1;
  insert into public.event_photos (business_id, event_id, kind, storage_path, created_by)
  values (v_event.business_id, p_event_id, 'look', p_path, v_me)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Completing an event: one sale for commission, tips and payroll
-- ---------------------------------------------------------------------------

alter table public.events add column sale_id uuid references public.sales (id) on delete set null;

create function public.complete_event(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_settings public.event_settings;
  v_tax_bp integer;
  v_me uuid;
  v_paid integer;
  v_lines jsonb := '[]';
  v_tips jsonb := '{}';
  v_member public.event_members;
  v_hair uuid;
  v_makeup uuid;
  v_hair_cents integer;
  v_team uuid[];
  v_team_charge integer;
  v_team_travel integer;
  v_work jsonb := '{}';
  v_work_total integer;
  v_given integer;
  v_staff uuid;
  v_share integer;
  v_line jsonb;
  v_tax_sum integer := 0;
  v_taxed_last integer;
  v_i integer;
  v_subtotal integer := 0;
  v_tip_total integer := 0;
  v_number integer;
  v_sale uuid;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null or not private.front_of_house(v_event.business_id) then
    raise exception 'Only the front desk, managers and owners can complete events' using errcode = '42501';
  end if;
  if v_event.status not in ('booked', 'trial_done') then
    raise exception 'Only a booked event can be completed' using errcode = '55000';
  end if;
  if v_event.event_date > private.event_today(p_event_id) then
    raise exception 'The event hasn''t happened yet' using errcode = '55000';
  end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.event_payments where event_id = p_event_id and status = 'paid';
  if v_paid <> v_event.total_cents then
    raise exception 'Collect everything first: % of % is paid', to_char(v_paid / 100.0, 'FM$999,990.00'), to_char(v_event.total_cents / 100.0, 'FM$999,990.00')
      using errcode = '55000', hint = 'unpaid';
  end if;
  select * into v_settings from public.event_settings where business_id = v_event.business_id;
  select tax_rate_services_bp into v_tax_bp from public.businesses where id = v_event.business_id;
  select s.id into v_me from public.staff s where s.user_id = (select auth.uid()) and s.business_id = v_event.business_id and s.is_active limit 1;

  -- Each person's package, split between their artists by minutes.
  for v_member in select * from public.event_members where event_id = p_event_id order by position loop
    select staff_id into v_hair from public.event_tasks where member_id = v_member.id and kind = 'hair' limit 1;
    select staff_id into v_makeup from public.event_tasks where member_id = v_member.id and kind = 'makeup' limit 1;
    v_hair_cents := case
      when v_member.makeup_minutes = 0 then v_member.price_cents
      when v_member.hair_minutes = 0 then 0
      else (v_member.price_cents * v_member.hair_minutes * 2 + (v_member.hair_minutes + v_member.makeup_minutes)) / (2 * (v_member.hair_minutes + v_member.makeup_minutes))
    end;
    if v_hair_cents > 0 then
      v_lines := v_lines || jsonb_build_object('staff_id', v_hair, 'description', concat(v_member.name, ' · ', v_member.package_name, case when v_member.makeup_minutes > 0 then ' (hair)' end), 'unit', v_hair_cents, 'taxed', true);
      if v_hair is not null then
        v_work := jsonb_set(v_work, array[v_hair::text], to_jsonb(coalesce((v_work ->> v_hair::text)::int, 0) + v_hair_cents));
      end if;
    end if;
    if v_member.price_cents - v_hair_cents > 0 then
      v_lines := v_lines || jsonb_build_object('staff_id', v_makeup, 'description', concat(v_member.name, ' · ', v_member.package_name, case when v_member.hair_minutes > 0 then ' (makeup)' end), 'unit', v_member.price_cents - v_hair_cents, 'taxed', true);
      if v_makeup is not null then
        v_work := jsonb_set(v_work, array[v_makeup::text], to_jsonb(coalesce((v_work ->> v_makeup::text)::int, 0) + v_member.price_cents - v_hair_cents));
      end if;
    end if;
  end loop;

  select coalesce(array_agg(distinct staff_id order by staff_id), '{}') into v_team from public.event_tasks where event_id = p_event_id and staff_id is not null;

  -- The service charge: the team's share by each artist's work, the rest
  -- the salon's.
  v_team_charge := case when cardinality(v_team) > 0 then (v_event.service_charge_cents * v_settings.service_charge_team_pct + 50) / 100 else 0 end;
  select coalesce(sum(value::int), 0) into v_work_total from jsonb_each_text(v_work);
  v_given := 0;
  if v_team_charge > 0 and v_work_total > 0 then
    v_i := 0;
    for v_staff in select key::uuid from jsonb_each_text(v_work) order by key loop
      v_i := v_i + 1;
      v_share := case when v_i = (select count(*) from jsonb_each_text(v_work)) then v_team_charge - v_given
                      else (v_team_charge * (v_work ->> v_staff::text)::int) / v_work_total end;
      v_given := v_given + v_share;
      v_tips := jsonb_set(v_tips, array[v_staff::text], to_jsonb(coalesce((v_tips ->> v_staff::text)::int, 0) + v_share));
    end loop;
  else
    v_team_charge := 0;
  end if;
  if v_event.service_charge_cents - v_team_charge > 0 then
    v_lines := v_lines || jsonb_build_object('staff_id', null, 'description', 'Service charge', 'unit', v_event.service_charge_cents - v_team_charge, 'taxed', false);
  end if;

  -- Travel: the team's share evenly, the rest the salon's (taxed, as priced).
  v_team_travel := case when cardinality(v_team) > 0 then (v_event.travel_fee_cents * v_settings.travel_team_pct + 50) / 100 else 0 end;
  if v_team_travel > 0 then
    v_given := 0;
    for v_i in 1 .. cardinality(v_team) loop
      v_share := case when v_i = cardinality(v_team) then v_team_travel - v_given else v_team_travel / cardinality(v_team) end;
      v_given := v_given + v_share;
      v_tips := jsonb_set(v_tips, array[v_team[v_i]::text], to_jsonb(coalesce((v_tips ->> v_team[v_i]::text)::int, 0) + v_share));
    end loop;
  end if;
  if v_event.travel_fee_cents > 0 then
    v_lines := v_lines || jsonb_build_object('staff_id', null, 'description', 'Travel', 'unit', v_event.travel_fee_cents - v_team_travel, 'taxed', true, 'taxable_base', v_event.travel_fee_cents);
  end if;
  if v_event.early_fee_cents > 0 then
    v_lines := v_lines || jsonb_build_object('staff_id', null, 'description', 'Early start', 'unit', v_event.early_fee_cents, 'taxed', true);
  end if;

  -- The event's tax, line by line, any rounding on the last taxed line.
  for v_i in 0 .. jsonb_array_length(v_lines) - 1 loop
    v_line := v_lines -> v_i;
    if (v_line ->> 'taxed')::boolean then
      v_share := ((coalesce((v_line ->> 'taxable_base')::int, (v_line ->> 'unit')::int)) * v_tax_bp + 5000) / 10000;
      v_lines := jsonb_set(v_lines, array[v_i::text, 'tax'], to_jsonb(v_share));
      v_tax_sum := v_tax_sum + v_share;
      v_taxed_last := v_i;
    else
      v_lines := jsonb_set(v_lines, array[v_i::text, 'tax'], '0');
    end if;
  end loop;
  if v_taxed_last is not null and v_tax_sum <> v_event.tax_cents then
    v_lines := jsonb_set(v_lines, array[v_taxed_last::text, 'tax'], to_jsonb((v_lines -> v_taxed_last ->> 'tax')::int + v_event.tax_cents - v_tax_sum));
  end if;
  select coalesce(sum((l ->> 'unit')::int), 0) into v_subtotal from jsonb_array_elements(v_lines) l;
  select coalesce(sum(value::int), 0) into v_tip_total from jsonb_each_text(v_tips);
  if v_subtotal + v_event.tax_cents + v_tip_total <> v_event.total_cents then
    raise exception 'The event''s lines don''t add up to its total' using errcode = 'P0001';
  end if;

  update public.businesses set next_sale_number = next_sale_number + 1 where id = v_event.business_id returning next_sale_number - 1 into v_number;
  insert into public.sales (business_id, location_id, number, client_id, subtotal_cents, tax_cents, tip_cents, total_cents, note, created_by)
  values (v_event.business_id, v_event.location_id, v_number, v_event.client_id, v_subtotal, v_event.tax_cents, v_tip_total, v_event.total_cents,
    left('Event: ' || v_event.title, 500), v_me)
  returning id into v_sale;
  for v_i in 0 .. jsonb_array_length(v_lines) - 1 loop
    v_line := v_lines -> v_i;
    insert into public.sale_items (sale_id, business_id, position, kind, staff_id, description, quantity, unit_price_cents, tax_cents, total_cents)
    values (v_sale, v_event.business_id, v_i + 1, 'service', nullif(v_line ->> 'staff_id', '')::uuid, left(v_line ->> 'description', 300), 1,
      (v_line ->> 'unit')::int, (v_line ->> 'tax')::int, (v_line ->> 'unit')::int + (v_line ->> 'tax')::int);
  end loop;
  insert into public.sale_tips (sale_id, business_id, staff_id, amount_cents)
  select v_sale, v_event.business_id, key::uuid, value::int from jsonb_each_text(v_tips) where value::int > 0;
  -- Every payment the event took, on the day it was taken.
  insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, processor, processor_reference, created_by, created_at)
  select v_sale, v_event.business_id, v_event.location_id, 'card', p.amount_cents, left(p.card_label, 40), p.provider, p.provider_reference, v_me, p.paid_at
  from public.event_payments p where p.event_id = p_event_id and p.status = 'paid';
  insert into public.sale_events (sale_id, business_id, kind, amount_cents, staff_id) values (v_sale, v_event.business_id, 'completed', v_event.total_cents, v_me);

  update public.events set status = 'completed', status_changed_at = now(), sale_id = v_sale where id = p_event_id;
  insert into public.event_history (business_id, event_id, kind, detail, staff_id)
  values (v_event.business_id, p_event_id, 'completed', 'Sale #' || v_number, v_me);
  return v_sale;
end;
$$;

-- Completed events keep their holds as a record of the day.
create or replace function private.sync_event_blocks(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_tz text;
  v_travel integer;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null or v_event.status = 'completed' then
    return;
  end if;
  perform set_config('maestra.event_sync', 'on', true);
  delete from public.time_blocks where event_id = p_event_id;
  if v_event.status in ('booked', 'trial_done') then
    select timezone into v_tz from public.locations where id = v_event.location_id;
    v_travel := case when v_event.on_location then v_event.travel_minutes else 0 end;
    insert into public.time_blocks (business_id, location_id, staff_id, kind, note, start_minute, end_minute, on_date, event_id)
    select v_event.business_id, v_event.location_id, t.staff_id, 'event', left(v_event.title, 300),
      greatest(0, (floor((extract(epoch from (min(t.starts_at) at time zone v_tz)::time) / 60 - 15 - v_travel) / 5) * 5)::int),
      least(1440, (ceil((extract(epoch from (max(t.ends_at) at time zone v_tz)::time) / 60 + v_travel) / 5) * 5)::int),
      v_event.event_date, v_event.id
    from public.event_tasks t
    where t.event_id = p_event_id and t.staff_id is not null
    group by t.staff_id;
  end if;
  perform set_config('maestra.event_sync', 'off', true);
  update public.locations set calendar_version = calendar_version + 1 where id = v_event.location_id;
end;
$$;

-- Team members no longer free when the client books (lib/events/clashes.ts
-- checks with the booking rules) come off the event, so nobody is
-- double-booked; the front of house is told to find someone (service
-- role).
create function public.release_event_staff(p_event_id uuid, p_staff_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_names text;
  v_staff uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null or coalesce(cardinality(p_staff_ids), 0) = 0 then
    return;
  end if;
  select string_agg(first_name, ', ' order by first_name) into v_names from public.staff where id = any (p_staff_ids) and business_id = v_event.business_id;
  update public.event_tasks set staff_id = null where event_id = p_event_id and staff_id = any (p_staff_ids);
  if not found then
    return;
  end if;
  perform private.sync_event_blocks(p_event_id);
  insert into public.event_history (business_id, event_id, kind, detail)
  values (v_event.business_id, p_event_id, 'team_released', left(v_names || ' had become busy and came off the event.', 1000));
  for v_staff in select s.id from public.staff s where s.business_id = v_event.business_id and s.is_active and s.role in ('owner', 'manager', 'front_desk') loop
    insert into public.notifications (business_id, location_id, staff_id, channel, template, body)
    values (v_event.business_id, v_event.location_id, v_staff, 'email', 'event_staff_needed',
      left(concat(v_event.title, ' is booked, but ', v_names, ' had become busy then and came off it. Choose someone else on the event.'), 1000));
  end loop;
end;
$$;

revoke all on function private.guard_event_blocks() from public;
revoke all on function private.sync_event_blocks(uuid) from public;
revoke all on function private.on_event_status() from public;
revoke all on function private.on_trial_done() from public;
revoke all on function public.link_event_trial(uuid, uuid) from public, anon;
revoke all on function public.save_event_look(uuid, text) from public, anon;
revoke all on function public.add_event_photo(uuid, text) from public, anon;
revoke all on function public.complete_event(uuid) from public, anon;
revoke all on function public.release_event_staff(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.release_event_staff(uuid, uuid[]) to service_role;
grant execute on function private.event_from_path(text) to authenticated;
grant execute on function public.link_event_trial(uuid, uuid) to authenticated;
grant execute on function public.save_event_look(uuid, text) to authenticated;
grant execute on function public.add_event_photo(uuid, text) to authenticated;
grant execute on function public.complete_event(uuid) to authenticated;
