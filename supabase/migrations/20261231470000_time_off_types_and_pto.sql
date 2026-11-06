-- Time off types and PTO balances.
--
-- Each salon names its own kinds of time off (Vacation, Sick, Personal,
-- Jury duty…), each on one of the four reasons the calendar and Denise
-- already word (vacation, sick, personal, other), and each with a switch
-- for whether it uses the PTO balance. Time off keeps its reason; its type
-- sets it.
--
-- A salon's PTO policy says how time is earned (a yearly grant, an amount
-- per hour worked, or an amount per pay period), when the PTO year starts,
-- what carries over and the most anyone can hold. Balances are worked out
-- by our code (lib/pto.ts) from the policy, hours worked, approved time off
-- of the types that use PTO and adjustments, so a change to any of them
-- puts every balance right; only adjustments are stored.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create table public.time_off_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  reason public.time_off_reason not null,
  uses_pto boolean not null default false,
  position smallint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, business_id)
);
create unique index time_off_types_name on public.time_off_types (business_id, lower(trim(name))) where archived_at is null;
create index time_off_types_business on public.time_off_types (business_id, position);

alter table public.time_off_types enable row level security;
create policy "Members read the salon's time off types" on public.time_off_types
  for select to authenticated using (business_id in (select private.member_businesses()));

create function private.default_time_off_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.time_off_types (business_id, name, reason, uses_pto, position)
  values (new.id, 'Vacation', 'vacation', true, 0),
         (new.id, 'Sick', 'sick', false, 1),
         (new.id, 'Personal', 'personal', true, 2),
         (new.id, 'Other', 'other', false, 3);
  return new;
end;
$$;

create trigger businesses_default_time_off_types
  after insert on public.businesses
  for each row execute function private.default_time_off_types();

insert into public.time_off_types (business_id, name, reason, uses_pto, position)
select b.id, t.name, t.reason::public.time_off_reason, t.uses_pto, t.position
from public.businesses b
cross join (values ('Vacation', 'vacation', true, 0), ('Sick', 'sick', false, 1), ('Personal', 'personal', true, 2), ('Other', 'other', false, 3)) as t (name, reason, uses_pto, position);

alter table public.staff_time_off add column type_id uuid;
update public.staff_time_off o set type_id = t.id
from public.time_off_types t
where t.business_id = o.business_id and t.reason = o.reason;
-- Never null once saved (the trigger below sees to it), but left nullable
-- so code that saves only a reason still type-checks.
alter table public.staff_time_off
  add constraint staff_time_off_type_fkey foreign key (type_id, business_id) references public.time_off_types (id, business_id);
create index staff_time_off_type on public.staff_time_off (type_id);

-- The type sets the reason; time off saved with only a reason (older code,
-- the call-out flow) takes the salon's first type with that reason.
create function private.time_off_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason public.time_off_reason;
  v_archived timestamptz;
begin
  if new.type_id is null then
    select id into new.type_id from public.time_off_types
    where business_id = new.business_id and reason = new.reason
    order by archived_at nulls first, position limit 1;
    if new.type_id is null then
      raise exception 'Choose a type of time off.' using errcode = '22023', hint = 'type';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.type_id is not distinct from old.type_id then
    return new;
  end if;
  select reason, archived_at into v_reason, v_archived from public.time_off_types where id = new.type_id and business_id = new.business_id;
  if v_reason is null then
    raise exception 'Choose a type of time off.' using errcode = '22023', hint = 'type';
  end if;
  if v_archived is not null then
    raise exception 'That type of time off is no longer used.' using errcode = '22023', hint = 'type';
  end if;
  new.reason := v_reason;
  return new;
end;
$$;

create trigger staff_time_off_type
  before insert or update of type_id, reason on public.staff_time_off
  for each row execute function private.time_off_type();

