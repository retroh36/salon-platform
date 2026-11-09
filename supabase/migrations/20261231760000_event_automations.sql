-- Event automations: when something happens to an event (an inquiry comes
-- in, the proposal is signed, the deposit is paid, or so many days before
-- the event), do something after a wait: send the client the salon's own
-- message, add a to-do for staff, or move the event to a stage of the
-- salon's own. A message goes out only once an owner has turned it on as
-- it reads now (changing its words turns it off until an owner turns it on
-- again); our code fills in the fields, never Denise.

create table public.event_automations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  trigger text not null check (trigger in ('inquiry_received', 'proposal_signed', 'deposit_paid', 'days_before')),
  days_before smallint check (days_before between 1 and 365),
  wait_days smallint not null default 0 check (wait_days between 0 and 60),
  action text not null check (action in ('message', 'task', 'move_stage')),
  subject text check (length(subject) <= 150),
  body text check (length(body) <= 1600),
  task text check (length(task) <= 200),
  stage_id uuid,
  enabled boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (stage_id, business_id) references public.event_stages (id, business_id) on delete cascade,
  foreign key (approved_by, business_id) references public.staff (id, business_id) on delete set null (approved_by),
  check ((trigger = 'days_before') = (days_before is not null)),
  check (action <> 'message' or (length(trim(body)) > 0)),
  check (action <> 'task' or (length(trim(task)) > 0)),
  check (action <> 'move_stage' or stage_id is not null),
  -- A message is on only once an owner said so.
  check (not enabled or action <> 'message' or approved_at is not null)
);
create index event_automations_business_idx on public.event_automations (business_id, position);

create table public.event_automation_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  automation_id uuid not null,
  event_id uuid not null,
  due_at timestamptz not null,
  status text not null default 'due' check (status in ('due', 'sending', 'done', 'skipped')),
  result text check (length(result) <= 200),
  done_at timestamptz,
  unique (automation_id, event_id),
  foreign key (automation_id, business_id) references public.event_automations (id, business_id) on delete cascade,
  foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade
);
create index event_automation_runs_due_idx on public.event_automation_runs (due_at) where status = 'due';

-- Staff to-dos on an event (an automation adds them; staff tick them off).
create table public.event_todos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  event_id uuid not null,
  text text not null check (length(trim(text)) between 1 and 200),
  automation_id uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid,
  foreign key (event_id, business_id) references public.events (id, business_id) on delete cascade,
  foreign key (done_by, business_id) references public.staff (id, business_id) on delete set null (done_by)
);
create index event_todos_event_idx on public.event_todos (event_id);

alter table public.event_automations enable row level security;
alter table public.event_automation_runs enable row level security;
alter table public.event_todos enable row level security;
create policy event_automations_read on public.event_automations for select to authenticated
  using (business_id in (select private.front_of_house_businesses()));
create policy event_automation_runs_read on public.event_automation_runs for select to authenticated
  using (business_id in (select private.front_of_house_businesses()));
create policy event_todos_read on public.event_todos for select to authenticated
  using (business_id in (select private.front_of_house_businesses()));
grant select on public.event_automations, public.event_automation_runs, public.event_todos to authenticated;

