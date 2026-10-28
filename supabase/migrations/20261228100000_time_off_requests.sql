-- Time-off requests: staff ask from their account, owners and managers
-- approve or decline (with a reason) from a Requests inbox, the salon sets
-- how far ahead requests are due and blackout dates (requests still go
-- through, flagged), everyone is told in the app, and every step is logged.

alter table public.businesses
  add column time_off_notice_days smallint not null default 14 check (time_off_notice_days between 0 and 365);

-- Requests made inside these dates are flagged (not refused).
create table public.time_off_blackouts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  starts_on   date not null,
  ends_on     date not null,
  label       text check (label is null or length(trim(label)) between 1 and 80),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  check (starts_on <= ends_on),
  check (ends_on - starts_on <= 366)
);

create index time_off_blackouts_business_idx on public.time_off_blackouts (business_id, starts_on);

alter table public.time_off_blackouts enable row level security;

create policy "Members can view blackout dates"
  on public.time_off_blackouts for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Settings can manage blackout dates"
  on public.time_off_blackouts for all to authenticated
  using ((select private.can(business_id, 'settings')))
  with check ((select private.can(business_id, 'settings')));

-- What was true when it was asked for, and why it was declined.
alter table public.staff_time_off
  add column short_notice boolean not null default false,
  add column in_blackout boolean not null default false,
  add column decline_reason text check (decline_reason is null or length(decline_reason) <= 300);

-- ---------------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------------

-- Every request, decision, withdrawal and removal, kept after the time off
-- itself is gone.
create table public.time_off_events (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  time_off_id  uuid not null,
  staff_id     uuid not null,
  kind         text not null check (kind in ('requested', 'added', 'approved', 'declined', 'withdrawn', 'removed', 'changed')),
  starts_on    date not null,
  ends_on      date not null,
  by_staff_id  uuid,
  reason       text,
  created_at   timestamptz not null default now()
);

create index time_off_events_time_off_idx on public.time_off_events (time_off_id, created_at);
create index time_off_events_business_idx on public.time_off_events (business_id, created_at);

alter table public.time_off_events enable row level security;

create policy "Managers see the time off log, staff their own"
  on public.time_off_events for select to authenticated
  using (
    (select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]))
    or (select private.is_current_staff(business_id, staff_id))
  );
-- Written only by the trigger below.

create function private.log_time_off()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_time_off := coalesce(new, old);
  v_by uuid := private.current_staff_id(v_row.business_id);
  v_kind text;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_kind := case when new.status = 'requested' then 'requested' else 'added' end;
    v_reason := new.note;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      v_kind := new.status::text;
      v_reason := new.decline_reason;
    elsif (new.starts_on, new.ends_on, new.start_minute, new.end_minute, new.reason) is distinct from (old.starts_on, old.ends_on, old.start_minute, old.end_minute, old.reason) then
      v_kind := 'changed';
    else
      return new;
    end if;
  else
    v_kind := case when old.status = 'requested' and v_by = old.staff_id then 'withdrawn' else 'removed' end;
  end if;
  insert into public.time_off_events (business_id, time_off_id, staff_id, kind, starts_on, ends_on, by_staff_id, reason)
  values (v_row.business_id, v_row.id, v_row.staff_id, v_kind, v_row.starts_on, v_row.ends_on, v_by, v_reason);
  return coalesce(new, old);
end;
$$;

create trigger staff_time_off_log after insert or update or delete on public.staff_time_off
  for each row execute function private.log_time_off();

-- ---------------------------------------------------------------------------
-- Requesting and deciding
-- ---------------------------------------------------------------------------

-- "Tue, Nov 3", "Tue, Nov 3 – Fri, Nov 6", "Tue, Nov 3, 2pm–6pm".
create function private.say_time_off(p_starts date, p_ends date, p_start integer, p_end integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_starts, 'Dy, Mon FMDD')
    || case
      when p_starts <> p_ends then ' – ' || to_char(p_ends, 'Dy, Mon FMDD')
      when p_start is not null then ', ' || private.say_minute(p_start) || '–' || private.say_minute(p_end)
      else ''
    end;
$$;

