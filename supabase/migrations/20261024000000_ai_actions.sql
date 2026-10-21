-- The AI action log: every change Denise (the AI assistant) proposes, why,
-- who approved or rejected it, and whether it was undone.
--
-- A proposal is a set of changes to the calendar:
--   {"changes": [{"item_id", "appointment_id",
--                 "from": {"staff_id", "resource_id", "starts_at"},
--                 "to":   {"staff_id", "resource_id", "starts_at"}}],
--    "book": {"client_id": uuid | null,
--             "items": [{"service_id", "staff_id", "resource_id", "starts_at"}]} | null}
-- "changes" moves booked items; "book" makes a new appointment (the client
-- can be chosen when it's approved).
--
-- The booking rules (lib/scheduling/booking.ts) run in the app before a
-- proposal is applied or undone, as for any booking; these functions then
-- check nothing changed since (the calendar_version lock, and each item is
-- still where the proposal found it) and make the change in one
-- transaction. Applying records the exact previous state, and undo restores
-- it: times, stylists, chairs and prices. Only booked and confirmed visits
-- are ever moved: never a client who's checked in or out.
--
-- Rows are written only through the functions below.

create type public.ai_action_status as enum ('proposed', 'approved', 'rejected', 'undone');

create table public.ai_actions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null,
  -- Which AI feature proposed it: 'conflict_resolver', 'ask_denise'.
  feature         text not null check (feature ~ '^[a-z_]{1,40}$'),
  -- What it's about, e.g. 'overrun:<id>', so the same problem gets one set of
  -- options (ranked 1-3) and isn't proposed again once rejected. Null for
  -- one-off proposals.
  subject         text check (length(subject) <= 200),
  rank            smallint not null default 1 check (rank between 1 and 9),
  summary         text not null check (length(trim(summary)) > 0 and length(summary) <= 300),
  reason          text not null check (length(reason) <= 2000),
  proposal        jsonb not null check (jsonb_typeof(proposal) = 'object'),
  status          public.ai_action_status not null default 'proposed',
  -- Set when applied: what the changed items were before, for undo.
  previous_state  jsonb,
  proposed_by     uuid,
  decided_by      uuid,
  decided_at      timestamptz,
  undone_by       uuid,
  undone_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status = 'proposed') = (decided_at is null)),
  check ((status in ('approved', 'undone')) = (previous_state is not null)),
  check ((status = 'undone') = (undone_at is not null)),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (proposed_by, business_id) references public.staff (id, business_id) on delete set null (proposed_by),
  foreign key (decided_by, business_id) references public.staff (id, business_id) on delete set null (decided_by),
  foreign key (undone_by, business_id) references public.staff (id, business_id) on delete set null (undone_by)
);

-- One open set of options per subject.
create unique index ai_actions_open_subject_key on public.ai_actions (location_id, subject, rank)
  where status = 'proposed' and subject is not null;
create index ai_actions_location_created_idx on public.ai_actions (location_id, created_at desc);
create index ai_actions_business_id_idx on public.ai_actions (business_id);

create trigger ai_actions_set_updated_at before update on public.ai_actions
  for each row execute function public.set_updated_at();

alter table public.ai_actions enable row level security;

-- The front of house approves proposals; owners review the log.
create policy "Front of house can view AI actions"
  on public.ai_actions for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- Hooks for what else happens when an action is applied or undone (the
-- notifications it sends, the problems it solves). Replaced by later
-- migrations.
create function private.ai_action_applied(p_action public.ai_actions)
returns void language plpgsql security definer set search_path = '' as $$ begin end; $$;

create function private.ai_action_undone(p_action public.ai_actions)
returns void language plpgsql security definer set search_path = '' as $$ begin end; $$;

-- Checks the caller can approve at the location and takes the calendar lock.
create function private.lock_calendar(p_location_id uuid, p_expected_version bigint)
returns uuid
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
    raise exception 'Not allowed to change the calendar here' using errcode = '42501';
  end if;
  update public.locations set calendar_version = calendar_version + 1
  where id = p_location_id and calendar_version = p_expected_version;
  if not found then
    raise exception 'The calendar changed; check again' using errcode = '40001';
  end if;
  return v_business_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_ai_proposals: the current options for a subject, best first, as
-- [{"summary", "reason", "proposal"}]. Replaces the subject's open options
-- (keeping their ids by rank), or closes them when there are none. Returns
-- the ids in order; none if the subject was rejected before.
-- ---------------------------------------------------------------------------

