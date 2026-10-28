-- Denise drafts next month's schedule (lib/coverage.ts, `draftMonth`): our
-- code works out the days, she proposes them through the AI action log
-- (feature `schedule_draft`), and an owner or manager applies them into the
-- draft, where they're checked and published week by week as usual.
-- Applying records each day's draft as it was, so undo puts it back.

create function public.apply_schedule_draft_action(p_action_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
  v_days jsonb;
  v_tz text;
  v_previous jsonb;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null or not private.has_business_role(v_action.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can change the schedule' using errcode = '42501';
  end if;
  if v_action.feature <> 'schedule_draft' or v_action.status <> 'proposed' then
    raise exception 'This suggestion was already decided' using errcode = '55000';
  end if;
  v_days := coalesce(v_action.proposal -> 'days', '[]'::jsonb);
  select timezone into v_tz from public.locations where id = v_action.location_id;
  if exists (select 1 from jsonb_array_elements(v_days) d where (d ->> 'on_date')::date < (now() at time zone v_tz)::date) then
    raise exception 'Some of those days have passed. Ask Denise for a new draft.' using errcode = '55000';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('staff_id', d ->> 'staff_id', 'on_date', d ->> 'on_date', 'shifts', sd.shifts)), '[]'::jsonb)
  into v_previous
  from jsonb_array_elements(v_days) d
  left join public.schedule_drafts sd on sd.staff_id = (d ->> 'staff_id')::uuid and sd.on_date = (d ->> 'on_date')::date;

  perform public.save_schedule_drafts(v_action.location_id, v_days);

  update public.ai_actions set
    status = 'approved',
    decided_by = private.current_staff_id(business_id),
    decided_at = now(),
    previous_state = jsonb_build_object('drafts', v_previous)
  where id = v_action.id;
  return jsonb_array_length(v_days);
end;
$$;

-- Puts each day's draft back as it was before (none, or what it said).
-- Days published since stay as they are.
create function public.undo_schedule_draft_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
  v_day jsonb;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null or not private.has_business_role(v_action.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can change the schedule' using errcode = '42501';
  end if;
  if v_action.feature <> 'schedule_draft' or v_action.status <> 'approved' then
    raise exception 'Only an applied suggestion can be undone' using errcode = '55000';
  end if;
  for v_day in select * from jsonb_array_elements(coalesce(v_action.previous_state -> 'drafts', '[]'::jsonb)) loop
    delete from public.schedule_drafts where staff_id = (v_day ->> 'staff_id')::uuid and on_date = (v_day ->> 'on_date')::date;
    if jsonb_typeof(v_day -> 'shifts') = 'array' then
      insert into public.schedule_drafts (business_id, location_id, staff_id, on_date, shifts, updated_by)
      values (v_action.business_id, v_action.location_id, (v_day ->> 'staff_id')::uuid, (v_day ->> 'on_date')::date, v_day -> 'shifts', private.current_staff_id(v_action.business_id));
    end if;
  end loop;
  update public.ai_actions set status = 'undone', undone_by = private.current_staff_id(business_id), undone_at = now()
  where id = v_action.id;
end;
$$;

revoke all on function public.apply_schedule_draft_action(uuid) from public, anon;
revoke all on function public.undo_schedule_draft_action(uuid) from public, anon;
grant execute on function public.apply_schedule_draft_action(uuid) to authenticated;
grant execute on function public.undo_schedule_draft_action(uuid) to authenticated;
