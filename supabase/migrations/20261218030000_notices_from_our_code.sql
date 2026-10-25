-- Notices to clients and stylists (a fix's "your appointment has moved",
-- a move made at the desk) are system messages, in our fixed templates.
-- Their text came from the browser's request, so anyone at the front desk
-- could call record_ai_proposals or record_visit_notices themselves with
-- words of their own, which would then go out as if from the salon's
-- system. Now only our server code records them, with the service role,
-- after the person's own login has said who they are; the database still
-- checks that person may (the front of house, at that salon), and where
-- each notice goes.

-- A signed-in person's staff record at a business, if they're front of house there.
create function private.front_of_house_staff(p_user_id uuid, p_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.staff s
  where s.user_id = p_user_id and s.business_id = p_business_id and s.is_active
    and s.role in ('owner', 'manager', 'front_desk')
  limit 1;
$$;
revoke all on function private.front_of_house_staff(uuid, uuid) from public;

-- Each notice in a proposal goes to that visit's own client or the salon's
-- staff, from the fix templates only.
create function private.check_proposal_notices(p_business_id uuid, p_options jsonb)
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
    if v_notice ->> 'template' not in ('time_change', 'time_change_undone', 'staff_schedule_change', 'staff_schedule_change_undone', 'staff_block_moved', 'staff_block_moved_undone') then
      raise exception 'Not a fix notice' using errcode = '22023';
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

-- From a signed-in person: proposals without notices only.
create or replace function public.record_ai_proposals(p_location_id uuid, p_feature text, p_subject text, p_options jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  if v_business_id is null
     or not private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to record proposals here' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_options, '[]')) o
    where jsonb_array_length(coalesce(o -> 'proposal' -> 'notifications', '[]')) > 0
       or jsonb_array_length(coalesce(o -> 'proposal' -> 'undo_notifications', '[]')) > 0
  ) then
    raise exception 'Notices are written by Maestra, not sent in' using errcode = '42501';
  end if;
  return private.record_proposals(p_location_id, p_feature, p_subject, p_options, private.current_staff_id(v_business_id));
end;
$$;

-- From our server (service role), for the person whose login it checked.
create function public.record_ai_proposals_for_user(p_user_id uuid, p_location_id uuid, p_feature text, p_subject text, p_options jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_staff uuid;
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  v_staff := private.front_of_house_staff(p_user_id, v_business_id);
  if v_staff is null then
    raise exception 'Not allowed to record proposals here' using errcode = '42501';
  end if;
  perform private.check_proposal_notices(v_business_id, p_options);
  return private.record_proposals(p_location_id, p_feature, p_subject, p_options, v_staff);
end;
$$;

-- The system's own (the nightly risk check): the same checks on notices.
create or replace function public.record_ai_proposals_as_system(p_location_id uuid, p_feature text, p_subject text, p_options jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_proposal_notices((select l.business_id from public.locations l where l.id = p_location_id), p_options);
  return private.record_proposals(p_location_id, p_feature, p_subject, p_options, null);
end;
$$;

-- Move notices: from our server only, for the person who made the move.
drop function public.record_visit_notices(uuid, jsonb);

create function public.record_visit_notices_for_user(p_user_id uuid, p_appointment_id uuid, p_notices jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_notice jsonb;
  v_count integer := 0;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if v_appointment.id is null or private.front_of_house_staff(p_user_id, v_appointment.business_id) is null then
    raise exception 'Not allowed to change this appointment' using errcode = '42501';
  end if;
  for v_notice in select * from jsonb_array_elements(coalesce(p_notices, '[]')) loop
    if v_notice ->> 'template' not in ('visit_moved', 'staff_visit_moved') then
      raise exception 'Not a move notice' using errcode = '22023';
    end if;
    if (v_notice ->> 'template') = 'visit_moved' and (v_notice ->> 'client_id')::uuid is distinct from v_appointment.client_id then
      raise exception 'A visit notice goes to its own client' using errcode = '22023';
    end if;
    if (v_notice ->> 'template') = 'staff_visit_moved'
       and not exists (select 1 from public.staff s where s.id = (v_notice ->> 'staff_id')::uuid and s.business_id = v_appointment.business_id) then
      raise exception 'A stylist notice goes to the salon''s staff' using errcode = '22023';
    end if;
    insert into public.notifications (business_id, location_id, appointment_id, client_id, staff_id, template, body)
    values (
      v_appointment.business_id, v_appointment.location_id, p_appointment_id,
      case when v_notice ->> 'template' = 'visit_moved' then v_appointment.client_id end,
      case when v_notice ->> 'template' = 'staff_visit_moved' then (v_notice ->> 'staff_id')::uuid end,
      v_notice ->> 'template', v_notice ->> 'body'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.record_ai_proposals_for_user(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_visit_notices_for_user(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_ai_proposals_for_user(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.record_visit_notices_for_user(uuid, uuid, jsonb) to service_role;
