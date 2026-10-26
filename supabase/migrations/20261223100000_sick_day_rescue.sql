-- Sick-day rescue (lib/scheduling/rescue.ts, app/calendar/rescue/): one
-- plan for every client of a stylist who's out, applied at once through the
-- AI action log, with undo.
--
-- - A move can carry the new stylist's own length for the service
--   (changes[].timing, as a proposed booking's lines already can); undo
--   puts the old length back.
-- - Notices in the app (channel 'app'): the covering stylists are told,
--   and read their own (read_at, mark_notices_read). They count as sent at
--   once, so undo tells them too.
-- - Clients who only see their preferred stylist (only_sees_preferred) are
--   offered a reschedule with them, never someone else.
-- - Two quick picks for messaging those clients about it.

alter table public.clients add column only_sees_preferred boolean not null default false;

alter table public.notifications drop constraint notifications_channel_check;
alter table public.notifications add constraint notifications_channel_check check (channel in ('sms', 'email', 'app'));
alter table public.notifications add column read_at timestamptz;
create index notifications_unread_app_idx on public.notifications (staff_id, created_at desc) where channel = 'app' and read_at is null;

create policy "Staff can view their own notices in the app"
  on public.notifications for select to authenticated
  using (channel = 'app' and staff_id is not null and staff_id = (select private.current_staff_id(business_id)));

-- Marks the signed-in person's own app notices as read.
create function public.mark_notices_read(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications n set read_at = now()
  where n.id = any (p_ids) and n.channel = 'app' and n.read_at is null
    and n.staff_id = private.current_staff_id(n.business_id);
$$;
revoke all on function public.mark_notices_read(uuid[]) from public, anon;
grant execute on function public.mark_notices_read(uuid[]) to authenticated;

alter table public.client_messages drop constraint client_messages_template_check;
alter table public.client_messages add constraint client_messages_template_check
  check (template in ('running_late', 'please_call', 'need_to_move', 'reminder', 'ready_early', 'stylist_out_covered', 'stylist_out_moved', 'custom', 'special'));

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
      'timing', jsonb_build_object('active', v_item.active_minutes, 'processing', v_item.processing_minutes, 'finishing', v_item.finishing_minutes),
      'applied', v_change -> 'to'
    );
    -- The new stylist's own length for the service, when the change says.
    v_timing := coalesce(private.item_timing(v_change -> 'timing'), array[v_item.active_minutes, v_item.processing_minutes, v_item.finishing_minutes]);

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
      ends_at = (v_change #>> '{to,starts_at}')::timestamptz + make_interval(mins => v_timing[1] + v_timing[2] + v_timing[3]),
      active_minutes = v_timing[1],
      processing_minutes = v_timing[2],
      finishing_minutes = v_timing[3],
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
      active_minutes = coalesce((v_prev #>> '{timing,active}')::int, active_minutes),
      processing_minutes = coalesce((v_prev #>> '{timing,processing}')::int, processing_minutes),
      finishing_minutes = coalesce((v_prev #>> '{timing,finishing}')::int, finishing_minutes),
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

create or replace function private.ai_action_applied(p_action public.ai_actions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_move jsonb;
  v_block public.time_blocks;
  v_created uuid;
  v_done jsonb := '[]';
begin
  -- Notices in the app reach the stylist straight away; texts and emails
  -- wait for the provider.
  insert into public.notifications (business_id, location_id, ai_action_id, appointment_id, client_id, staff_id, channel, status, template, body)
  select p_action.business_id, p_action.location_id, p_action.id, (n ->> 'appointment_id')::uuid,
         (n ->> 'client_id')::uuid, (n ->> 'staff_id')::uuid, coalesce(n ->> 'channel', 'sms'),
         case when n ->> 'channel' = 'app' then 'sent' else 'pending' end::public.notification_status, n ->> 'template', n ->> 'body'
  from jsonb_array_elements(coalesce(p_action.proposal -> 'notifications', '[]')) n
  where n ->> 'channel' is distinct from 'app' or (n ->> 'staff_id') is not null;

  update public.schedule_disruptions set resolved_by_action = p_action.id
  where location_id = p_action.location_id
    and id in (select (r #>> '{}')::uuid from jsonb_array_elements(coalesce(p_action.proposal -> 'resolves', '[]')) r);

  for v_move in select * from jsonb_array_elements(coalesce(p_action.proposal -> 'block_moves', '[]')) loop
    select * into v_block from public.time_blocks
    where id = (v_move ->> 'block_id')::uuid and business_id = p_action.business_id
    for update;
    if v_block.id is null or v_block.kind not in ('lunch', 'break') then
      raise exception 'Only lunches and breaks can be moved' using errcode = '55000';
    end if;
    if (v_block.on_date is not null and (v_block.start_minute, v_block.end_minute) is distinct from
          ((v_move #>> '{from,start}')::int, (v_move #>> '{from,end}')::int))
       or exists (select 1 from public.time_block_skips s where s.block_id = v_block.id and s.on_date = (v_move ->> 'on_date')::date) then
      raise exception 'The calendar changed since this was proposed' using errcode = '55000';
    end if;
    if v_block.on_date is not null then
      update public.time_blocks set start_minute = (v_move #>> '{to,start}')::int, end_minute = (v_move #>> '{to,end}')::int
      where id = v_block.id;
      v_created := null;
    else
      insert into public.time_block_skips (block_id, business_id, on_date) values (v_block.id, v_block.business_id, (v_move ->> 'on_date')::date);
      insert into public.time_blocks (business_id, location_id, staff_id, kind, note, start_minute, end_minute, on_date, created_by)
      values (v_block.business_id, v_block.location_id, v_block.staff_id, v_block.kind, v_block.note,
              (v_move #>> '{to,start}')::int, (v_move #>> '{to,end}')::int, (v_move ->> 'on_date')::date,
              private.current_staff_id(v_block.business_id))
      returning id into v_created;
    end if;
    v_done := v_done || jsonb_build_object('move', v_move, 'created_block_id', v_created);
  end loop;

  if jsonb_array_length(v_done) > 0 then
    update public.ai_actions set previous_state = previous_state || jsonb_build_object('block_moves', v_done) where id = p_action.id;
  end if;
end;
$$;

create or replace function private.ai_action_undone(p_action public.ai_actions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
begin
  update public.notifications set status = 'canceled'
  where ai_action_id = p_action.id and status = 'pending';

  insert into public.notifications (business_id, location_id, ai_action_id, appointment_id, client_id, staff_id, channel, status, template, body)
  select p_action.business_id, p_action.location_id, p_action.id, (u ->> 'appointment_id')::uuid,
         (u ->> 'client_id')::uuid, (u ->> 'staff_id')::uuid, coalesce(u ->> 'channel', 'sms'),
         case when u ->> 'channel' = 'app' then 'sent' else 'pending' end::public.notification_status, u ->> 'template', u ->> 'body'
  from jsonb_array_elements(coalesce(p_action.proposal -> 'undo_notifications', '[]')) u
  where exists (
    select 1 from public.notifications n
    where n.ai_action_id = p_action.id and n.status = 'sent'
      and (n.client_id = (u ->> 'client_id')::uuid or n.staff_id = (u ->> 'staff_id')::uuid)
  );

  -- Reopen what it resolved, unless it's been reported again since.
  update public.schedule_disruptions d set resolved_by_action = null
  where d.resolved_by_action = p_action.id
    and not exists (
      select 1 from public.schedule_disruptions o
      where o.kind = 'client_late' and o.appointment_id = d.appointment_id and o.resolved_by_action is null
    );

  -- Put moved lunches and breaks back.
  for v_done in select * from jsonb_array_elements(coalesce(p_action.previous_state -> 'block_moves', '[]')) loop
    if v_done ->> 'created_block_id' is not null then
      delete from public.time_blocks where id = (v_done ->> 'created_block_id')::uuid;
      delete from public.time_block_skips
      where block_id = (v_done #>> '{move,block_id}')::uuid and on_date = (v_done #>> '{move,on_date}')::date;
    else
      update public.time_blocks set start_minute = (v_done #>> '{move,from,start}')::int, end_minute = (v_done #>> '{move,from,end}')::int
      where id = (v_done #>> '{move,block_id}')::uuid;
    end if;
  end loop;
end;
$$;

-- A rescue's notices to the stylists taking on its clients (in the app)
-- are fix notices too.
create or replace function private.check_proposal_notices(p_business_id uuid, p_options jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_notice jsonb;
begin
  for v_notice in
    select n from jsonb_array_elements(coalesce(p_options, '[]')) o,
      jsonb_array_elements(coalesce(o -> 'proposal' -> 'notifications', '[]') || coalesce(o -> 'proposal' -> 'undo_notifications', '[]')) n
  loop
    if v_notice ->> 'template' not in ('time_change', 'time_change_undone', 'staff_schedule_change', 'staff_schedule_change_undone', 'staff_block_moved', 'staff_block_moved_undone',
                                       'staff_covering', 'staff_covering_undone') then
      raise exception 'Not a fix notice' using errcode = '22023';
    end if;
    if v_notice ->> 'template' in ('staff_covering', 'staff_covering_undone') and v_notice ->> 'channel' is distinct from 'app' then
      raise exception 'A covering notice goes in the app' using errcode = '22023';
    end if;
    if nullif(v_notice ->> 'client_id', '') is not null
       and not exists (select 1 from public.appointments a where a.id = (v_notice ->> 'appointment_id')::uuid and a.business_id = p_business_id and a.client_id = (v_notice ->> 'client_id')::uuid) then
      raise exception 'A client notice goes to the visit''s own client' using errcode = '22023';
    end if;
    if nullif(v_notice ->> 'staff_id', '') is not null
       and not exists (select 1 from public.staff s where s.id = (v_notice ->> 'staff_id')::uuid and s.business_id = p_business_id) then
      raise exception 'A stylist notice goes to the salon''s staff' using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke all on function private.check_proposal_notices(uuid, jsonb) from public;
