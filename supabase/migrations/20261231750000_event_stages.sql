-- The Events board's columns are each salon's own: rename them, put them in
-- order, add stages of their own. The six built-in stages stay, since the
-- event's status (proposal sent, booked, paid...) puts events there and the
-- money rules follow the status, never the stage. A stage of the salon's own
-- is a place staff put an event by hand; any change of status takes it out.

create table public.event_stages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  -- Null: one of the salon's own.
  kind text check (kind in ('inquiry', 'proposal_sent', 'booked', 'trial_done', 'event_day', 'completed')),
  position smallint not null,
  unique (id, business_id),
  unique (business_id, kind)
);
create index event_stages_business_idx on public.event_stages (business_id, position);

alter table public.event_stages enable row level security;
create policy event_stages_read on public.event_stages for select to authenticated
  using (business_id in (select private.member_businesses()));
grant select on public.event_stages to authenticated;

create function private.default_event_stages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.event_stages (business_id, name, kind, position)
  values (new.id, 'Inquiry', 'inquiry', 0),
         (new.id, 'Proposal sent', 'proposal_sent', 1),
         (new.id, 'Booked', 'booked', 2),
         (new.id, 'Trial done', 'trial_done', 3),
         (new.id, 'Event day', 'event_day', 4),
         (new.id, 'Completed', 'completed', 5);
  return new;
end;
$$;

create trigger businesses_default_event_stages
  after insert on public.businesses
  for each row execute function private.default_event_stages();

insert into public.event_stages (business_id, name, kind, position)
select b.id, s.name, s.kind, s.position
from public.businesses b
cross join (values ('Inquiry', 'inquiry', 0), ('Proposal sent', 'proposal_sent', 1), ('Booked', 'booked', 2),
                   ('Trial done', 'trial_done', 3), ('Event day', 'event_day', 4), ('Completed', 'completed', 5)) s (name, kind, position);

alter table public.events add column stage_id uuid references public.event_stages (id) on delete set null;
create index events_stage_idx on public.events (stage_id) where stage_id is not null;
grant select (stage_id) on public.events to authenticated;

-- A change of status moves the event on, out of a stage of the salon's own.
create function private.event_status_clears_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.stage_id := null;
  return new;
end;
$$;

create trigger events_status_clears_stage
  before update of status on public.events
  for each row when (old.status is distinct from new.status)
  execute function private.event_status_clears_stage();

-- The whole list, in order (as stagesProblem in lib/events/stages.ts). A
-- stage left out is removed, and its events go back to where their status
-- puts them.
create function public.save_event_stages(p_business_id uuid, p_stages jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_position integer := 0;
  v_name text;
  v_kept uuid[] := '{}';
  v_id uuid;
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers change the event stages' using errcode = '42501';
  end if;
  if jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) > 12 then
    raise exception 'Up to 12 stages' using errcode = '22023', hint = 'count';
  end if;
  if (select count(*) from jsonb_array_elements(p_stages) s where s ->> 'kind' in ('inquiry', 'proposal_sent', 'booked', 'trial_done', 'event_day', 'completed')) <> 6
     or (select count(distinct s ->> 'kind') from jsonb_array_elements(p_stages) s where s ->> 'kind' is not null) <> 6
     or exists (select 1 from jsonb_array_elements(p_stages) s where s ->> 'kind' is not null and s ->> 'kind' not in ('inquiry', 'proposal_sent', 'booked', 'trial_done', 'event_day', 'completed')) then
    raise exception 'The six built-in stages can be renamed and moved, not removed' using errcode = '22023', hint = 'built_in';
  end if;
  if exists (select 1 from jsonb_array_elements(p_stages) s where length(trim(coalesce(s ->> 'name', ''))) not between 1 and 40) then
    raise exception 'Give every stage a name of up to 40 characters' using errcode = '22023', hint = 'name';
  end if;
  if (select count(distinct lower(trim(s ->> 'name'))) from jsonb_array_elements(p_stages) s) <> jsonb_array_length(p_stages) then
    raise exception 'Two stages have the same name' using errcode = '22023', hint = 'duplicate';
  end if;

  for v_row in select * from jsonb_array_elements(p_stages) loop
    v_name := trim(v_row ->> 'name');
    if v_row ->> 'kind' is not null then
      update public.event_stages set name = v_name, position = v_position
      where business_id = p_business_id and kind = v_row ->> 'kind' returning id into v_id;
    elsif nullif(v_row ->> 'id', '') is not null then
      update public.event_stages set name = v_name, position = v_position
      where business_id = p_business_id and id = (v_row ->> 'id')::uuid and kind is null returning id into v_id;
      if v_id is null then
        raise exception 'That stage is gone' using errcode = 'P0002';
      end if;
    else
      insert into public.event_stages (business_id, name, position) values (p_business_id, v_name, v_position) returning id into v_id;
    end if;
    v_kept := v_kept || v_id;
    v_id := null;
    v_position := v_position + 1;
  end loop;
  delete from public.event_stages where business_id = p_business_id and not (id = any (v_kept));
end;
$$;
revoke all on function public.save_event_stages(uuid, jsonb) from public, anon;
grant execute on function public.save_event_stages(uuid, jsonb) to authenticated;

-- Put an event in one of the salon's own stages, or back where its status
-- puts it (null).
create function public.set_event_stage(p_event_id uuid, p_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_stage public.event_stages;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null or not private.front_of_house(v_event.business_id) then
    raise exception 'Only the front desk, managers and owners can change events' using errcode = '42501';
  end if;
  if v_event.status in ('lost', 'completed') then
    raise exception 'This event is closed' using errcode = '55000';
  end if;
  if p_stage_id is not null then
    select * into v_stage from public.event_stages where id = p_stage_id and business_id = v_event.business_id and kind is null;
    if v_stage.id is null then
      raise exception 'Events move to built-in stages by themselves' using errcode = '22023', hint = 'built_in';
    end if;
  end if;
  if p_stage_id is not distinct from v_event.stage_id then
    return;
  end if;
  update public.events set stage_id = p_stage_id where id = p_event_id;
  insert into public.event_history (business_id, event_id, kind, detail, staff_id)
  values (v_event.business_id, p_event_id, 'stage_changed', v_stage.name, private.current_staff_id(v_event.business_id));
end;
$$;
revoke all on function public.set_event_stage(uuid, uuid) from public, anon;
grant execute on function public.set_event_stage(uuid, uuid) to authenticated;
