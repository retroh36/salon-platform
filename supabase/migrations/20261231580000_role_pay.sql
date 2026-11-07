-- Payroll by working role (migration …_working_roles.sql, …_shift_roles.sql).
-- A role pays its time `usual` (as the person is the rest of the time),
-- `hourly` (each hour at the rate, no commission on its services) or
-- `commission` (its services at the percent, its hours unpaid).
--
-- Services: each service line records the role of the shift its visit
-- started in (sale_items.working_role_id) and, for an hourly or commission
-- role, the rate that pays it then, as commission_pct with no plan version,
-- so changing a role's pay or the schedule never changes past pay.
--
-- Hours: a role's rates are history like everyone's own
-- (working_role_pay_history, by triggers), so hours are paid at the rate
-- in effect each day.

alter table public.sale_items add column working_role_id uuid references public.working_roles (id) on delete set null;

-- The role (in use) of the shift a person is working at a moment, from the
-- published hours at their location.
create function private.role_at(p_staff_id uuid, p_at timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (s ->> 'role')::uuid
  from public.staff st
  join public.locations l on l.id = st.location_id
  cross join lateral (select (p_at at time zone l.timezone) as local) t
  cross join lateral jsonb_array_elements(private.live_hours(st.id, t.local::date)) s
  join public.working_roles w on w.id = (s ->> 'role')::uuid and w.archived_at is null
  where st.id = p_staff_id
    and (s ->> 'start')::integer <= extract(hour from t.local) * 60 + extract(minute from t.local)
    and (s ->> 'end')::integer > extract(hour from t.local) * 60 + extract(minute from t.local)
  limit 1;
$$;

-- As before, and a service line records its shift's role: at the role's
-- rate (the person's own in it first) when it pays hourly (0) or by
-- commission, with no plan version.
create or replace function private.record_line_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
  v_rules jsonb;
  v_at timestamptz;
  v_pay record;
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
        when v_rules->>'mode' = 'hourly' and new.kind::text = 'service' then 0
        else (v_rules->(case when new.kind::text = 'service' then 'service' else 'retail' end)->0->>'pct')::numeric
      end;
    end if;
    new.commission_pct := coalesce(new.commission_pct, 0);

    if new.kind::text = 'service' and new.working_role_id is null then
      select coalesce((select a.starts_at from public.appointment_items a where a.id = new.appointment_item_id), now()) into v_at;
      new.working_role_id := private.role_at(new.staff_id, v_at);
      if new.working_role_id is not null then
        select p.method, coalesce(sp.commission_pct, p.commission_pct) as pct into v_pay
        from public.working_role_pay p
        left join public.staff_role_pay sp on sp.role_id = p.role_id and sp.staff_id = new.staff_id
        where p.role_id = new.working_role_id;
        if v_pay.method = 'hourly' then
          new.commission_pct := 0;
          new.commission_version_id := null;
        elsif v_pay.method = 'commission' then
          new.commission_pct := v_pay.pct;
          new.commission_version_id := null;
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- payroll_sales, as before, with each line's role.
do $$
declare
  v_def text := pg_get_functiondef('public.payroll_sales(uuid,timestamptz,timestamptz,uuid)'::regprocedure);
  v_old text := '''commission_version_id'', i.commission_version_id)';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'payroll_sales has changed';
  end if;
  execute replace(v_def, v_old, '''commission_version_id'', i.commission_version_id, ''working_role_id'', i.working_role_id)');
end;
$$;

-- Every change to how a role pays, and to a person's own rate in it (both
-- null: back to the role's), from when it took effect. A role's first row
-- covers everything before it; a person's own rate counts from when it's set.
create table public.working_role_pay_history (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses (id) on delete cascade,
  role_id            uuid not null,
  -- Null: the role's own pay; else that person's own rate in it.
  staff_id           uuid references public.staff (id) on delete cascade,
  effective_from     timestamptz not null,
  method             text check (method in ('usual', 'hourly', 'commission')),
  hourly_rate_cents  integer,
  commission_pct     numeric(5, 2),
  changed_by         uuid references public.staff (id) on delete set null,
  foreign key (role_id, business_id) references public.working_roles (id, business_id) on delete cascade
);
create index working_role_pay_history_role_idx on public.working_role_pay_history (role_id, staff_id, effective_from);

alter table public.working_role_pay_history enable row level security;

create policy "Payroll and the role's people read its pay history" on public.working_role_pay_history
  for select to authenticated using (
    business_id in (select private.businesses_with('payroll'))
    or (staff_id is null and role_id in (select r.role_id from public.staff_working_roles r where r.staff_id = (select private.current_staff_id(r.business_id))))
    or staff_id = (select private.current_staff_id(business_id))
  );

create function private.record_role_pay_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The row as JSON, since the two tables' columns differ.
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_staff uuid := (v_row ->> 'staff_id')::uuid;
  v_role uuid := (v_row ->> 'role_id')::uuid;
  v_business uuid := (v_row ->> 'business_id')::uuid;
begin
  if tg_op = 'UPDATE'
     and v_new ->> 'hourly_rate_cents' is not distinct from v_old ->> 'hourly_rate_cents'
     and v_new ->> 'commission_pct' is not distinct from v_old ->> 'commission_pct'
     and v_new ->> 'method' is not distinct from v_old ->> 'method' then
    return new;
  end if;
  -- A person's own rate removed along with the role itself needs no row.
  if tg_op = 'DELETE' and not exists (select 1 from public.working_roles where id = v_role) then
    return old;
  end if;
  insert into public.working_role_pay_history (business_id, role_id, staff_id, effective_from, method, hourly_rate_cents, commission_pct, changed_by)
  values (
    v_business, v_role, v_staff,
    case when v_staff is not null or exists (select 1 from public.working_role_pay_history h where h.role_id = v_role and h.staff_id is null) then now() else '-infinity'::timestamptz end,
    v_new ->> 'method',
    (v_new ->> 'hourly_rate_cents')::integer,
    (v_new ->> 'commission_pct')::numeric,
    private.current_staff_id(v_business)
  );
  return coalesce(new, old);
end;
$$;

create trigger working_role_pay_history after insert or update on public.working_role_pay
  for each row execute function private.record_role_pay_history();
create trigger staff_role_pay_history after insert or update or delete on public.staff_role_pay
  for each row execute function private.record_role_pay_history();

-- What's there now is where history starts.
insert into public.working_role_pay_history (business_id, role_id, staff_id, effective_from, method, hourly_rate_cents, commission_pct)
select business_id, role_id, null, '-infinity', method, hourly_rate_cents, commission_pct from public.working_role_pay;
insert into public.working_role_pay_history (business_id, role_id, staff_id, effective_from, method, hourly_rate_cents, commission_pct)
select business_id, role_id, staff_id, '-infinity', null, hourly_rate_cents, commission_pct from public.staff_role_pay;

revoke all on function private.role_at(uuid, timestamptz) from public;
revoke all on function private.record_role_pay_history() from public;
