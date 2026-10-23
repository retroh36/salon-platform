-- Calendar and Denise: undoing a check-in (logged in appointment_events),
-- each person's calendar zoom, and items dismissed from Denise's brief and
-- panel (they stay gone).

-- ---------------------------------------------------------------------------
-- appointment_events: changes to a visit worth keeping a record of, with
-- who made them. For now, check-ins taken back.
-- ---------------------------------------------------------------------------

create table public.appointment_events (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  appointment_id  uuid not null references public.appointments (id) on delete cascade,
  kind            text not null check (kind in ('check_in_undone')),
  -- What it was before (e.g. when they'd checked in, the times cleared).
  detail          jsonb not null default '{}',
  staff_id        uuid,
  created_at      timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete set null (staff_id)
);

create index appointment_events_appointment_idx on public.appointment_events (appointment_id, created_at);

alter table public.appointment_events enable row level security;

-- The front of house reads them; nobody writes them directly.
create policy "Front of house can view appointment events" on public.appointment_events for select to authenticated
  using (private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]));

-- ---------------------------------------------------------------------------
-- undo_check_in: a client checked in by mistake goes back to booked. Any
-- times tapped in since check-in (started, processing, finished) are
-- cleared. Not once they've checked out: that's voiding the sale.
-- ---------------------------------------------------------------------------

create function public.undo_check_in(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_me uuid;
  v_times jsonb;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if v_appointment.id is null
     or not private.has_business_role(v_appointment.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to change this appointment' using errcode = '42501';
  end if;
  if v_appointment.status <> 'checked_in' then
    raise exception 'Only a checked-in visit can be taken back to booked' using errcode = '55000';
  end if;
  v_me := private.current_staff_id(v_appointment.business_id);

  -- What's cleared, for the record.
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', i.id, 'started_at', i.started_at, 'processing_started_at', i.processing_started_at,
      'processing_ended_at', i.processing_ended_at, 'finished_at', i.finished_at)), '[]')
    into v_times
  from public.appointment_items i
  where i.appointment_id = p_appointment_id and i.started_at is not null;

  update public.appointment_items set
    started_at = null, processing_started_at = null, processing_ended_at = null, finished_at = null
  where appointment_id = p_appointment_id;

  update public.appointments set
    status = 'booked', checked_in_at = null, updated_by = v_me
  where id = p_appointment_id;

  insert into public.appointment_events (business_id, appointment_id, kind, detail, staff_id)
  values (v_appointment.business_id, p_appointment_id, 'check_in_undone',
          jsonb_build_object('checked_in_at', v_appointment.checked_in_at, 'times', v_times), v_me);
end;
$$;

revoke all on function public.undo_check_in(uuid) from public, anon;
grant execute on function public.undo_check_in(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Each person's calendar zoom (Compact, Comfortable, Detailed).
-- ---------------------------------------------------------------------------

alter table public.staff
  add column calendar_zoom text not null default 'comfortable' check (calendar_zoom in ('compact', 'comfortable', 'detailed'));

create function public.set_calendar_zoom(p_zoom text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.staff set calendar_zoom = p_zoom where user_id = auth.uid();
$$;

revoke all on function public.set_calendar_zoom(text) from public, anon;
grant execute on function public.set_calendar_zoom(text) to authenticated;

-- ---------------------------------------------------------------------------
-- denise_dismissals: an item in Denise's brief or panel someone dismissed
-- for the day ("noshow:<appointment>", "late:<appointment>", ...). Once
-- dismissed it stays gone for everyone at the location.
-- ---------------------------------------------------------------------------

create table public.denise_dismissals (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  location_id   uuid not null,
  day           date not null,
  item_key      text not null check (length(item_key) between 1 and 200),
  dismissed_by  uuid,
  created_at    timestamptz not null default now(),
  unique (location_id, day, item_key),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (dismissed_by, business_id) references public.staff (id, business_id) on delete set null (dismissed_by)
);

alter table public.denise_dismissals enable row level security;

create policy "Front of house can view Denise dismissals" on public.denise_dismissals for select to authenticated
  using (private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]));

create function public.dismiss_denise_item(p_location_id uuid, p_day date, p_key text)
returns void
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
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.denise_dismissals (business_id, location_id, day, item_key, dismissed_by)
  values (v_business_id, p_location_id, p_day, p_key, private.current_staff_id(v_business_id))
  on conflict (location_id, day, item_key) do nothing;
end;
$$;

revoke all on function public.dismiss_denise_item(uuid, date, text) from public, anon;
grant execute on function public.dismiss_denise_item(uuid, date, text) to authenticated;