create function public.record_ai_proposals(p_location_id uuid, p_feature text, p_subject text, p_options jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_staff_id uuid;
  v_option jsonb;
  v_rank int := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  if v_business_id is null
     or not private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to record proposals here' using errcode = '42501';
  end if;
  if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) > 9 then
    raise exception 'Options must be a list of up to 9' using errcode = '22023';
  end if;
  v_staff_id := private.current_staff_id(v_business_id);

  if p_subject is not null then
    if exists (select 1 from public.ai_actions where location_id = p_location_id and subject = p_subject and status = 'rejected') then
      return v_ids;
    end if;
    delete from public.ai_actions
    where location_id = p_location_id and subject = p_subject and status = 'proposed' and rank > jsonb_array_length(p_options);
  end if;

  for v_option in select * from jsonb_array_elements(p_options) loop
    v_rank := v_rank + 1;
    v_id := null;
    if p_subject is not null then
      update public.ai_actions set
        feature = p_feature,
        summary = v_option ->> 'summary',
        reason = coalesce(v_option ->> 'reason', ''),
        proposal = v_option -> 'proposal'
      where location_id = p_location_id and subject = p_subject and status = 'proposed' and rank = v_rank
      returning id into v_id;
    end if;
    if v_id is null then
      insert into public.ai_actions (business_id, location_id, feature, subject, rank, summary, reason, proposal, proposed_by)
      values (v_business_id, p_location_id, p_feature, p_subject, v_rank, v_option ->> 'summary',
              coalesce(v_option ->> 'reason', ''), v_option -> 'proposal', v_staff_id)
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_ai_action: approve an option and make its changes. The subject's
-- other options are closed (their summaries are kept on this one).
-- p_client_id picks the client for a new booking that doesn't have one.
-- ---------------------------------------------------------------------------

create function public.apply_ai_action(p_action_id uuid, p_expected_version bigint, p_client_id uuid default null)
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
      select coalesce(ss.price_cents, s.price_cents) into v_price
      from public.staff_services ss join public.services s on s.id = ss.service_id
      where ss.service_id = v_item.service_id and ss.staff_id = (v_change #>> '{to,staff_id}')::uuid;
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
      select coalesce(ss.price_cents, v_service.price_cents) into v_price
      from public.staff_services ss
      where ss.service_id = v_service.id and ss.staff_id = (v_line ->> 'staff_id')::uuid;
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

-- ---------------------------------------------------------------------------
-- undo_ai_action: put everything back exactly as it was. Refused if any of
-- it changed since (moved again, or the client checked in).
-- ---------------------------------------------------------------------------

create function public.undo_ai_action(p_action_id uuid, p_expected_version bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    delete from public.appointments where id = v_created;
  end if;

  update public.ai_actions set status = 'undone', undone_by = v_staff_id, undone_at = now()
  where id = v_action.id
  returning * into v_action;

  perform private.ai_action_undone(v_action);
end;
$$;

-- ---------------------------------------------------------------------------
-- reject_ai_action: dismiss a proposal, with the other options for the
-- same problem. It won't be proposed again.
-- ---------------------------------------------------------------------------

create function public.reject_ai_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null
     or not private.has_business_role(v_action.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_action.status <> 'proposed' then
    raise exception 'This proposal was already decided' using errcode = '55000';
  end if;
  update public.ai_actions set status = 'rejected', decided_by = private.current_staff_id(business_id), decided_at = now()
  where status = 'proposed'
    and (id = v_action.id or (v_action.subject is not null and location_id = v_action.location_id and subject = v_action.subject));
end;
$$;

revoke all on function private.lock_calendar(uuid, bigint) from public;
revoke all on function private.ai_action_applied(public.ai_actions) from public;
revoke all on function private.ai_action_undone(public.ai_actions) from public;
revoke all on function public.record_ai_proposals(uuid, text, text, jsonb) from public, anon;
revoke all on function public.apply_ai_action(uuid, bigint, uuid) from public, anon;
revoke all on function public.undo_ai_action(uuid, bigint) from public, anon;
revoke all on function public.reject_ai_action(uuid) from public, anon;
grant execute on function public.record_ai_proposals(uuid, text, text, jsonb) to authenticated;
grant execute on function public.apply_ai_action(uuid, bigint, uuid) to authenticated;
grant execute on function public.undo_ai_action(uuid, bigint) to authenticated;
grant execute on function public.reject_ai_action(uuid) to authenticated;