-- Save one (null id: a new one). Owners and managers with the settings
-- permission; a message is turned on only by an owner, and changing what
-- it says (or when) turns it off until an owner turns it on again.
create function public.save_event_automation(p_business_id uuid, p_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.event_automations;
  v_owner boolean := private.has_business_role(p_business_id, array['owner']::public.staff_role[]);
  v_action text := p_input ->> 'action';
  v_enabled boolean := coalesce((p_input ->> 'enabled')::boolean, false);
  v_body text := nullif(trim(coalesce(p_input ->> 'body', '')), '');
  v_subject text := nullif(trim(coalesce(p_input ->> 'subject', '')), '');
  v_approved_at timestamptz;
  v_approved_by uuid;
  v_id uuid;
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers set up event automations' using errcode = '42501';
  end if;
  if p_id is not null then
    select * into v_old from public.event_automations where id = p_id and business_id = p_business_id for update;
    if v_old.id is null then
      raise exception 'That automation is gone' using errcode = 'P0002';
    end if;
  end if;
  if v_action = 'message' then
    if v_owner and v_enabled then
      v_approved_at := now();
      v_approved_by := private.current_staff_id(p_business_id);
    elsif v_old.id is not null and v_old.approved_at is not null and v_old.body is not distinct from v_body
          and v_old.subject is not distinct from v_subject and v_old.trigger = p_input ->> 'trigger' then
      v_approved_at := v_old.approved_at;
      v_approved_by := v_old.approved_by;
    end if;
    if v_enabled and v_approved_at is null then
      raise exception 'Only an owner can turn on a message to clients' using errcode = '42501', hint = 'owner';
    end if;
  end if;
  insert into public.event_automations as a (id, business_id, name, trigger, days_before, wait_days, action, subject, body, task, stage_id, enabled, approved_by, approved_at, position)
  values (coalesce(p_id, gen_random_uuid()), p_business_id, trim(p_input ->> 'name'), p_input ->> 'trigger',
          case when p_input ->> 'trigger' = 'days_before' then (p_input ->> 'days_before')::smallint end,
          case when p_input ->> 'trigger' = 'days_before' then 0 else coalesce((p_input ->> 'wait_days')::smallint, 0) end,
          v_action,
          case when v_action = 'message' then v_subject end,
          case when v_action = 'message' then v_body end,
          case when v_action = 'task' then nullif(trim(coalesce(p_input ->> 'task', '')), '') end,
          case when v_action = 'move_stage' then nullif(p_input ->> 'stage_id', '')::uuid end,
          v_enabled, v_approved_by, v_approved_at,
          coalesce(v_old.position, (select coalesce(max(position) + 1, 0) from public.event_automations where business_id = p_business_id)))
  on conflict (id) do update set
    name = excluded.name, trigger = excluded.trigger, days_before = excluded.days_before, wait_days = excluded.wait_days,
    action = excluded.action, subject = excluded.subject, body = excluded.body, task = excluded.task, stage_id = excluded.stage_id,
    enabled = excluded.enabled, approved_by = excluded.approved_by, approved_at = excluded.approved_at, updated_at = now()
  returning id into v_id;
  if v_action = 'move_stage' and not exists (select 1 from public.event_automations a join public.event_stages s on s.id = a.stage_id where a.id = v_id and s.kind is null) then
    raise exception 'Choose one of your own stages' using errcode = '22023', hint = 'stage';
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_event_automation(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_event_automation(uuid, uuid, jsonb) to authenticated;

create function public.delete_event_automation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.event_automations where id = p_id;
  if v_business is null or not private.can(v_business, 'settings') then
    raise exception 'Only owners and managers set up event automations' using errcode = '42501';
  end if;
  delete from public.event_automations where id = p_id;
end;
$$;
revoke all on function public.delete_event_automation(uuid) from public, anon;
grant execute on function public.delete_event_automation(uuid) to authenticated;

-- What happened to an event starts the salon's automations for it.
create function private.queue_event_automations(p_event_id uuid, p_trigger text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.event_automation_runs (business_id, automation_id, event_id, due_at)
  select a.business_id, a.id, e.id, now() + make_interval(days => a.wait_days)
  from public.events e
  join public.event_automations a on a.business_id = e.business_id and a.trigger = p_trigger and a.enabled
  where e.id = p_event_id
  on conflict do nothing;
$$;
revoke all on function private.queue_event_automations(uuid, text) from public;

create function private.event_inquiry_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'inquiry' then
    perform private.queue_event_automations(new.id, 'inquiry_received');
  end if;
  return new;
end;
$$;
create trigger events_automations after insert on public.events
  for each row execute function private.event_inquiry_received();

create function private.event_proposal_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_event_automations(new.event_id, 'proposal_signed');
  return new;
end;
$$;
create trigger event_agreements_automations after insert on public.event_agreements
  for each row execute function private.event_proposal_signed();

create function private.event_deposit_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'deposit' and new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    perform private.queue_event_automations(new.event_id, 'deposit_paid');
  end if;
  return new;
end;
$$;
create trigger event_payments_automations after insert or update of status on public.event_payments
  for each row execute function private.event_deposit_paid();

-- The scheduled run (service role, hourly with events' payments, for the
-- salons in their sending hours): queues "days before" runs whose day has
-- come, does every due to-do and stage move here, and hands back the
-- messages due (marked sending) for our code to fill in and send. A run
-- for an event that's lost or completed is skipped.
create function public.claim_event_automations(p_business_ids uuid[])
returns table (run_id uuid, business_id uuid, event_id uuid, automation_id uuid, subject text, body text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run record;
begin
  insert into public.event_automation_runs (business_id, automation_id, event_id, due_at)
  select a.business_id, a.id, e.id, now()
  from public.event_automations a
  join public.events e on e.business_id = a.business_id and e.status in ('booked', 'trial_done')
  join public.locations l on l.id = e.location_id
  where a.business_id = any (p_business_ids) and a.enabled and a.trigger = 'days_before'
    and e.event_date - a.days_before <= (now() at time zone l.timezone)::date
    and e.event_date >= (now() at time zone l.timezone)::date
  on conflict do nothing;

  for v_run in
    select r.id, r.event_id, r.business_id, a.id as automation_id, a.name, a.action, a.task, a.stage_id, a.enabled, e.status, e.stage_id as event_stage
    from public.event_automation_runs r
    join public.event_automations a on a.id = r.automation_id
    join public.events e on e.id = r.event_id
    where r.status = 'due' and r.due_at <= now() and r.business_id = any (p_business_ids)
    order by r.due_at
    limit 200
    for update of r skip locked
  loop
    if not v_run.enabled or v_run.status in ('lost', 'completed') then
      update public.event_automation_runs set status = 'skipped', done_at = now(),
        result = case when v_run.enabled then 'The event is ' || v_run.status else 'Turned off' end
      where id = v_run.id;
    elsif v_run.action = 'task' then
      insert into public.event_todos (business_id, event_id, text, automation_id) values (v_run.business_id, v_run.event_id, v_run.task, v_run.automation_id);
      update public.event_automation_runs set status = 'done', done_at = now(), result = 'To-do added' where id = v_run.id;
      insert into public.event_history (business_id, event_id, kind, detail) values (v_run.business_id, v_run.event_id, 'automation', v_run.name || ': ' || v_run.task);
    elsif v_run.action = 'move_stage' then
      update public.events set stage_id = v_run.stage_id where id = v_run.event_id;
      update public.event_automation_runs set status = 'done', done_at = now(), result = 'Moved' where id = v_run.id;
      insert into public.event_history (business_id, event_id, kind, detail)
      values (v_run.business_id, v_run.event_id, 'automation', v_run.name || ': moved to ' || (select name from public.event_stages where id = v_run.stage_id));
    else
      update public.event_automation_runs set status = 'sending' where id = v_run.id;
      run_id := v_run.id; business_id := v_run.business_id; event_id := v_run.event_id; automation_id := v_run.automation_id;
      select a.subject, a.body into subject, body from public.event_automations a where a.id = v_run.automation_id;
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.claim_event_automations(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_event_automations(uuid[]) to service_role;

create function public.finish_event_automation(p_run_id uuid, p_sent boolean, p_result text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.event_automation_runs;
begin
  update public.event_automation_runs set status = case when p_sent then 'done' else 'skipped' end, done_at = now(), result = left(p_result, 200)
  where id = p_run_id and status = 'sending' returning * into v_run;
  if v_run.id is not null then
    insert into public.event_history (business_id, event_id, kind, detail)
    select v_run.business_id, v_run.event_id, 'automation', a.name || ': ' || left(p_result, 200) from public.event_automations a where a.id = v_run.automation_id;
  end if;
end;
$$;
revoke all on function public.finish_event_automation(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_event_automation(uuid, boolean, text) to service_role;

-- Tick a to-do off (or back on).
create function public.set_event_todo_done(p_todo_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_todo public.event_todos;
begin
  select * into v_todo from public.event_todos where id = p_todo_id;
  if v_todo.id is null or not private.front_of_house(v_todo.business_id) then
    raise exception 'Only the front desk, managers and owners can change events' using errcode = '42501';
  end if;
  update public.event_todos set done_at = case when p_done then now() end, done_by = case when p_done then private.current_staff_id(v_todo.business_id) end
  where id = p_todo_id;
end;
$$;
revoke all on function public.set_event_todo_done(uuid, boolean) from public, anon;
grant execute on function public.set_event_todo_done(uuid, boolean) to authenticated;
