-- Clocking in and out, for salons that turn it on
-- (businesses.time_clock): each stretch of work is a time_clock_entries row
-- (clocked in, clocked out, or still open: one open entry a person). A
-- break is clocking out and in again. People clock themselves in and out
-- on My day (source own) or on the shared front-desk iPad with their PIN
-- (front_desk, clock_at_desk, service role after check_staff_pin); whoever
-- manages the team (the `team` permission) adds, fixes or removes a punch
-- with a reason (manager), and every step is in time_clock_events with who
-- and why. Reminders for a missed clock-in or clock-out are app notices,
-- once per shift (time_clock_reminders, record_clock_reminder, from the
-- scheduled job /api/cron/clock). Nothing is written directly.
-- Readers: yourself, and those with `team` or `payroll` at the salon.

alter table public.businesses add column time_clock boolean not null default false;

create table public.time_clock_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  staff_id uuid not null references public.staff (id) on delete cascade,
  clock_in timestamptz not null,
  clock_out timestamptz,
  -- Where it was clocked in: their own login, the front-desk iPad, or added by a manager.
  source text not null default 'own' check (source in ('own', 'front_desk', 'manager')),
  -- Set by a manager's change or a punch they added.
  edited boolean not null default false,
  -- Left open over 18 hours and clocked in again after: the clock-out was
  -- missed, for a manager to fix (it no longer counts as clocked in).
  missed_out boolean not null default false,
  created_at timestamptz not null default now(),
  check (clock_out is null or clock_out > clock_in),
  check (clock_out is null or clock_out - clock_in <= interval '18 hours')
);
create unique index time_clock_one_open on public.time_clock_entries (staff_id) where clock_out is null and not missed_out;
create index time_clock_entries_staff_idx on public.time_clock_entries (staff_id, clock_in desc);
create index time_clock_entries_business_idx on public.time_clock_entries (business_id, clock_in desc);
alter table public.time_clock_entries enable row level security;

create policy "time clock: own, and the team's for managers and payroll" on public.time_clock_entries for select to authenticated
using (
  staff_id in (select id from public.staff where user_id = (select auth.uid()))
  or business_id in (select private.businesses_with('team'))
  or business_id in (select private.businesses_with('payroll'))
);

create table public.time_clock_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  entry_id uuid references public.time_clock_entries (id) on delete set null,
  staff_id uuid not null references public.staff (id) on delete cascade,
  kind text not null check (kind in ('clock_in', 'clock_out', 'added', 'changed', 'removed')),
  -- For a change: what it was.
  was_in timestamptz,
  was_out timestamptz,
  clock_in timestamptz,
  clock_out timestamptz,
  reason text,
  source text check (source in ('own', 'front_desk', 'manager')),
  by_staff_id uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now()
);
create index time_clock_events_business_idx on public.time_clock_events (business_id, created_at desc);
create index time_clock_events_staff_idx on public.time_clock_events (staff_id, created_at desc);
alter table public.time_clock_events enable row level security;

create policy "time clock events: own, and the team's for managers and payroll" on public.time_clock_events for select to authenticated
using (
  staff_id in (select id from public.staff where user_id = (select auth.uid()))
  or business_id in (select private.businesses_with('team'))
  or business_id in (select private.businesses_with('payroll'))
);

-- The signed-in person's active staff row at a salon.
create function private.clock_me(p_business_id uuid)
returns public.staff
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.staff s
  where s.business_id = p_business_id and s.user_id = (select auth.uid()) and s.is_active
  limit 1
$$;

