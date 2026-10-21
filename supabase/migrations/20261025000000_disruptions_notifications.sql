-- Things that upset the day's plan, and the notifications sent when Denise's
-- fixes are applied.
--
-- schedule_disruptions records what staff report:
--   overrun      a visit in progress will run `minutes` over (its stylist is
--                behind), from the appointment panel's "Running late"
--   client_late  a client who hasn't arrived will be `minutes` late
--   call_out     a stylist is out from `starts_at` for the rest of the day;
--                this also adds approved time off, so the booking rules stop
--                offering them
-- The conflict resolver (lib/scheduling/resolve.ts) reads these with the
-- calendar to find clashes and propose fixes. A late client's fix moves
-- their visit, which resolves the report; overruns and call-outs stay in
-- force for the day.
--
-- notifications records each message to a client or stylist. Nothing is
-- sent yet (texts and email come in a later phase): rows stay 'pending'.
-- Client messages use fixed templates (lib/notifications.ts), never AI text.

create type public.disruption_kind as enum ('overrun', 'client_late', 'call_out');

create table public.schedule_disruptions (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  location_id          uuid not null,
  kind                 public.disruption_kind not null,
  -- The local date it's about, for loading a day's reports.
  on_date              date not null,
  appointment_id       uuid,
  item_id              uuid references public.appointment_items (id) on delete cascade,
  staff_id             uuid,
  minutes              smallint check (minutes between 5 and 240 and minutes % 5 = 0),
  starts_at            timestamptz,
  time_off_id          uuid references public.staff_time_off (id) on delete set null,
  -- The applied fix that dealt with it (a late client's visit was moved).
  resolved_by_action   uuid references public.ai_actions (id) on delete set null,
  reported_by          uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (
    case kind
      when 'overrun' then item_id is not null and appointment_id is not null and minutes is not null
      when 'client_late' then appointment_id is not null and minutes is not null
      when 'call_out' then staff_id is not null and starts_at is not null
    end
  ),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (appointment_id, business_id, location_id)
    references public.appointments (id, business_id, location_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (reported_by, business_id) references public.staff (id, business_id) on delete set null (reported_by)
);

create index schedule_disruptions_location_date_idx on public.schedule_disruptions (location_id, on_date);
create index schedule_disruptions_business_id_idx on public.schedule_disruptions (business_id);
create index schedule_disruptions_appointment_id_idx on public.schedule_disruptions (appointment_id) where appointment_id is not null;
-- One report of each kind per visit (or stylist and day): a new estimate
-- replaces the old one.
create unique index schedule_disruptions_overrun_key on public.schedule_disruptions (item_id) where kind = 'overrun';
create unique index schedule_disruptions_client_late_key on public.schedule_disruptions (appointment_id)
  where kind = 'client_late' and resolved_by_action is null;
create unique index schedule_disruptions_call_out_key on public.schedule_disruptions (staff_id, on_date) where kind = 'call_out';

create trigger schedule_disruptions_set_updated_at before update on public.schedule_disruptions
  for each row execute function public.set_updated_at();

create type public.notification_status as enum ('pending', 'sent', 'canceled');

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null,
  ai_action_id    uuid references public.ai_actions (id) on delete set null,
  appointment_id  uuid,
  -- Exactly one recipient.
  client_id       uuid,
  staff_id        uuid,
  channel         text not null default 'sms' check (channel in ('sms', 'email')),
  template        text not null check (template ~ '^[a-z_]{1,40}$'),
  body            text not null check (length(trim(body)) > 0 and length(body) <= 1000),
  status          public.notification_status not null default 'pending',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((client_id is null) <> (staff_id is null)),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (appointment_id, business_id, location_id)
    references public.appointments (id, business_id, location_id) on delete set null (appointment_id),
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);

create index notifications_ai_action_id_idx on public.notifications (ai_action_id) where ai_action_id is not null;
create index notifications_location_created_idx on public.notifications (location_id, created_at desc);
create index notifications_business_id_idx on public.notifications (business_id);
create index notifications_client_id_idx on public.notifications (client_id) where client_id is not null;
create index notifications_staff_id_idx on public.notifications (staff_id) where staff_id is not null;

create trigger notifications_set_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: everyone works from the calendar, so members see the
-- day's disruptions; the front of house sees notifications. Both are written
-- only through the functions below.
-- ---------------------------------------------------------------------------

alter table public.schedule_disruptions enable row level security;
alter table public.notifications enable row level security;

create policy "Members can view disruptions"
  on public.schedule_disruptions for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Front of house can view notifications"
  on public.notifications for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- ---------------------------------------------------------------------------
-- report_running_late: for a client who's checked in, the visit is running
-- over (an overrun on p_item_id, the service in progress); for one who
-- hasn't arrived, the client is late. The front of house can report any
-- visit, stylists their own. A new estimate replaces the last one.
-- ---------------------------------------------------------------------------

create function public.report_running_late(p_item_id uuid, p_minutes integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.appointment_items;
  v_appointment public.appointments;
  v_staff_id uuid;
  v_kind public.disruption_kind;
  v_date date;
  v_id uuid;
begin
  select * into v_item from public.appointment_items where id = p_item_id;
  select * into v_appointment from public.appointments where id = v_item.appointment_id;
  v_staff_id := private.current_staff_id(v_appointment.business_id);
  if v_appointment.id is null or v_staff_id is null or not (
    private.has_business_role(v_appointment.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])
    or exists (select 1 from public.appointment_items i where i.appointment_id = v_appointment.id and i.staff_id = v_staff_id)
  ) then
    raise exception 'Not allowed to report on this appointment' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 240 or p_minutes % 5 <> 0 then
    raise exception 'Choose 5 to 240 minutes' using errcode = '22023';
  end if;

  v_kind := case v_appointment.status
    when 'checked_in' then 'overrun'
    when 'booked' then 'client_late'
    when 'confirmed' then 'client_late'
  end::public.disruption_kind;
  if v_kind is null then
    raise exception 'This visit is over' using errcode = '55000';
  end if;
  select (v_appointment.starts_at at time zone l.timezone)::date into v_date from public.locations l where l.id = v_appointment.location_id;

  if v_kind = 'overrun' then
    update public.schedule_disruptions set minutes = p_minutes, reported_by = v_staff_id
    where kind = 'overrun' and item_id = v_item.id
    returning id into v_id;
  else
    update public.schedule_disruptions set minutes = p_minutes, reported_by = v_staff_id
    where kind = 'client_late' and appointment_id = v_appointment.id and resolved_by_action is null
    returning id into v_id;
  end if;
  if v_id is null then
    insert into public.schedule_disruptions (business_id, location_id, kind, on_date, appointment_id, item_id, staff_id, minutes, reported_by)
    values (v_appointment.business_id, v_appointment.location_id, v_kind, v_date, v_appointment.id,
            case when v_kind = 'overrun' then v_item.id end, v_item.staff_id, p_minutes, v_staff_id)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- report_call_out: p_staff_id is out from p_from (rounded down to 5
-- minutes) to the end of that day. Adds approved time off, so no one can
-- book them, and bumps the calendar version so saves in flight re-check.
-- The front of house can report anyone, stylists themselves.
-- ---------------------------------------------------------------------------

create function public.report_call_out(p_staff_id uuid, p_from timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
  v_me uuid;
  v_tz text;
  v_local timestamp;
  v_minute int;
  v_time_off_id uuid;
  v_id uuid;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  v_me := private.current_staff_id(v_staff.business_id);
  if v_staff.id is null or v_staff.location_id is null or v_me is null or not (
    private.has_business_role(v_staff.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])
    or v_me = p_staff_id
  ) then
    raise exception 'Not allowed to report this' using errcode = '42501';
  end if;
  select l.timezone into v_tz from public.locations l where l.id = v_staff.location_id;
  v_local := p_from at time zone v_tz;
  v_minute := (extract(hour from v_local) * 60 + extract(minute from v_local))::int / 5 * 5;

  select id into v_id from public.schedule_disruptions
  where kind = 'call_out' and staff_id = p_staff_id and on_date = v_local::date;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.staff_time_off (
    business_id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status, requested_by, decided_by, decided_at
  ) values (
    v_staff.business_id, p_staff_id, v_local::date, v_local::date, v_minute, 1440, 'other', 'Out for the rest of the day',
    'approved', v_me, v_me, now()
  ) returning id into v_time_off_id;

  insert into public.schedule_disruptions (business_id, location_id, kind, on_date, staff_id, starts_at, time_off_id, reported_by)
  values (v_staff.business_id, v_staff.location_id, 'call_out', v_local::date, p_staff_id, p_from, v_time_off_id, v_me)
  returning id into v_id;

  update public.locations set calendar_version = calendar_version + 1 where id = v_staff.location_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- What applying and undoing an action also does. A proposal can carry
--   "notifications":      [{"client_id" | "staff_id", "appointment_id",
--                           "template", "body"}]  sent when it's applied
--   "undo_notifications": the same, sent on undo to anyone already told
--   "resolves":           [disruption id]  reports it deals with
-- On undo, notices not sent yet are canceled instead.
-- ---------------------------------------------------------------------------

create or replace function private.ai_action_applied(p_action public.ai_actions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (business_id, location_id, ai_action_id, appointment_id, client_id, staff_id, template, body)
  select p_action.business_id, p_action.location_id, p_action.id, (n ->> 'appointment_id')::uuid,
         (n ->> 'client_id')::uuid, (n ->> 'staff_id')::uuid, n ->> 'template', n ->> 'body'
  from jsonb_array_elements(coalesce(p_action.proposal -> 'notifications', '[]')) n;

  update public.schedule_disruptions set resolved_by_action = p_action.id
  where location_id = p_action.location_id
    and id in (select (r #>> '{}')::uuid from jsonb_array_elements(coalesce(p_action.proposal -> 'resolves', '[]')) r);
end;
$$;

create or replace function private.ai_action_undone(p_action public.ai_actions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
end;
$$;

revoke all on function public.report_running_late(uuid, integer) from public, anon;
revoke all on function public.report_call_out(uuid, timestamptz) from public, anon;
grant execute on function public.report_running_late(uuid, integer) to authenticated;
grant execute on function public.report_call_out(uuid, timestamptz) to authenticated;
