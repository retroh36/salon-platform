-- Shift swaps, for the front desk and assistants (whose days have no
-- clients of their own): someone offers a coworker in the same role one of
-- their published days, optionally taking one of the coworker's days back.
-- The coworker accepts, then an owner or manager approves, and only then
-- do the hours change. Nobody ends up working two overlapping shifts or
-- working through approved time off; every step is logged.

create type public.shift_swap_status as enum ('asked', 'accepted', 'approved', 'declined', 'canceled');

create table public.shift_swaps (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null,
  from_staff_id   uuid not null,
  to_staff_id     uuid not null,
  -- The day the asker gives away, and their shifts then (as asked).
  give_date       date not null,
  give_shifts     jsonb not null,
  -- The coworker's day the asker takes in return, if it's a swap.
  take_date       date,
  take_shifts     jsonb,
  note            text check (note is null or length(note) <= 300),
  status          public.shift_swap_status not null default 'asked',
  answered_at     timestamptz,
  decided_by      uuid,
  decided_at      timestamptz,
  decline_reason  text check (decline_reason is null or length(decline_reason) <= 300),
  created_at      timestamptz not null default now(),
  check (from_staff_id <> to_staff_id),
  check ((take_date is null) = (take_shifts is null)),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (from_staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (to_staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (decided_by, business_id) references public.staff (id, business_id)
);

create index shift_swaps_location_idx on public.shift_swaps (location_id, status, give_date);
create index shift_swaps_from_idx on public.shift_swaps (from_staff_id);
create index shift_swaps_to_idx on public.shift_swaps (to_staff_id);

alter table public.shift_swaps enable row level security;

create policy "The two people and managers see a swap"
  on public.shift_swaps for select to authenticated
  using (
    (select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]))
    or (select private.is_current_staff(business_id, from_staff_id))
    or (select private.is_current_staff(business_id, to_staff_id))
  );
-- Written only through the functions below.

-- Every step: asked, accepted, declined (by the coworker or a manager),
-- approved, canceled.
create table public.shift_swap_events (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  swap_id      uuid not null references public.shift_swaps (id) on delete cascade,
  kind         text not null check (kind in ('asked', 'accepted', 'declined', 'approved', 'canceled')),
  by_staff_id  uuid,
  reason       text,
  created_at   timestamptz not null default now()
);

create index shift_swap_events_swap_idx on public.shift_swap_events (swap_id, created_at);

alter table public.shift_swap_events enable row level security;

create policy "Those who see the swap see its log"
  on public.shift_swap_events for select to authenticated
  using (exists (select 1 from public.shift_swaps s where s.id = swap_id));

-- ---------------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------------

-- Whether any shift in a overlaps any in b ([{start, end}] each).
create function private.shifts_overlap(a jsonb, b jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(a) x, jsonb_array_elements(b) y
    where (x ->> 'start')::int < (y ->> 'end')::int and (y ->> 'start')::int < (x ->> 'end')::int
  );
$$;

