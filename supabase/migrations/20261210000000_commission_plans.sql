-- Commission plans (lib/commission.ts works out the pay): the salon's
-- plans (commission with flat or tiered rates, hourly, or booth rent),
-- each saved as an immutable version, a plan per person (or their own flat
-- rates, as before), and on every service and product line the plan
-- version it was sold under, so changing a plan never changes past pay.

create table public.commission_plans (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  name                text not null check (length(trim(name)) between 1 and 60),
  is_default          boolean not null default false,
  current_version_id  uuid,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (id, business_id)
);

create index commission_plans_business_idx on public.commission_plans (business_id);
create unique index commission_plans_one_default on public.commission_plans (business_id) where is_default and archived_at is null;

-- What a plan was at each save. rules:
--   mode         'commission' | 'hourly' | 'booth_rent'
--   service      [{from_cents, pct}, ...]  tiers, the first from 0 (flat: one tier)
--   retail       [{from_cents, pct}, ...]
--   tier_period  'pay_period' | 'month'   when the tiers start again
--   backbar      {kind: 'none' | 'fixed' | 'percent', value}  per service line: cents, or a whole percent
--   rent         {cents, per: 'week' | 'month'} | null       booth rent
create table public.commission_plan_versions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  plan_id      uuid not null,
  rules        jsonb not null,
  created_by   uuid references public.staff (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (plan_id, business_id) references public.commission_plans (id, business_id) on delete cascade
);

create index commission_plan_versions_plan_idx on public.commission_plan_versions (plan_id, created_at);

alter table public.commission_plans
  add foreign key (current_version_id) references public.commission_plan_versions (id);

-- A person's plan; null: their own flat rates (service and retail %).
alter table public.staff_compensation add column plan_id uuid references public.commission_plans (id);
alter table public.staff_compensation_history add column plan_id uuid references public.commission_plans (id) on delete set null;

