-- Safe tasks Denise prepares for someone to confirm (lib/denise/tasks.ts):
-- the first kind is a stylist's service times ("change Hannah's blowout to
-- 30 minutes", "copy Bridget's times to Shae"). Prepared as an AI action
-- (feature 'task', recorded by the person asking), each service's time as
-- it was then (`from`) and what it becomes (`to`, null for the menu's).
-- Confirm applies it only for someone who may change that person's times
-- (as set_staff_timings: owners and managers with team, never an owner's
-- by a manager) and only while every time is still what it was prepared
-- from; Undo puts them back only while nothing has changed them since.

create function private.task_staff_check(p_business_id uuid, p_staff_id uuid)
returns public.staff
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
  v_my_role public.staff_role;
begin
  select * into v_staff from public.staff where id = p_staff_id and business_id = p_business_id;
  if v_staff.id is null then
    raise exception 'That team member is no longer here' using errcode = '55000', hint = 'gone';
  end if;
  select role into v_my_role from public.staff where id = private.current_staff_id(p_business_id);
  if v_my_role is null or v_my_role not in ('owner', 'manager') or not private.can(p_business_id, 'team')
     or (v_staff.role = 'owner' and v_my_role <> 'owner') then
    raise exception 'Only someone who manages % can change their times', v_staff.first_name using errcode = '42501';
  end if;
  return v_staff;
end;
$$;

-- A row's time as the task writes it: null when it's the menu's.
create function private.task_timing(p_row public.staff_services)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_row.active_minutes is null then null
    else jsonb_build_object('active', p_row.active_minutes, 'processing', coalesce(p_row.processing_minutes, 0), 'finishing', coalesce(p_row.finishing_minutes, 0)) end
$$;

create function private.write_task_times(p_staff public.staff, p_changes jsonb, p_expect text, p_write text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change jsonb;
  v_row public.staff_services;
  v_to jsonb;
begin
  for v_change in select * from jsonb_array_elements(p_changes) loop
    select * into v_row from public.staff_services
    where staff_id = p_staff.id and service_id = (v_change ->> 'service_id')::uuid
    for update;
    if v_row.staff_id is null then
      raise exception '% no longer does one of these services', p_staff.first_name using errcode = '55000', hint = 'not_offered';
    end if;
    if private.task_timing(v_row) is distinct from nullif(v_change -> p_expect, 'null'::jsonb) then
      raise exception '%''s times have changed since this was prepared', p_staff.first_name using errcode = '55000', hint = 'changed';
    end if;
    v_to := nullif(v_change -> p_write, 'null'::jsonb);
    update public.staff_services set
      active_minutes = (v_to ->> 'active')::int,
      processing_minutes = (v_to ->> 'processing')::int,
      finishing_minutes = (v_to ->> 'finishing')::int,
      updated_at = now()
    where staff_id = v_row.staff_id and service_id = v_row.service_id;
  end loop;
end;
$$;

create function public.apply_task_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
  v_staff public.staff;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null or v_action.business_id not in (select private.member_businesses()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_action.feature <> 'task' or v_action.proposal ->> 'kind' is distinct from 'service_times' then
    raise exception 'That isn''t a task' using errcode = '22023';
  end if;
  if v_action.status <> 'proposed' then
    raise exception 'This was already decided' using errcode = '55000', hint = 'decided';
  end if;
  v_staff := private.task_staff_check(v_action.business_id, (v_action.proposal ->> 'staff_id')::uuid);
  perform private.write_task_times(v_staff, v_action.proposal -> 'changes', 'from', 'to');
  update public.ai_actions set
    status = 'approved',
    decided_by = private.current_staff_id(business_id),
    decided_at = now(),
    previous_state = v_action.proposal
  where id = v_action.id;
end;
$$;

create function public.undo_task_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
  v_staff public.staff;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null or v_action.business_id not in (select private.member_businesses()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_action.feature <> 'task' or v_action.status <> 'approved' then
    raise exception 'Only a confirmed task can be undone' using errcode = '55000', hint = 'decided';
  end if;
  v_staff := private.task_staff_check(v_action.business_id, (v_action.previous_state ->> 'staff_id')::uuid);
  perform private.write_task_times(v_staff, v_action.previous_state -> 'changes', 'to', 'from');
  update public.ai_actions set status = 'undone', undone_by = private.current_staff_id(business_id), undone_at = now()
  where id = v_action.id;
end;
$$;

revoke all on function private.task_staff_check(uuid, uuid), private.task_timing(public.staff_services), private.write_task_times(public.staff, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.apply_task_action(uuid), public.undo_task_action(uuid) from public, anon;
grant execute on function public.apply_task_action(uuid), public.undo_task_action(uuid) to authenticated;