-- Saves the whole list, in order: [{id|null, name, reason, uses_pto}].
-- Types left out are archived (time off already taken keeps them).
create function public.save_time_off_types(p_business_id uuid, p_types jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type jsonb;
  v_pos integer := 0;
  v_id uuid;
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only those who manage the salon''s settings can change types of time off.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_types) <> 'array' or jsonb_array_length(p_types) = 0 then
    raise exception 'Keep at least one type of time off.' using errcode = '22023', hint = 'empty';
  end if;
  if jsonb_array_length(p_types) > 12 then
    raise exception 'Keep it to 12 types.' using errcode = '22023', hint = 'too_many';
  end if;
  -- Archive what's gone first, so a name can move to another row.
  update public.time_off_types set archived_at = now()
  where business_id = p_business_id and archived_at is null
    and id not in (select (t ->> 'id')::uuid from jsonb_array_elements(p_types) t where t ->> 'id' is not null);
  for v_type in select * from jsonb_array_elements(p_types) loop
    if length(trim(coalesce(v_type ->> 'name', ''))) not between 1 and 40 then
      raise exception 'Give each type a name of 40 characters or less.' using errcode = '22023', hint = 'name';
    end if;
    if v_type ->> 'id' is null then
      insert into public.time_off_types (business_id, name, reason, uses_pto, position)
      values (p_business_id, trim(v_type ->> 'name'), (v_type ->> 'reason')::public.time_off_reason, coalesce((v_type ->> 'uses_pto')::boolean, false), v_pos)
      returning id into v_id;
    else
      update public.time_off_types
      set name = trim(v_type ->> 'name'), reason = (v_type ->> 'reason')::public.time_off_reason,
          uses_pto = coalesce((v_type ->> 'uses_pto')::boolean, false), position = v_pos
      where id = (v_type ->> 'id')::uuid and business_id = p_business_id and archived_at is null
      returning id into v_id;
      if v_id is null then
        raise exception 'That type of time off has changed. Reload and try again.' using errcode = '22023', hint = 'stale';
      end if;
    end if;
    v_pos := v_pos + 1;
  end loop;
exception
  when unique_violation then
    raise exception 'Two types have the same name.' using errcode = '22023', hint = 'duplicate';
end;
$$;
revoke execute on function public.save_time_off_types(uuid, jsonb) from public, anon;
grant execute on function public.save_time_off_types(uuid, jsonb) to authenticated;

