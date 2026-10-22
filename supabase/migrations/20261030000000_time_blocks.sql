-- Blocked time: lunch, breaks, training, meetings and personal time on a
-- stylist's calendar.
--
-- A block is local wall-clock time (minutes since midnight), like working
-- hours, so 12:00 stays 12:00 across daylight saving. It's either one-off
-- (on_date) or repeating on some weekdays from starts_on, optionally until
-- ends_on. Moving or removing one day of a repeating block skips that day
-- (time_block_skips) and, for a move, adds a one-off block in its place.
--
-- The booking rules (lib/scheduling/booking.ts) treat a block like another
-- client: the stylist's busy time can't overlap it (processing time can,
-- so color can process over lunch).

create type public.time_block_kind as enum ('lunch', 'break', 'training', 'meeting', 'personal');

create table public.time_blocks (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  location_id      uuid not null,
  staff_id         uuid not null,
  kind             public.time_block_kind not null,
  note             text check (length(note) <= 300),
  start_minute     smallint not null check (start_minute between 0 and 1435 and start_minute % 5 = 0),
  end_minute       smallint not null check (end_minute between 5 and 1440 and end_minute % 5 = 0),
  -- One-off.
  on_date          date,
  -- Repeating: ISO weekdays (1 = Monday), from starts_on until ends_on.
  repeat_weekdays  smallint[] check (repeat_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[] and cardinality(repeat_weekdays) > 0),
  starts_on        date,
  ends_on          date,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (start_minute < end_minute),
  check ((on_date is null) = (repeat_weekdays is not null)),
  check ((repeat_weekdays is null) = (starts_on is null)),
  check (ends_on is null or (starts_on is not null and ends_on >= starts_on)),
  unique (id, business_id),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index time_blocks_staff_idx on public.time_blocks (staff_id);
create index time_blocks_location_date_idx on public.time_blocks (location_id, on_date);
create index time_blocks_business_id_idx on public.time_blocks (business_id);

create table public.time_block_skips (
  block_id     uuid not null,
  business_id  uuid not null,
  on_date      date not null,
  primary key (block_id, on_date),
  foreign key (block_id, business_id) references public.time_blocks (id, business_id) on delete cascade
);

create index time_block_skips_business_id_idx on public.time_block_skips (business_id);

create trigger time_blocks_set_updated_at before update on public.time_blocks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: everyone sees blocks; the front of house manages
-- anyone's, stylists their own.
-- ---------------------------------------------------------------------------

alter table public.time_blocks enable row level security;
alter table public.time_block_skips enable row level security;

create function private.can_manage_blocks(p_business_id uuid, p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_business_role(p_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])
      or private.is_current_staff(p_business_id, p_staff_id);
$$;

revoke all on function private.can_manage_blocks(uuid, uuid) from public;
grant execute on function private.can_manage_blocks(uuid, uuid) to authenticated;

create policy "Members can view blocks"
  on public.time_blocks for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Staff can manage blocks"
  on public.time_blocks for all to authenticated
  using ((select private.can_manage_blocks(business_id, staff_id)))
  with check ((select private.can_manage_blocks(business_id, staff_id)));

create policy "Members can view skipped days"
  on public.time_block_skips for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Staff can skip days"
  on public.time_block_skips for all to authenticated
  using (exists (select 1 from public.time_blocks b where b.id = block_id and private.can_manage_blocks(b.business_id, b.staff_id)))
  with check (exists (select 1 from public.time_blocks b where b.id = block_id and private.can_manage_blocks(b.business_id, b.staff_id)));

-- ---------------------------------------------------------------------------
-- move_time_block: move (or resize) one day's occurrence. A one-off block
-- is updated; a repeating one skips that day and gets a one-off copy.
-- Returns the one-off block's id. Checking it fits is the app's job, as for
-- bookings (lib/scheduling/blocks.ts).
-- ---------------------------------------------------------------------------

create function public.move_time_block(p_block_id uuid, p_on_date date, p_start integer, p_end integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block public.time_blocks;
  v_id uuid;
begin
  select * into v_block from public.time_blocks where id = p_block_id for update;
  if v_block.id is null or not private.can_manage_blocks(v_block.business_id, v_block.staff_id) then
    raise exception 'Not allowed to change this block' using errcode = '42501';
  end if;
  if v_block.on_date is not null then
    update public.time_blocks set start_minute = p_start, end_minute = p_end where id = p_block_id;
    return p_block_id;
  end if;
  insert into public.time_block_skips (block_id, business_id, on_date) values (p_block_id, v_block.business_id, p_on_date)
  on conflict do nothing;
  insert into public.time_blocks (business_id, location_id, staff_id, kind, note, start_minute, end_minute, on_date, created_by)
  values (v_block.business_id, v_block.location_id, v_block.staff_id, v_block.kind, v_block.note, p_start, p_end, p_on_date,
          private.current_staff_id(v_block.business_id))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.move_time_block(uuid, date, integer, integer) from public, anon;
grant execute on function public.move_time_block(uuid, date, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Denise can propose moving a lunch or break (never training, meetings or
-- personal time) as part of a fix. A proposal can carry
--   "block_moves": [{"block_id", "on_date", "from": {"start", "end"}, "to": {"start", "end"}}]
-- Applying moves each occurrence (checking it's still where it was);
-- undo puts it back.
-- ---------------------------------------------------------------------------

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
  insert into public.notifications (business_id, location_id, ai_action_id, appointment_id, client_id, staff_id, template, body)
  select p_action.business_id, p_action.location_id, p_action.id, (n ->> 'appointment_id')::uuid,
         (n ->> 'client_id')::uuid, (n ->> 'staff_id')::uuid, n ->> 'template', n ->> 'body'
  from jsonb_array_elements(coalesce(p_action.proposal -> 'notifications', '[]')) n;

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

  insert into public.notifications (business_id, location_id, ai_action_id, appointment_id, client_id, staff_id, template, body)
  select p_action.business_id, p_action.location_id, p_action.id, (u ->> 'appointment_id')::uuid,
         (u ->> 'client_id')::uuid, (u ->> 'staff_id')::uuid, u ->> 'template', u ->> 'body'
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
