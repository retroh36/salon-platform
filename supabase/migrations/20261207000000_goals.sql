-- Goals with pacing (lib/goals/). A goal is a target for one stylist and
-- one measure (service revenue, retail, rebooking %, new clients, average
-- ticket) over each week, month, quarter or year. Owners set them for
-- anyone; anyone can set their own (but not change one an owner set).
-- Owners and managers see everyone's; everyone else only their own.
-- Revenue comes from payroll_sales; the rest from goal_progress below.

create table public.staff_goals (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  staff_id      uuid not null,
  metric        text not null check (metric in ('service_revenue', 'retail_revenue', 'rebooking_rate', 'new_clients', 'average_ticket')),
  period        text not null check (period in ('week', 'month', 'quarter', 'year')),
  -- Cents, a whole percent (rebooking) or a count (new clients).
  target        integer not null check (target > 0 and target <= 1000000000),
  set_by_owner  boolean not null default false,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (staff_id, metric, period),
  check (metric <> 'rebooking_rate' or target <= 100),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);

create trigger staff_goals_set_updated_at before update on public.staff_goals
  for each row execute function public.set_updated_at();

alter table public.staff_goals enable row level security;

create policy "Owners and managers see the team's goals, everyone their own" on public.staff_goals
  for select to authenticated
  using (private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]) or private.current_staff_id(business_id) = staff_id);

-- Denise celebrates 50%, 75% and the goal once per period.
create table public.goal_celebrations (
  goal_id      uuid not null references public.staff_goals (id) on delete cascade,
  period_from  date not null,
  milestone    smallint not null check (milestone in (50, 75, 100)),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  staff_id     uuid not null,
  created_at   timestamptz not null default now(),
  primary key (goal_id, period_from, milestone)
);

alter table public.goal_celebrations enable row level security;

create policy "Owners and managers see the team's celebrations, everyone their own" on public.goal_celebrations
  for select to authenticated
  using (private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]) or private.current_staff_id(business_id) = staff_id);

-- How often Denise's goal alert comes up for them, and when they last saw it.
alter table public.staff
  add column goal_alerts text not null default 'daily' check (goal_alerts in ('daily', 'weekly')),
  add column goal_alert_seen_on date;