-- The plan version each line was sold under (null: the line's own rate).
alter table public.sale_items add column commission_version_id uuid references public.commission_plan_versions (id);
create index sale_items_commission_version_idx on public.sale_items (commission_version_id) where commission_version_id is not null;

alter table public.commission_plans enable row level security;
alter table public.commission_plan_versions enable row level security;

-- Pay rules: whoever runs payroll. Anyone else gets their own plan's
-- rules through commission_rules below. Written only by the functions.
create policy "Payroll can view commission plans"
  on public.commission_plans for select to authenticated
  using ((select private.can(business_id, 'payroll')));
create policy "Payroll can view commission plan versions"
  on public.commission_plan_versions for select to authenticated
  using ((select private.can(business_id, 'payroll')));

-- Checks a plan's rules; raises with a message staff can read.
create function private.check_commission_rules(p_rules jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_kind text;
  v_tiers jsonb;
  v_last bigint;
  v_tier jsonb;
begin
  if p_rules->>'mode' not in ('commission', 'hourly', 'booth_rent') then
    raise exception 'Choose how they''re paid' using errcode = '22023';
  end if;
  if coalesce(p_rules->>'tier_period', '') not in ('pay_period', 'month') then
    raise exception 'Choose when the tiers start again' using errcode = '22023';
  end if;
  foreach v_kind in array array['service', 'retail'] loop
    v_tiers := p_rules->v_kind;
    if jsonb_typeof(v_tiers) <> 'array' or jsonb_array_length(v_tiers) not between 1 and 6 then
      raise exception 'Give % commission one to six tiers', v_kind using errcode = '22023';
    end if;
    v_last := -1;
    for v_tier in select * from jsonb_array_elements(v_tiers) loop
      if coalesce((v_tier->>'from_cents')::bigint, -1) <= v_last or coalesce((v_tier->>'pct')::numeric, -1) not between 0 and 100 then
        raise exception 'Each % tier starts above the last, at 0 to 100%%', v_kind using errcode = '22023';
      end if;
      v_last := (v_tier->>'from_cents')::bigint;
    end loop;
    if (v_tiers->0->>'from_cents')::bigint <> 0 then
      raise exception 'The first % tier starts at $0', v_kind using errcode = '22023';
    end if;
  end loop;
  if coalesce(p_rules->'backbar'->>'kind', '') not in ('none', 'fixed', 'percent')
     or (p_rules->'backbar'->>'kind' = 'fixed' and coalesce((p_rules->'backbar'->>'value')::integer, 0) not between 1 and 10000)
     or (p_rules->'backbar'->>'kind' = 'percent' and coalesce((p_rules->'backbar'->>'value')::numeric, 0) not between 1 and 50) then
    raise exception 'Give the back-bar fee as $0.01 to $100 or 1 to 50%% per service' using errcode = '22023';
  end if;
  if p_rules->>'mode' = 'booth_rent' then
    if coalesce((p_rules->'rent'->>'cents')::integer, 0) not between 100 and 2000000 or coalesce(p_rules->'rent'->>'per', '') not in ('week', 'month') then
      raise exception 'Give the rent and how often it''s due' using errcode = '22023';
    end if;
  end if;
end;
$$;

-- Adds or changes a plan: a new version every time (past lines keep theirs).
create function public.save_commission_plan(p_business_id uuid, p_plan_id uuid, p_name text, p_rules jsonb, p_default boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid := p_plan_id;
  v_version uuid;
begin
  if not private.can(p_business_id, 'payroll') then
    raise exception 'Only people who run payroll can change commission plans' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Give the plan a name' using errcode = '22023';
  end if;
  perform private.check_commission_rules(p_rules);
  if v_plan is null then
    insert into public.commission_plans (business_id, name) values (p_business_id, trim(p_name)) returning id into v_plan;
  elsif not exists (select 1 from public.commission_plans where id = v_plan and business_id = p_business_id and archived_at is null) then
    raise exception 'That plan isn''t here any more' using errcode = 'P0002';
  end if;
  insert into public.commission_plan_versions (business_id, plan_id, rules, created_by)
  values (p_business_id, v_plan, p_rules, private.current_staff_id(p_business_id))
  returning id into v_version;
  if p_default then
    update public.commission_plans set is_default = false where business_id = p_business_id and id <> v_plan and is_default;
  end if;
  update public.commission_plans set name = trim(p_name), current_version_id = v_version, is_default = p_default where id = v_plan;
  return v_plan;
end;
$$;

-- Retires a plan nobody is on (its versions stay for past pay).
create function public.archive_commission_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.commission_plans where id = p_plan_id);
begin
  if v_business is null or not private.can(v_business, 'payroll') then
    raise exception 'Only people who run payroll can change commission plans' using errcode = '42501';
  end if;
  if exists (select 1 from public.staff_compensation where plan_id = p_plan_id) then
    raise exception 'Move everyone off this plan first' using errcode = '55000';
  end if;
  update public.commission_plans set archived_at = now(), is_default = false where id = p_plan_id;
end;
$$;

-- Puts someone on a plan (or back on their own rates, p_plan_id null).
create function public.set_staff_commission_plan(p_staff_id uuid, p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.staff where id = p_staff_id);
begin
  if v_business is null or not private.can(v_business, 'payroll') then
    raise exception 'Only people who run payroll can change pay' using errcode = '42501';
  end if;
  if p_plan_id is not null and not exists (select 1 from public.commission_plans where id = p_plan_id and business_id = v_business and archived_at is null) then
    raise exception 'Choose one of the salon''s plans' using errcode = '22023';
  end if;
  insert into public.staff_compensation (staff_id, business_id, plan_id) values (p_staff_id, v_business, p_plan_id)
  on conflict (staff_id) do update set plan_id = excluded.plan_id;
end;
$$;

-- The rules behind someone's pay: with payroll, every version at the
-- salon; anyone else, their current plan's and those on their own lines.
create function public.commission_rules(p_business_id uuid, p_staff_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can(p_business_id, 'payroll') and (p_staff_id is null or not private.is_current_staff(p_business_id, p_staff_id)) then
    raise exception 'Only people who run payroll can see everyone''s pay' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', v.id, 'plan_id', v.plan_id, 'name', p.name, 'rules', v.rules, 'created_at', v.created_at) order by v.created_at)
    from public.commission_plan_versions v
    join public.commission_plans p on p.id = v.plan_id
    where v.business_id = p_business_id
      and (
        p_staff_id is null and private.can(p_business_id, 'payroll')
        or exists (select 1 from public.staff_compensation c where c.staff_id = p_staff_id and c.plan_id = v.plan_id)
        or exists (select 1 from public.staff_compensation_history h where h.staff_id = p_staff_id and h.plan_id = v.plan_id)
        or exists (select 1 from public.sale_items i where i.commission_version_id = v.id and i.staff_id = p_staff_id)
      )
  ), '[]');
end;
$$;

-- Lines record the plan version too (and, for the page, its first rate).
create or replace function private.record_line_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
  v_rules jsonb;
begin
  if new.commission_pct is null and new.staff_id is not null and new.kind::text in ('service', 'product') then
    select c.plan_id, case when new.kind::text = 'service' then c.service_commission_pct else c.retail_commission_pct end
      into v_plan, new.commission_pct
    from public.staff_compensation c where c.staff_id = new.staff_id;
    if v_plan is not null then
      select p.current_version_id, v.rules into new.commission_version_id, v_rules
      from public.commission_plans p join public.commission_plan_versions v on v.id = p.current_version_id
      where p.id = v_plan;
      new.commission_pct := case
        when v_rules->>'mode' = 'booth_rent' then 100
        when v_rules->>'mode' = 'hourly' and new.kind::text = 'service' then 0
        else (v_rules->(case when new.kind::text = 'service' then 'service' else 'retail' end)->0->>'pct')::numeric
      end;
    end if;
    new.commission_pct := coalesce(new.commission_pct, 0);
  end if;
  return new;
end;
$$;

-- Plan changes are pay changes too.
create or replace function private.record_compensation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.service_commission_pct is not distinct from old.service_commission_pct
     and new.retail_commission_pct is not distinct from old.retail_commission_pct
     and new.hourly_rate_cents is not distinct from old.hourly_rate_cents
     and new.plan_id is not distinct from old.plan_id then
    return new;
  end if;
  insert into public.staff_compensation_history (business_id, staff_id, effective_from, service_commission_pct, retail_commission_pct, hourly_rate_cents, plan_id, changed_by)
  values (
    new.business_id, new.staff_id,
    case when exists (select 1 from public.staff_compensation_history h where h.staff_id = new.staff_id) then now() else '-infinity'::timestamptz end,
    new.service_commission_pct, new.retail_commission_pct, new.hourly_rate_cents, new.plan_id,
    private.current_staff_id(new.business_id)
  );
  return new;
end;
$$;

revoke all on function private.check_commission_rules(jsonb) from public;
revoke all on function public.save_commission_plan(uuid, uuid, text, jsonb, boolean) from public, anon;
revoke all on function public.archive_commission_plan(uuid) from public, anon;
revoke all on function public.set_staff_commission_plan(uuid, uuid) from public, anon;
revoke all on function public.commission_rules(uuid, uuid) from public, anon;
grant execute on function public.save_commission_plan(uuid, uuid, text, jsonb, boolean) to authenticated;
grant execute on function public.archive_commission_plan(uuid) to authenticated;
grant execute on function public.set_staff_commission_plan(uuid, uuid) to authenticated;
grant execute on function public.commission_rules(uuid, uuid) to authenticated;

-- payroll_sales, as before, with each line's plan version.
do $$
declare
  v_def text := pg_get_functiondef('public.payroll_sales(uuid,timestamptz,timestamptz,uuid)'::regprocedure);
  v_old text := '''commission_pct'', coalesce(i.commission_pct, 0))';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'payroll_sales has changed';
  end if;
  execute replace(v_def, v_old, '''commission_pct'', coalesce(i.commission_pct, 0), ''commission_version_id'', i.commission_version_id)');
end;
$$;

-- New team members start on the salon's default plan, if it has one.
create function private.default_commission_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid := (select id from public.commission_plans where business_id = new.business_id and is_default and archived_at is null);
begin
  if v_plan is not null then
    insert into public.staff_compensation (staff_id, business_id, plan_id) values (new.id, new.business_id, v_plan)
    on conflict (staff_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger staff_default_commission_plan after insert on public.staff
  for each row execute function private.default_commission_plan();

revoke all on function private.default_commission_plan() from public;