-- Asking for time off takes the type (its reason follows).
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.request_time_off(date, date, public.time_off_reason, integer, integer, text)'::regprocedure);
  v_def := replace(v_def, 'p_note text DEFAULT NULL::text)', 'p_note text DEFAULT NULL::text, p_type_id uuid DEFAULT NULL::uuid)');
  v_def := replace(v_def, '  v_when text;', '  v_when text;
  v_type text;');
  v_def := replace(v_def,
    'insert into public.staff_time_off (business_id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status, requested_by, short_notice, in_blackout)',
    'insert into public.staff_time_off (business_id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, type_id, note, status, requested_by, short_notice, in_blackout)');
  v_def := replace(v_def,
    'values (v_me.business_id, v_me.id, p_starts_on, p_ends_on, p_start_minute, p_end_minute, p_reason, nullif(trim(p_note), ''''), ''requested'', v_me.id, v_short, v_blackout)',
    'values (v_me.business_id, v_me.id, p_starts_on, p_ends_on, p_start_minute, p_end_minute, p_reason, p_type_id, nullif(trim(p_note), ''''), ''requested'', v_me.id, v_short, v_blackout)');
  v_def := replace(v_def, '  returning id into v_id;
', '  returning id into v_id;
  select t.name into v_type from public.staff_time_off o join public.time_off_types t on t.id = o.type_id where o.id = v_id;
');
  v_def := replace(v_def, '|| initcap(p_reason::text) ||', '|| v_type ||');
  if v_def not like '%p_type_id, nullif%' or v_def not like '%|| v_type ||%' then
    raise exception 'request_time_off did not patch';
  end if;
  drop function public.request_time_off(date, date, public.time_off_reason, integer, integer, text);
  execute v_def;
end;
$$;
revoke execute on function public.request_time_off(date, date, public.time_off_reason, integer, integer, text, uuid) from public, anon;
grant execute on function public.request_time_off(date, date, public.time_off_reason, integer, integer, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The PTO policy
-- ---------------------------------------------------------------------------

create table public.pto_policies (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  is_on boolean not null default false,
  -- How it's earned: a yearly grant, per hour worked, or per pay period.
  accrual text not null default 'yearly' check (accrual in ('yearly', 'per_hour', 'per_period')),
  yearly_minutes integer not null default 4800 check (yearly_minutes between 0 and 2000 * 60),
  -- Prorate the first year's grant for someone who starts partway through.
  prorate_first_year boolean not null default true,
  -- Per hour worked: earn_minutes for every per_hours worked (1 hr per 30).
  earn_minutes integer not null default 60 check (earn_minutes between 1 and 600),
  per_hours integer not null default 30 check (per_hours between 1 and 400),
  period_minutes integer not null default 240 check (period_minutes between 0 and 100 * 60),
  -- The PTO year starts on the 1st of this month.
  year_start_month smallint not null default 1 check (year_start_month between 1 and 12),
  -- At the year's end: all carries over, none, or up to carry_minutes.
  carry_over text not null default 'up_to' check (carry_over in ('all', 'none', 'up_to')),
  carry_minutes integer not null default 2400 check (carry_minutes between 0 and 2000 * 60),
  -- The most anyone can hold (null: no cap); earning stops there.
  cap_minutes integer check (cap_minutes is null or cap_minutes between 60 and 4000 * 60),
  -- Balances count from this day (earlier is set with an adjustment).
  tracking_from date not null default current_date,
  roles public.staff_role[] not null default '{manager,front_desk,stylist,assistant}',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  foreign key (updated_by, business_id) references public.staff (id, business_id)
);

alter table public.pto_policies enable row level security;
create policy "Members read the salon's PTO policy" on public.pto_policies
  for select to authenticated using (business_id in (select private.member_businesses()));

create function public.save_pto_policy(p_business_id uuid, p_policy jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_staff_id(p_business_id);
  v_roles public.staff_role[];
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only those who manage the salon''s settings can change the PTO policy.' using errcode = '42501';
  end if;
  select coalesce(array_agg(r::public.staff_role), '{}') into v_roles
  from jsonb_array_elements_text(coalesce(p_policy -> 'roles', '[]')) r
  where r in ('owner', 'manager', 'front_desk', 'stylist', 'assistant', 'bookkeeper');
  insert into public.pto_policies as p (business_id, is_on, accrual, yearly_minutes, prorate_first_year, earn_minutes, per_hours, period_minutes,
    year_start_month, carry_over, carry_minutes, cap_minutes, tracking_from, roles, updated_by, updated_at)
  values (p_business_id, (p_policy ->> 'is_on')::boolean, p_policy ->> 'accrual', (p_policy ->> 'yearly_minutes')::integer,
    (p_policy ->> 'prorate_first_year')::boolean, (p_policy ->> 'earn_minutes')::integer, (p_policy ->> 'per_hours')::integer,
    (p_policy ->> 'period_minutes')::integer, (p_policy ->> 'year_start_month')::smallint, p_policy ->> 'carry_over',
    (p_policy ->> 'carry_minutes')::integer, (p_policy ->> 'cap_minutes')::integer, (p_policy ->> 'tracking_from')::date, v_roles, v_me, now())
  on conflict (business_id) do update set
    is_on = excluded.is_on, accrual = excluded.accrual, yearly_minutes = excluded.yearly_minutes,
    prorate_first_year = excluded.prorate_first_year, earn_minutes = excluded.earn_minutes, per_hours = excluded.per_hours,
    period_minutes = excluded.period_minutes, year_start_month = excluded.year_start_month, carry_over = excluded.carry_over,
    carry_minutes = excluded.carry_minutes, cap_minutes = excluded.cap_minutes, tracking_from = excluded.tracking_from,
    roles = excluded.roles, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
exception
  when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'Check the PTO policy''s amounts.' using errcode = '22023', hint = 'policy';
end;
$$;
revoke execute on function public.save_pto_policy(uuid, jsonb) from public, anon;
grant execute on function public.save_pto_policy(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Adjustments: a starting balance, a correction, a payout
-- ---------------------------------------------------------------------------

create table public.pto_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null,
  on_date date not null,
  minutes integer not null check (minutes <> 0 and abs(minutes) <= 4000 * 60),
  reason text not null check (length(trim(reason)) between 3 and 300),
  by_staff_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (by_staff_id, business_id) references public.staff (id, business_id)
);
create index pto_adjustments_staff on public.pto_adjustments (staff_id, on_date);
create index pto_adjustments_business on public.pto_adjustments (business_id, created_at);

alter table public.pto_adjustments enable row level security;
create policy "Yourself, and the team's for those who manage it or payroll" on public.pto_adjustments
  for select to authenticated using (
    staff_id = (select private.current_staff_id(business_id))
    or business_id in (select private.businesses_with('team'))
    or business_id in (select private.businesses_with('payroll'))
  );

create function public.adjust_pto(p_business_id uuid, p_staff_id uuid, p_minutes integer, p_on_date date, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_staff_id(p_business_id);
  v_role public.staff_role;
  v_id uuid;
begin
  if not private.can(p_business_id, 'team') then
    raise exception 'Only those who manage the team can change PTO balances.' using errcode = '42501';
  end if;
  select role into v_role from public.staff where id = p_staff_id and business_id = p_business_id;
  if v_role is null then
    raise exception 'That team member doesn''t exist.' using errcode = '42501';
  end if;
  if v_role = 'owner' and not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only an owner can change an owner''s balance.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why, in a few words.' using errcode = '22023', hint = 'reason';
  end if;
  if coalesce(p_minutes, 0) = 0 or abs(p_minutes) > 4000 * 60 then
    raise exception 'Enter the hours to add or take off.' using errcode = '22023', hint = 'minutes';
  end if;
  insert into public.pto_adjustments (business_id, staff_id, on_date, minutes, reason, by_staff_id)
  values (p_business_id, p_staff_id, p_on_date, p_minutes, trim(p_reason), v_me)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.adjust_pto(uuid, uuid, integer, date, text) from public, anon;
grant execute on function public.adjust_pto(uuid, uuid, integer, date, text) to authenticated;