create function public.save_staff_goal(p_staff_id uuid, p_metric text, p_period text, p_target integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_owner boolean;
  v_me uuid;
  v_existing public.staff_goals;
  v_id uuid;
begin
  select business_id into v_business from public.staff where id = p_staff_id and is_active;
  if v_business is null then
    raise exception 'That team member no longer exists' using errcode = '22023';
  end if;
  v_owner := private.has_business_role(v_business, array['owner']::public.staff_role[]);
  v_me := private.current_staff_id(v_business);
  if not v_owner and v_me is distinct from p_staff_id then
    raise exception 'Only owners set goals for others' using errcode = '42501';
  end if;
  select * into v_existing from public.staff_goals where staff_id = p_staff_id and metric = p_metric and period = p_period;
  if v_existing.id is not null and v_existing.set_by_owner and not v_owner then
    raise exception 'An owner set this goal' using errcode = '42501';
  end if;
  insert into public.staff_goals (business_id, staff_id, metric, period, target, set_by_owner, created_by, updated_by)
  values (v_business, p_staff_id, p_metric, p_period, p_target, v_owner and v_me is distinct from p_staff_id, v_me, v_me)
  on conflict (staff_id, metric, period) do update
    set target = excluded.target, updated_by = excluded.updated_by,
        set_by_owner = public.staff_goals.set_by_owner or excluded.set_by_owner
  returning id into v_id;
  return v_id;
end;
$$;

create function public.delete_staff_goal(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.staff_goals;
begin
  select * into v_goal from public.staff_goals where id = p_goal_id;
  if v_goal.id is null then
    return;
  end if;
  if not private.has_business_role(v_goal.business_id, array['owner']::public.staff_role[])
     and (private.current_staff_id(v_goal.business_id) is distinct from v_goal.staff_id or v_goal.set_by_owner) then
    raise exception 'Only an owner can remove this goal' using errcode = '42501';
  end if;
  delete from public.staff_goals where id = p_goal_id;
end;
$$;

create function public.set_goal_alerts(p_frequency text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.staff set goal_alerts = p_frequency where user_id = auth.uid();
$$;

-- They've read today's (or this week's) alert: it stays away until the
-- next one is due, and its celebrations aren't repeated.
create function public.seen_goal_alert(p_on date, p_milestones jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where user_id = auth.uid() and is_active limit 1;
  if v_staff.id is null then
    raise exception 'Not signed in as staff' using errcode = '42501';
  end if;
  update public.staff set goal_alert_seen_on = p_on where id = v_staff.id;
  insert into public.goal_celebrations (goal_id, period_from, milestone, business_id, staff_id)
  select g.id, (m ->> 'period_from')::date, (m ->> 'milestone')::smallint, g.business_id, g.staff_id
  from jsonb_array_elements(coalesce(p_milestones, '[]')) m
  join public.staff_goals g on g.id = (m ->> 'goal_id')::uuid and g.staff_id = v_staff.id
  on conflict do nothing;
end;
$$;

-- What a goal needs beyond payroll's revenue, for one stylist and a
-- period: checkouts where they were the main stylist and how many left
-- rebooked; new clients (a first completed visit at the salon) they saw;
-- and what's still booked with them before the period ends (services at
-- their booked prices, visits, and new clients among them).
create function public.goal_progress(p_staff_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_rebook jsonb;
  v_new integer;
  v_ahead jsonb;
begin
  select business_id into v_business from public.staff where id = p_staff_id;
  if v_business is null
     or not (private.has_business_role(v_business, array['owner', 'manager']::public.staff_role[]) or private.current_staff_id(v_business) = p_staff_id) then
    raise exception 'Only owners and managers see others'' goals' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Choose a period of up to a year' using errcode = '22023';
  end if;

  select jsonb_build_object('visits', count(*), 'rebooked', count(*) filter (where s.rebook_appointment_id is not null)) into v_rebook
  from public.sales s
  where s.business_id = v_business and s.appointment_id is not null and s.status <> 'voided'
    and s.created_at >= p_from and s.created_at < p_to
    and (select i.staff_id from public.sale_items i where i.sale_id = s.id and i.kind = 'service' order by i.position limit 1) = p_staff_id;

  select count(distinct a.client_id) into v_new
  from public.appointments a
  where a.business_id = v_business and a.status = 'completed' and a.client_id is not null
    and a.starts_at >= p_from and a.starts_at < p_to
    and exists (select 1 from public.appointment_items i where i.appointment_id = a.id and i.staff_id = p_staff_id)
    and not exists (select 1 from public.appointments b where b.client_id = a.client_id and b.status = 'completed' and b.starts_at < a.starts_at);

  select jsonb_build_object(
    'service_cents', coalesce(sum(i.price_cents), 0),
    'visits', count(distinct a.id),
    'new_clients', count(distinct a.client_id) filter (where not exists (select 1 from public.appointments b where b.client_id = a.client_id and b.status = 'completed'))
  ) into v_ahead
  from public.appointment_items i
  join public.appointments a on a.id = i.appointment_id
  where i.staff_id = p_staff_id and a.status in ('booked', 'confirmed', 'checked_in')
    and i.starts_at >= greatest(now(), p_from) and i.starts_at < p_to;

  return jsonb_build_object('rebook', v_rebook, 'new_clients', v_new, 'ahead', v_ahead);
end;
$$;

revoke all on function public.save_staff_goal(uuid, text, text, integer) from public, anon;
revoke all on function public.delete_staff_goal(uuid) from public, anon;
revoke all on function public.set_goal_alerts(text) from public, anon;
revoke all on function public.seen_goal_alert(date, jsonb) from public, anon;
revoke all on function public.goal_progress(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.save_staff_goal(uuid, text, text, integer) to authenticated;
grant execute on function public.delete_staff_goal(uuid) to authenticated;
grant execute on function public.set_goal_alerts(text) to authenticated;
grant execute on function public.seen_goal_alert(date, jsonb) to authenticated;
grant execute on function public.goal_progress(uuid, timestamptz, timestamptz) to authenticated;
