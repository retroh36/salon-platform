-- A client message goes out only when staff send it.
--
-- Applying one of Denise's fixes used to record a "time_change" text to
-- each moved client as pending, for a sender to come (and Undo a
-- "time_change_undone"). Once texts were connected those would have gone
-- out by themselves, on top of the message staff check and send after
-- Apply ("Message ready to send", send_client_message). So:
--   - every pending client notice from a fix is canceled;
--   - applying and undoing record notices for the team only, even for
--     proposals stored before this with client notices in them;
--   - a proposal carrying a client notice is refused.
-- Notices to stylists (in the app, or texts to staff) are unchanged.

update public.notifications set status = 'canceled', updated_at = now()
where ai_action_id is not null and client_id is not null and status = 'pending';

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
  -- Notices to the team: in the app they reach the stylist straight away;
  -- texts wait for the provider. Never one to a client: a client hears
  -- about a fix only from a message staff send (send_client_message), so
  -- nothing here could ever go out to a client by itself.
  insert into public.notifications (business_id, location_id, ai_action_id, appointment_id, client_id, staff_id, channel, status, template, body)
  select p_action.business_id, p_action.location_id, p_action.id, (n ->> 'appointment_id')::uuid,
         (n ->> 'client_id')::uuid, (n ->> 'staff_id')::uuid, coalesce(n ->> 'channel', 'sms'),
         case when n ->> 'channel' = 'app' then 'sent' else 'pending' end::public.notification_status, n ->> 'template', n ->> 'body'
  from jsonb_array_elements(coalesce(p_action.proposal -> 'notifications', '[]')) n
  where nullif(n ->> 'client_id', '') is null
    and (n ->> 'channel' is distinct from 'app' or (n ->> 'staff_id') is not null);

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
  where nullif(u ->> 'client_id', '') is null
    and exists (
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
    if nullif(v_notice ->> 'client_id', '') is not null then
      raise exception 'A fix never records a message to a client' using errcode = '22023';
    end if;
    if v_notice ->> 'template' not in ('staff_schedule_change', 'staff_schedule_change_undone', 'staff_block_moved', 'staff_block_moved_undone',
                                       'staff_covering', 'staff_covering_undone') then
      raise exception 'Not a fix notice' using errcode = '22023';
    end if;
    if v_notice ->> 'template' in ('staff_covering', 'staff_covering_undone') and v_notice ->> 'channel' is distinct from 'app' then
      raise exception 'A covering notice goes in the app' using errcode = '22023';
    end if;
    if nullif(v_notice ->> 'staff_id', '') is not null
       and not exists (select 1 from public.staff s where s.id = (v_notice ->> 'staff_id')::uuid and s.business_id = p_business_id) then
      raise exception 'A stylist notice goes to the salon''s staff' using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke all on function private.check_proposal_notices(uuid, jsonb) from public;