-- Clocks someone in (when they're out) or out (when they're in), now.
-- p_want: 'in', 'out' or 'toggle'. Returns the entry and whether they're
-- now in.
create function private.punch(p_staff public.staff, p_want text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.time_clock_entries;
begin
  if not (select b.time_clock from public.businesses b where b.id = p_staff.business_id) then
    raise exception 'This salon doesn''t use the time clock' using errcode = '55000', hint = 'clock_off';
  end if;
  select * into v_entry from public.time_clock_entries where staff_id = p_staff.id and clock_out is null and not missed_out for update;
  -- A clock-in left open since an earlier shift: kept for a manager to fix,
  -- and they start afresh.
  if v_entry.id is not null and p_want <> 'out' and now() - v_entry.clock_in > interval '18 hours' then
    update public.time_clock_entries set missed_out = true where id = v_entry.id;
    v_entry := null;
  end if;
  if v_entry.id is null then
    if p_want = 'out' then
      raise exception 'You aren''t clocked in' using errcode = '55000', hint = 'not_in';
    end if;
    insert into public.time_clock_entries (business_id, location_id, staff_id, clock_in, source)
    values (p_staff.business_id, p_staff.location_id, p_staff.id, now(), p_source)
    returning * into v_entry;
    insert into public.time_clock_events (business_id, entry_id, staff_id, kind, clock_in, source, by_staff_id)
    values (p_staff.business_id, v_entry.id, p_staff.id, 'clock_in', now(), p_source, p_staff.id);
    return jsonb_build_object('entry_id', v_entry.id, 'clocked_in', true, 'at', now());
  end if;
  if p_want = 'in' then
    raise exception 'You''re already clocked in' using errcode = '55000', hint = 'already_in';
  end if;
  if now() - v_entry.clock_in > interval '18 hours' then
    raise exception 'That shift is too long to close: ask a manager to fix it' using errcode = '55000', hint = 'too_long';
  end if;
  update public.time_clock_entries set clock_out = now() where id = v_entry.id;
  insert into public.time_clock_events (business_id, entry_id, staff_id, kind, clock_out, source, by_staff_id)
  values (p_staff.business_id, v_entry.id, p_staff.id, 'clock_out', now(), p_source, p_staff.id);
  return jsonb_build_object('entry_id', v_entry.id, 'clocked_in', false, 'at', now(), 'since', v_entry.clock_in);
end;
$$;

-- Clock yourself in or out now.
create function public.clock_in(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.staff := private.clock_me(p_business_id);
begin
  if v_me.id is null then
    raise exception 'Not on the team here' using errcode = '42501';
  end if;
  return private.punch(v_me, 'in', 'own');
end;
$$;

create function public.clock_out(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.staff := private.clock_me(p_business_id);
begin
  if v_me.id is null then
    raise exception 'Not on the team here' using errcode = '42501';
  end if;
  return private.punch(v_me, 'out', 'own');
end;
$$;

-- On the shared front-desk iPad, once their PIN has been checked
-- (check_staff_pin): clocks them in, or out if they're in. Service role.
create function public.clock_at_desk(p_token_hash text, p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.shared_devices;
  v_staff public.staff;
begin
  select * into v_device from public.shared_devices where token_hash = p_token_hash and revoked_at is null;
  select * into v_staff from public.staff where id = p_staff_id;
  if v_device.id is null or v_staff.id is null or v_staff.business_id <> v_device.business_id or v_staff.location_id <> v_device.location_id or not v_staff.is_active then
    raise exception 'Not on the team here' using errcode = '42501';
  end if;
  return private.punch(v_staff, 'toggle', 'front_desk');
end;
$$;

-- Turns the time clock on or off for the salon (the `settings` permission).
create function public.set_time_clock(p_business_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers change this' using errcode = '42501';
  end if;
  update public.businesses set time_clock = p_on where id = p_business_id;
end;
$$;

-- Reminders sent: one per person, day, kind and shift, so the job (every
-- five minutes) never repeats one. Service role only.
create table public.time_clock_reminders (
  staff_id uuid not null references public.staff (id) on delete cascade,
  on_date date not null,
  kind text not null check (kind in ('in', 'out')),
  shift_start integer not null,
  created_at timestamptz not null default now(),
  primary key (staff_id, on_date, kind, shift_start)
);
alter table public.time_clock_reminders enable row level security;

-- Records a reminder and its app notice, unless it was already sent.
-- Returns whether it was new.
create function public.record_clock_reminder(p_staff_id uuid, p_on_date date, p_kind text, p_shift_start integer, p_body text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  insert into public.time_clock_reminders (staff_id, on_date, kind, shift_start) values (p_staff_id, p_on_date, p_kind, p_shift_start)
  on conflict do nothing;
  if not found then
    return false;
  end if;
  insert into public.notifications (business_id, location_id, staff_id, channel, template, body, status)
  values (v_staff.business_id, v_staff.location_id, p_staff_id, 'app', case p_kind when 'in' then 'clock_in_reminder' else 'clock_out_reminder' end, p_body, 'sent');
  return true;
end;
$$;

-- A manager adds, changes or removes a punch, always with a reason.
-- p_entry_id null adds one for p_staff_id; p_remove takes it out.
create function public.save_time_entry(
  p_business_id uuid, p_entry_id uuid, p_staff_id uuid, p_clock_in timestamptz, p_clock_out timestamptz, p_reason text, p_remove boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by uuid := private.current_staff_id(p_business_id);
  v_entry public.time_clock_entries;
  v_staff public.staff;
  v_id uuid;
begin
  if not private.can(p_business_id, 'team') then
    raise exception 'Only managers can change hours' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason' using errcode = '22023', hint = 'reason';
  end if;
  if p_entry_id is not null then
    select * into v_entry from public.time_clock_entries where id = p_entry_id and business_id = p_business_id for update;
    if v_entry.id is null then
      raise exception 'Not found' using errcode = 'P0002';
    end if;
    p_staff_id := v_entry.staff_id;
  end if;
  select * into v_staff from public.staff where id = p_staff_id and business_id = p_business_id;
  if v_staff.id is null then
    raise exception 'Not on the team here' using errcode = '42501';
  end if;
  -- Managers never change an owner's hours unless they're one.
  if v_staff.role = 'owner' and not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can change an owner''s hours' using errcode = '42501';
  end if;

  if p_remove then
    if v_entry.id is null then
      raise exception 'Not found' using errcode = 'P0002';
    end if;
    insert into public.time_clock_events (business_id, entry_id, staff_id, kind, was_in, was_out, reason, source, by_staff_id)
    values (p_business_id, null, v_entry.staff_id, 'removed', v_entry.clock_in, v_entry.clock_out, trim(p_reason), 'manager', v_by);
    delete from public.time_clock_entries where id = v_entry.id;
    return v_entry.id;
  end if;

  if p_clock_in is null or p_clock_in > now() or (p_clock_out is not null and (p_clock_out <= p_clock_in or p_clock_out > now() + interval '1 minute')) then
    raise exception 'Check the times' using errcode = '22023', hint = 'times';
  end if;
  if p_clock_out is not null and p_clock_out - p_clock_in > interval '18 hours' then
    raise exception 'A shift is 18 hours at most' using errcode = '22023', hint = 'times';
  end if;
  if exists (
    select 1 from public.time_clock_entries e
    where e.staff_id = p_staff_id and e.id is distinct from v_entry.id
      and tstzrange(e.clock_in, coalesce(e.clock_out, case when e.missed_out then e.clock_in + interval '1 minute' else 'infinity' end))
          && tstzrange(p_clock_in, coalesce(p_clock_out, 'infinity'))
  ) then
    raise exception 'That overlaps another punch' using errcode = '23P01', hint = 'overlap';
  end if;

  if v_entry.id is null then
    insert into public.time_clock_entries (business_id, location_id, staff_id, clock_in, clock_out, source, edited)
    values (p_business_id, v_staff.location_id, p_staff_id, p_clock_in, p_clock_out, 'manager', true)
    returning id into v_id;
    insert into public.time_clock_events (business_id, entry_id, staff_id, kind, clock_in, clock_out, reason, source, by_staff_id)
    values (p_business_id, v_id, p_staff_id, 'added', p_clock_in, p_clock_out, trim(p_reason), 'manager', v_by);
    return v_id;
  end if;
  update public.time_clock_entries set clock_in = p_clock_in, clock_out = p_clock_out, edited = true, missed_out = v_entry.missed_out and p_clock_out is null where id = v_entry.id;
  insert into public.time_clock_events (business_id, entry_id, staff_id, kind, was_in, was_out, clock_in, clock_out, reason, source, by_staff_id)
  values (p_business_id, v_entry.id, v_entry.staff_id, 'changed', v_entry.clock_in, v_entry.clock_out, p_clock_in, p_clock_out, trim(p_reason), 'manager', v_by);
  return v_entry.id;
end;
$$;

revoke all on function private.clock_me(uuid) from public, anon, authenticated;
revoke all on function private.punch(public.staff, text, text) from public, anon, authenticated;
revoke all on function public.clock_in(uuid) from public, anon;
revoke all on function public.clock_out(uuid) from public, anon;
revoke all on function public.save_time_entry(uuid, uuid, uuid, timestamptz, timestamptz, text, boolean) from public, anon;
revoke all on function public.set_time_clock(uuid, boolean) from public, anon;
revoke all on function public.clock_at_desk(text, uuid) from public, anon, authenticated;
revoke all on function public.record_clock_reminder(uuid, date, text, integer, text) from public, anon, authenticated;
grant execute on function public.clock_in(uuid) to authenticated;
grant execute on function public.clock_out(uuid) to authenticated;
grant execute on function public.save_time_entry(uuid, uuid, uuid, timestamptz, timestamptz, text, boolean) to authenticated;
grant execute on function public.set_time_clock(uuid, boolean) to authenticated;
grant execute on function public.clock_at_desk(text, uuid) to service_role;
grant execute on function public.record_clock_reminder(uuid, date, text, integer, text) to service_role;

-- Reminders for clocking in and out, every five minutes.
select cron.schedule('maestra-clock', '*/5 * * * *', $$select private.run_scheduled_job('/api/cron/clock')$$);