-- Why someone can't take these shifts on a day, or null: they're already
-- working then, or have approved time off then.
create function private.cant_take(p_staff_id uuid, p_date date, p_shifts jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select first_name into v_name from public.staff where id = p_staff_id;
  if private.shifts_overlap(private.live_hours(p_staff_id, p_date), p_shifts) then
    return v_name || ' is already working then on ' || to_char(p_date, 'Dy, Mon FMDD') || '.';
  end if;
  if exists (
    select 1 from public.staff_time_off t
    where t.staff_id = p_staff_id and t.status = 'approved' and t.starts_on <= p_date and t.ends_on >= p_date
      and (t.start_minute is null or private.shifts_overlap(p_shifts, jsonb_build_array(jsonb_build_object('start', t.start_minute, 'end', t.end_minute))))
  ) then
    return v_name || ' has time off on ' || to_char(p_date, 'Dy, Mon FMDD') || '.';
  end if;
  return null;
end;
$$;

-- Everything that stops a swap now, or null: the days still as asked
-- (published hours can change after), and each person free for the other's
-- shifts.
create function private.swap_problem(p_swap public.shift_swaps)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_problem text;
begin
  select timezone into v_tz from public.locations where id = p_swap.location_id;
  v_today := (now() at time zone v_tz)::date;
  if p_swap.give_date < v_today or p_swap.take_date < v_today then
    return 'That day has passed.';
  end if;
  if private.live_hours(p_swap.from_staff_id, p_swap.give_date) <> p_swap.give_shifts
     or (p_swap.take_date is not null and private.live_hours(p_swap.to_staff_id, p_swap.take_date) <> p_swap.take_shifts) then
    return 'The schedule for those days has changed since it was asked. Ask again.';
  end if;
  v_problem := private.cant_take(p_swap.to_staff_id, p_swap.give_date, p_swap.give_shifts);
  if v_problem is null and p_swap.take_date is not null then
    v_problem := private.cant_take(p_swap.from_staff_id, p_swap.take_date, p_swap.take_shifts);
  end if;
  return v_problem;
end;
$$;

-- ---------------------------------------------------------------------------
-- Asking, answering, deciding
-- ---------------------------------------------------------------------------

-- The front desk or an assistant offers a coworker in the same role their
-- day (and, for a swap, asks for one of the coworker's days).
create function public.request_shift_swap(p_to_staff_id uuid, p_give_date date, p_take_date date default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.staff;
  v_to public.staff;
  v_swap public.shift_swaps;
  v_problem text;
begin
  select * into v_me from public.staff where user_id = (select auth.uid()) and is_active limit 1;
  if v_me.id is null or v_me.role not in ('front_desk', 'assistant') then
    raise exception 'Shift swaps are for the front desk and assistants.' using errcode = '42501';
  end if;
  select * into v_to from public.staff where id = p_to_staff_id;
  if v_to.id is null or v_to.business_id <> v_me.business_id or v_to.location_id is distinct from v_me.location_id or not v_to.is_active or v_to.id = v_me.id then
    raise exception 'Choose a coworker here.' using errcode = '22023';
  end if;
  if v_to.role <> v_me.role then
    raise exception 'Swaps are with someone in the same role.' using errcode = '22023';
  end if;

  v_swap.business_id := v_me.business_id;
  v_swap.location_id := v_me.location_id;
  v_swap.from_staff_id := v_me.id;
  v_swap.to_staff_id := v_to.id;
  v_swap.give_date := p_give_date;
  v_swap.give_shifts := private.live_hours(v_me.id, p_give_date);
  if jsonb_array_length(v_swap.give_shifts) = 0 then
    raise exception 'You aren''t working on %.', to_char(p_give_date, 'Dy, Mon FMDD') using errcode = '22023';
  end if;
  if p_take_date is not null then
    v_swap.take_date := p_take_date;
    v_swap.take_shifts := private.live_hours(v_to.id, p_take_date);
    if jsonb_array_length(v_swap.take_shifts) = 0 then
      raise exception '% isn''t working on %.', v_to.first_name, to_char(p_take_date, 'Dy, Mon FMDD') using errcode = '22023';
    end if;
  end if;
  v_problem := private.swap_problem(v_swap);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if exists (
    select 1 from public.shift_swaps s
    where s.from_staff_id = v_me.id and s.give_date = p_give_date and s.status in ('asked', 'accepted')
  ) then
    raise exception 'You''ve already offered that day.' using errcode = '22023';
  end if;

  insert into public.shift_swaps (business_id, location_id, from_staff_id, to_staff_id, give_date, give_shifts, take_date, take_shifts, note)
  values (v_swap.business_id, v_swap.location_id, v_me.id, v_to.id, p_give_date, v_swap.give_shifts, p_take_date, v_swap.take_shifts, nullif(trim(p_note), ''))
  returning id into v_swap.id;
  insert into public.shift_swap_events (business_id, swap_id, kind, by_staff_id, reason) values (v_me.business_id, v_swap.id, 'asked', v_me.id, nullif(trim(p_note), ''));
  insert into public.notifications (business_id, location_id, staff_id, channel, status, template, body)
  values (v_me.business_id, v_me.location_id, v_to.id, 'app', 'sent', 'shift_swap_asked',
          v_me.first_name || ' asked you to take their ' || to_char(p_give_date, 'Dy, Mon FMDD') || ' shift (' || private.say_shifts(v_swap.give_shifts) || ')'
            || case when p_take_date is not null then ' in exchange for your ' || to_char(p_take_date, 'Dy, Mon FMDD') else '' end
            || '. Answer it on Shift swaps.');
  return v_swap.id;
end;
$$;

-- The coworker accepts (it then goes to a manager) or says no.
create function public.answer_shift_swap(p_swap_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_swap public.shift_swaps;
  v_me uuid;
  v_name text;
  v_problem text;
begin
  select * into v_swap from public.shift_swaps where id = p_swap_id for update;
  v_me := private.current_staff_id(v_swap.business_id);
  if v_swap.id is null or v_me is distinct from v_swap.to_staff_id then
    raise exception 'Only the coworker asked can answer.' using errcode = '42501';
  end if;
  if v_swap.status <> 'asked' then
    raise exception 'That swap has already been answered.' using errcode = '22023';
  end if;
  select first_name into v_name from public.staff where id = v_me;
  if p_accept then
    v_problem := private.swap_problem(v_swap);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;
  update public.shift_swaps set status = case when p_accept then 'accepted' else 'declined' end::public.shift_swap_status, answered_at = now() where id = p_swap_id;
  insert into public.shift_swap_events (business_id, swap_id, kind, by_staff_id) values (v_swap.business_id, p_swap_id, case when p_accept then 'accepted' else 'declined' end, v_me);
  insert into public.notifications (business_id, location_id, staff_id, channel, status, template, body)
  values (v_swap.business_id, v_swap.location_id, v_swap.from_staff_id, 'app', 'sent', 'shift_swap_answered',
          v_name || case when p_accept then ' agreed to take your ' else ' can''t take your ' end || to_char(v_swap.give_date, 'Dy, Mon FMDD') || ' shift.'
            || case when p_accept then ' A manager will approve it.' else '' end);
  if p_accept then
    insert into public.notifications (business_id, location_id, staff_id, channel, status, template, body)
    select v_swap.business_id, v_swap.location_id, s.id, 'app', 'sent', 'shift_swap_to_approve',
           'A shift swap is waiting for you to approve: ' || (select first_name from public.staff where id = v_swap.from_staff_id) || ' and ' || v_name
             || ', ' || to_char(v_swap.give_date, 'Dy, Mon FMDD') || '. Review it in Scheduling, Requests.'
    from public.staff s
    where s.business_id = v_swap.business_id and s.location_id = v_swap.location_id and s.is_active and s.role in ('owner', 'manager');
  end if;
end;
$$;

-- An owner or manager approves (the hours change, as if published) or
-- declines with a reason. Both people are told.
create function public.decide_shift_swap(p_swap_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_swap public.shift_swaps;
  v_me uuid;
  v_problem text;
  v_text text;
begin
  select * into v_swap from public.shift_swaps where id = p_swap_id for update;
  if v_swap.id is null or not private.has_business_role(v_swap.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers approve shift swaps.' using errcode = '42501';
  end if;
  if v_swap.status <> 'accepted' then
    raise exception 'That swap isn''t waiting for approval.' using errcode = '22023';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why it''s declined.' using errcode = '22023';
  end if;
  v_me := private.current_staff_id(v_swap.business_id);

  if p_approve then
    v_problem := private.swap_problem(v_swap);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
    -- The asker's day goes to the coworker, alongside any hours they have.
    perform private.set_live_day(v_swap.business_id, v_swap.from_staff_id, v_swap.give_date,
      (select coalesce(jsonb_agg(s order by (s ->> 'start')::int), '[]'::jsonb) from jsonb_array_elements(private.live_hours(v_swap.from_staff_id, v_swap.give_date)) s where not private.shifts_overlap(jsonb_build_array(s), v_swap.give_shifts)));
    perform private.set_live_day(v_swap.business_id, v_swap.to_staff_id, v_swap.give_date,
      (select jsonb_agg(s order by (s ->> 'start')::int) from jsonb_array_elements(private.live_hours(v_swap.to_staff_id, v_swap.give_date) || v_swap.give_shifts) s));
    if v_swap.take_date is not null then
      perform private.set_live_day(v_swap.business_id, v_swap.to_staff_id, v_swap.take_date,
        (select coalesce(jsonb_agg(s order by (s ->> 'start')::int), '[]'::jsonb) from jsonb_array_elements(private.live_hours(v_swap.to_staff_id, v_swap.take_date)) s where not private.shifts_overlap(jsonb_build_array(s), v_swap.take_shifts)));
      perform private.set_live_day(v_swap.business_id, v_swap.from_staff_id, v_swap.take_date,
        (select jsonb_agg(s order by (s ->> 'start')::int) from jsonb_array_elements(private.live_hours(v_swap.from_staff_id, v_swap.take_date) || v_swap.take_shifts) s));
    end if;
    -- A draft for those days would undo it at the next publish.
    delete from public.schedule_drafts
    where staff_id in (v_swap.from_staff_id, v_swap.to_staff_id) and on_date in (v_swap.give_date, coalesce(v_swap.take_date, v_swap.give_date));
    update public.locations set calendar_version = calendar_version + 1 where id = v_swap.location_id;
  end if;

  update public.shift_swaps
  set status = case when p_approve then 'approved' else 'declined' end::public.shift_swap_status, decided_by = v_me, decided_at = now(),
      decline_reason = case when p_approve then null else trim(p_reason) end
  where id = p_swap_id;
  insert into public.shift_swap_events (business_id, swap_id, kind, by_staff_id, reason)
  values (v_swap.business_id, p_swap_id, case when p_approve then 'approved' else 'declined' end, v_me, case when p_approve then null else trim(p_reason) end);

  v_text := 'The shift swap for ' || to_char(v_swap.give_date, 'Dy, Mon FMDD')
    || case when p_approve then ' was approved. Your schedule shows the new hours.' else ' was declined: ' || trim(p_reason) end;
  insert into public.notifications (business_id, location_id, staff_id, channel, status, template, body)
  select v_swap.business_id, v_swap.location_id, who, 'app', 'sent', 'shift_swap_decided', v_text
  from unnest(array[v_swap.from_staff_id, v_swap.to_staff_id]) who;
end;
$$;

-- The asker takes it back while it's still waiting.
create function public.cancel_shift_swap(p_swap_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_swap public.shift_swaps;
  v_me uuid;
begin
  select * into v_swap from public.shift_swaps where id = p_swap_id for update;
  v_me := private.current_staff_id(v_swap.business_id);
  if v_swap.id is null or v_me is distinct from v_swap.from_staff_id then
    raise exception 'Only the person who asked can cancel it.' using errcode = '42501';
  end if;
  if v_swap.status not in ('asked', 'accepted') then
    raise exception 'That swap is already settled.' using errcode = '22023';
  end if;
  update public.shift_swaps set status = 'canceled' where id = p_swap_id;
  insert into public.shift_swap_events (business_id, swap_id, kind, by_staff_id) values (v_swap.business_id, p_swap_id, 'canceled', v_me);
end;
$$;

revoke all on function private.shifts_overlap(jsonb, jsonb) from public;
revoke all on function private.cant_take(uuid, date, jsonb) from public;
revoke all on function private.swap_problem(public.shift_swaps) from public;
grant execute on function public.request_shift_swap(uuid, date, date, text) to authenticated;
grant execute on function public.answer_shift_swap(uuid, boolean) to authenticated;
grant execute on function public.decide_shift_swap(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_shift_swap(uuid) to authenticated;
revoke execute on function public.request_shift_swap(uuid, date, date, text) from anon;
revoke execute on function public.answer_shift_swap(uuid, boolean) from anon;
revoke execute on function public.decide_shift_swap(uuid, boolean, text) from anon;
revoke execute on function public.cancel_shift_swap(uuid) from anon;