-- Staff ask for time off for themselves. It's flagged when it's inside the
-- salon's notice period or overlaps a blackout, and owners and managers at
-- their location are told.
create function public.request_time_off(
  p_starts_on date,
  p_ends_on date,
  p_reason public.time_off_reason,
  p_start_minute integer default null,
  p_end_minute integer default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.staff;
  v_tz text;
  v_today date;
  v_notice integer;
  v_short boolean;
  v_blackout boolean;
  v_id uuid;
  v_when text;
begin
  select * into v_me from public.staff where user_id = (select auth.uid()) and is_active limit 1;
  if v_me.id is null then
    raise exception 'Sign in to ask for time off.' using errcode = '42501';
  end if;
  select l.timezone into v_tz from public.locations l where l.id = v_me.location_id;
  v_today := (now() at time zone v_tz)::date;
  if p_starts_on < v_today then
    raise exception 'Time off can''t start in the past.' using errcode = '22023';
  end if;
  select time_off_notice_days into v_notice from public.businesses where id = v_me.business_id;
  v_short := p_starts_on < v_today + v_notice;
  v_blackout := exists (
    select 1 from public.time_off_blackouts b
    where b.business_id = v_me.business_id and b.starts_on <= p_ends_on and p_starts_on <= b.ends_on
  );

  insert into public.staff_time_off (business_id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status, requested_by, short_notice, in_blackout)
  values (v_me.business_id, v_me.id, p_starts_on, p_ends_on, p_start_minute, p_end_minute, p_reason, nullif(trim(p_note), ''), 'requested', v_me.id, v_short, v_blackout)
  returning id into v_id;

  v_when := private.say_time_off(p_starts_on, p_ends_on, p_start_minute, p_end_minute);
  insert into public.notifications (business_id, location_id, staff_id, channel, status, template, body)
  select v_me.business_id, v_me.location_id, s.id, 'app', 'sent', 'time_off_requested',
         v_me.first_name || ' asked for time off: ' || initcap(p_reason::text) || ', ' || v_when || '.'
           || case when v_blackout then ' It''s during blackout dates.' when v_short then ' It''s short notice.' else '' end
           || ' Review it in Scheduling, Requests.'
  from public.staff s
  where s.business_id = v_me.business_id and s.location_id = v_me.location_id and s.is_active
    and s.role in ('owner', 'manager') and s.id <> v_me.id;
  return v_id;
end;
$$;

-- Owners and managers approve or decline a request (a decline needs a
-- reason). The person is told; approved time off changes the calendar.
create function public.decide_time_off(p_time_off_id uuid, p_decision public.time_off_status, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_time_off;
  v_staff public.staff;
  v_me uuid;
  v_when text;
begin
  select * into v_row from public.staff_time_off where id = p_time_off_id for update;
  if v_row.id is null or not private.has_business_role(v_row.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can decide time off.' using errcode = '42501';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'That request has already been decided.' using errcode = '22023';
  end if;
  if p_decision not in ('approved', 'declined') then
    raise exception 'Approve or decline it.' using errcode = '22023';
  end if;
  if p_decision = 'declined' and coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why it''s declined.' using errcode = '22023';
  end if;
  v_me := private.current_staff_id(v_row.business_id);
  update public.staff_time_off
  set status = p_decision, decided_by = v_me, decided_at = now(),
      decline_reason = case when p_decision = 'declined' then trim(p_reason) end
  where id = p_time_off_id;

  select * into v_staff from public.staff where id = v_row.staff_id;
  v_when := private.say_time_off(v_row.starts_on, v_row.ends_on, v_row.start_minute, v_row.end_minute);
  insert into public.notifications (business_id, location_id, staff_id, channel, status, template, body)
  values (v_row.business_id, v_staff.location_id, v_row.staff_id, 'app', 'sent', 'time_off_decided',
          case when p_decision = 'approved' then 'Your time off for ' || v_when || ' was approved.'
               else 'Your time off for ' || v_when || ' was declined: ' || trim(p_reason) end);
  if p_decision = 'approved' then
    update public.locations set calendar_version = calendar_version + 1 where id = v_staff.location_id;
  end if;
end;
$$;

revoke all on function private.log_time_off() from public;
revoke all on function private.say_time_off(date, date, integer, integer) from public;
grant execute on function public.request_time_off(date, date, public.time_off_reason, integer, integer, text) to authenticated;
grant execute on function public.decide_time_off(uuid, public.time_off_status, text) to authenticated;
revoke execute on function public.request_time_off(date, date, public.time_off_reason, integer, integer, text) from anon;
revoke execute on function public.decide_time_off(uuid, public.time_off_status, text) from anon;

-- Marking someone out on a day their approved time off already covers uses
-- that time off rather than adding more.
create or replace function public.report_call_out(p_staff_id uuid, p_from timestamptz, p_until timestamptz default null)
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
  v_until_local timestamp;
  v_end_minute int := 1440;
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
  if p_until is not null then
    v_until_local := p_until at time zone v_tz;
    if v_until_local::date <> v_local::date or p_until <= p_from then
      raise exception 'Out until a later time the same day' using errcode = '22023';
    end if;
    v_end_minute := ceil((extract(hour from v_until_local) * 60 + extract(minute from v_until_local)) / 5.0)::int * 5;
  end if;

  select id into v_id from public.schedule_disruptions
  where kind = 'call_out' and staff_id = p_staff_id and on_date = v_local::date;
  if v_id is not null then
    return v_id;
  end if;

  -- Approved time off that already covers it (a request approved before
  -- planning its clients) is used as it is.
  select t.id into v_time_off_id
  from public.staff_time_off t
  where t.staff_id = p_staff_id and t.status = 'approved'
    and t.starts_on <= v_local::date and t.ends_on >= v_local::date
    and coalesce(t.start_minute, 0) <= v_minute and coalesce(t.end_minute, 1440) >= v_end_minute
  order by t.created_at
  limit 1;
  if v_time_off_id is null then
    insert into public.staff_time_off (
      business_id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status, requested_by, decided_by, decided_at
    ) values (
      v_staff.business_id, p_staff_id, v_local::date, v_local::date, v_minute, v_end_minute, 'other',
      case when p_until is not null then 'Coming in late' else 'Out for the rest of the day' end,
      'approved', v_me, v_me, now()
    ) returning id into v_time_off_id;
  end if;

  insert into public.schedule_disruptions (business_id, location_id, kind, on_date, staff_id, starts_at, ends_at, time_off_id, reported_by)
  values (v_staff.business_id, v_staff.location_id, 'call_out', v_local::date, p_staff_id, p_from, p_until, v_time_off_id, v_me)
  returning id into v_id;

  update public.locations set calendar_version = calendar_version + 1 where id = v_staff.location_id;
  return v_id;
end;
$$;
