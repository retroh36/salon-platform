-- Which hours pay people paid by the hour: their scheduled hours (as
-- before, the default) or the hours they clocked. Owners choose, only
-- through set_payroll_hours, and every change is kept with who made it
-- (the Audit trail's pay entries).

alter table public.businesses
  add column payroll_hours text not null default 'scheduled' check (payroll_hours in ('scheduled', 'clocked'));

create table public.payroll_hours_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  from_basis text not null check (from_basis in ('scheduled', 'clocked')),
  to_basis text not null check (to_basis in ('scheduled', 'clocked')),
  by_staff_id uuid not null references public.staff (id),
  created_at timestamptz not null default now()
);
create index payroll_hours_changes_business on public.payroll_hours_changes (business_id, created_at desc);

alter table public.payroll_hours_changes enable row level security;
create policy "Payroll and the audit trail read payroll hours changes" on public.payroll_hours_changes for select to authenticated
using (
  business_id in (select private.businesses_with('payroll'))
  or business_id in (select private.businesses_with('audit'))
);
-- Written only by set_payroll_hours.

-- The column changes only through set_payroll_hours.
create or replace function private.guard_payroll_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payroll_hours is distinct from old.payroll_hours
     and (select auth.uid()) is not null
     and coalesce(current_setting('maestra.payroll_hours', true), '') <> 'on' then
    raise exception 'Payroll hours change only through set_payroll_hours' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger businesses_guard_payroll_hours
before update of payroll_hours on public.businesses
for each row execute function private.guard_payroll_hours();

create or replace function public.set_payroll_hours(p_business_id uuid, p_basis text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by uuid := private.current_staff_id(p_business_id);
  v_was text;
  v_clock boolean;
begin
  if v_by is null or not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners choose which hours pay' using errcode = '42501';
  end if;
  if p_basis is null or p_basis not in ('scheduled', 'clocked') then
    raise exception 'Choose scheduled or clocked hours' using errcode = '22023', hint = 'basis';
  end if;
  select payroll_hours, time_clock into v_was, v_clock from public.businesses where id = p_business_id for update;
  if v_was = p_basis then
    return;
  end if;
  if p_basis = 'clocked' and not v_clock then
    raise exception 'Turn on the time clock first' using errcode = '22023', hint = 'no_clock';
  end if;
  perform set_config('maestra.payroll_hours', 'on', true);
  update public.businesses set payroll_hours = p_basis where id = p_business_id;
  perform set_config('maestra.payroll_hours', 'off', true);
  insert into public.payroll_hours_changes (business_id, from_basis, to_basis, by_staff_id)
  values (p_business_id, v_was, p_basis, v_by);
end;
$$;

revoke all on function private.guard_payroll_hours() from public, anon, authenticated;
revoke all on function public.set_payroll_hours(uuid, text) from public, anon;
grant execute on function public.set_payroll_hours(uuid, text) to authenticated;
