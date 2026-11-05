-- Every change to a visit, written by the database itself (Coterie's audit
-- trail, docs/coterie-plan.md 2b): booked, moved, given to another stylist,
-- a service changed, added or removed, a price changed, the client changed,
-- and every status (checked in, checked out, canceled, no-show, put back),
-- each with who did it and what it was before. Triggers on appointments and
-- appointment_items write it, so no path (the calendar, online booking,
-- Denise's fixes, Mark out, imports moved later) can skip it. Nobody writes
-- it directly; the front of house reads it (the visit's History tab), and
-- so does anyone with the new `audit` permission (the Audit page).
--
-- Also: `audit`, a new permission (owners always; managers by default; an
-- owner can give it to the front desk), and the staff_permissions check
-- now allows `adjust_points`, which it never did (an owner's switch for it
-- couldn't be saved).

-- ---------------------------------------------------------------------------
-- The `audit` permission.
-- ---------------------------------------------------------------------------

alter table public.staff_permissions drop constraint staff_permissions_permission_check;
alter table public.staff_permissions add constraint staff_permissions_permission_check check (permission in (
  'settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts', 'see_team_numbers',
  'adjust_points', 'audit'));

create or replace function private.role_default(p_role public.staff_role, p_permission text, p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_role = 'owner' then true
    when p_permission in ('billing', 'delete_business') then false
    when p_permission in ('settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'big_discounts', 'see_team_numbers', 'adjust_points', 'audit')
      then p_role = 'manager'
    when p_permission = 'waive_fees'
      then p_role = any (coalesce((select ps.waive_roles from public.policy_settings ps where ps.business_id = p_business),
                                  array['owner', 'manager']::public.staff_role[]))
    else false
  end;
$$;

create or replace function private.toggleable(p_role public.staff_role, p_permission text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'manager' then p_permission in ('settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts', 'see_team_numbers', 'adjust_points', 'audit')
    when 'front_desk' then p_permission in ('reports', 'void_refund', 'waive_fees', 'big_discounts', 'adjust_points', 'audit')
    when 'stylist' then p_permission = 'see_team_numbers'
    else false
  end;
$$;

create or replace function public.my_permissions(p_business_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p order by p), '{}')
  from unnest(array['settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts',
                    'see_team_numbers', 'adjust_points', 'audit', 'billing', 'delete_business']) p
  where private.can(p_business_id, p);
$$;

create or replace function public.staff_permission_list(p_staff_id uuid)
returns table (permission text, allowed boolean, role_default boolean, toggleable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p, private.staff_can(s.id, p), private.role_default(s.role, p, s.business_id), private.toggleable(s.role, p)
  from public.staff s,
       unnest(array['settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts', 'see_team_numbers', 'adjust_points', 'audit']) p
  where s.id = p_staff_id and private.can(s.business_id, 'team');
$$;

-- Businesses where the signed-in person has `audit`, worked out once per
-- query (like private.businesses_with).
create or replace function private.audit_businesses() returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.business_id from public.staff s
  where s.user_id = (select auth.uid()) and s.is_active and private.can(s.business_id, 'audit');
$$;

revoke all on function private.audit_businesses() from public;
grant execute on function private.audit_businesses() to authenticated;

-- ---------------------------------------------------------------------------
-- The log.
-- ---------------------------------------------------------------------------

create table public.visit_changes (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null,
  appointment_id  uuid not null references public.appointments (id) on delete cascade,
  item_id         uuid,
  kind            text not null check (kind in ('booked', 'status', 'client', 'changed', 'service_added', 'service_removed')),
  -- What it was and what it became: only the fields that changed (starts_at,
  -- ends_at, staff_id, service_id, price_cents, status, client_id, …).
  before          jsonb not null default '{}',
  after           jsonb not null default '{}',
  -- Who: a team member, or the client themselves (online booking and their
  -- manage link), or the system (scheduled jobs, imports, seeds).
  by_staff_id     uuid,
  by_kind         text not null check (by_kind in ('staff', 'client', 'system')),
  created_at      timestamptz not null default now(),
  foreign key (by_staff_id, business_id) references public.staff (id, business_id) on delete set null (by_staff_id)
);

create index visit_changes_appointment_idx on public.visit_changes (appointment_id, created_at);
create index visit_changes_business_time_idx on public.visit_changes (business_id, created_at desc);
create index visit_changes_by_staff_idx on public.visit_changes (by_staff_id, created_at desc) where by_staff_id is not null;

alter table public.visit_changes enable row level security;

create policy "Front of house and auditors read visit changes" on public.visit_changes for select to authenticated
  using (business_id in (select private.front_of_house_businesses()) or business_id in (select private.audit_businesses()));

-- Who's making this change: the signed-in team member, else (service role)
-- the client for an online visit, else the system.
create function private.visit_actor(p_business uuid, p_source public.appointment_source, p_fallback uuid default null)
returns table (staff_id uuid, kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_id(p_business), p_fallback),
         case
           when coalesce(private.current_staff_id(p_business), p_fallback) is not null then 'staff'
           when (select auth.uid()) is null and p_source = 'online' then 'client'
           else 'system'
         end;
$$;

revoke all on function private.visit_actor(uuid, public.appointment_source, uuid) from public;

create function private.log_visit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := '{}';
  v_after  jsonb := '{}';
  v_staff  uuid;
  v_by     text;
begin
  -- The seeds' made-up history isn't anyone's change (they set this).
  if current_setting('maestra.seeding', true) = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    select a.staff_id, a.kind into v_staff, v_by from private.visit_actor(new.business_id, new.source, new.created_by) a;
    insert into public.visit_changes (business_id, location_id, appointment_id, kind, after, by_staff_id, by_kind)
    values (new.business_id, new.location_id, new.id, 'booked',
            jsonb_build_object('starts_at', new.starts_at, 'status', new.status, 'source', new.source), v_staff, v_by);
    return null;
  end if;
  if new.status is distinct from old.status then
    v_before := v_before || jsonb_build_object('status', old.status);
    v_after := v_after || jsonb_build_object('status', new.status) || case when new.cancel_reason is not null and new.status = 'canceled' then jsonb_build_object('reason', new.cancel_reason) else '{}' end;
  end if;
  if new.client_id is distinct from old.client_id then
    select a.staff_id, a.kind into v_staff, v_by from private.visit_actor(new.business_id, new.source) a;
    insert into public.visit_changes (business_id, location_id, appointment_id, kind, before, after, by_staff_id, by_kind)
    values (new.business_id, new.location_id, new.id, 'client', jsonb_build_object('client_id', old.client_id), jsonb_build_object('client_id', new.client_id), v_staff, v_by);
  end if;
  if v_after <> '{}' then
    select a.staff_id, a.kind into v_staff, v_by from private.visit_actor(new.business_id, new.source) a;
    insert into public.visit_changes (business_id, location_id, appointment_id, kind, before, after, by_staff_id, by_kind)
    values (new.business_id, new.location_id, new.id, 'status', v_before, v_after, v_staff, v_by);
  end if;
  return null;
end;
$$;

create trigger appointments_log_changes
  after insert or update of status, client_id on public.appointments
  for each row execute function private.log_visit_change();

create function private.log_visit_item_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.appointment_items := case when tg_op = 'DELETE' then old else new end;
  v_visit  public.appointments;
  v_before jsonb := '{}';
  v_after  jsonb := '{}';
  v_kind   text;
  v_staff  uuid;
  v_by     text;
begin
  -- The seeds' made-up history isn't anyone's change (they set this).
  if current_setting('maestra.seeding', true) = 'on' then
    return null;
  end if;
  select * into v_visit from public.appointments where id = v_row.appointment_id;
  -- Its own booking (the visit made in this same transaction) is 'booked';
  -- a visit already gone (deleted with its items) logs nothing.
  if v_visit.id is null or v_visit.created_at = now() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_kind := 'service_added';
    v_after := jsonb_build_object('service_id', new.service_id, 'staff_id', new.staff_id, 'starts_at', new.starts_at, 'ends_at', new.ends_at, 'price_cents', new.price_cents);
  elsif tg_op = 'DELETE' then
    v_kind := 'service_removed';
    v_before := jsonb_build_object('service_id', old.service_id, 'staff_id', old.staff_id, 'starts_at', old.starts_at, 'ends_at', old.ends_at, 'price_cents', old.price_cents);
  else
    if new.starts_at is distinct from old.starts_at then
      v_before := v_before || jsonb_build_object('starts_at', old.starts_at);
      v_after := v_after || jsonb_build_object('starts_at', new.starts_at);
    end if;
    if new.ends_at is distinct from old.ends_at then
      v_before := v_before || jsonb_build_object('ends_at', old.ends_at);
      v_after := v_after || jsonb_build_object('ends_at', new.ends_at);
    end if;
    if new.staff_id is distinct from old.staff_id then
      v_before := v_before || jsonb_build_object('staff_id', old.staff_id);
      v_after := v_after || jsonb_build_object('staff_id', new.staff_id);
    end if;
    if new.service_id is distinct from old.service_id then
      v_before := v_before || jsonb_build_object('service_id', old.service_id);
      v_after := v_after || jsonb_build_object('service_id', new.service_id);
    end if;
    if new.price_cents is distinct from old.price_cents then
      v_before := v_before || jsonb_build_object('price_cents', old.price_cents);
      v_after := v_after || jsonb_build_object('price_cents', new.price_cents);
    end if;
    if v_after = '{}' then
      return null;
    end if;
    v_kind := 'changed';
    -- Which service it is, for reading the line later.
    v_before := v_before || jsonb_build_object('service', old.service_id);
  end if;
  select a.staff_id, a.kind into v_staff, v_by from private.visit_actor(v_visit.business_id, v_visit.source) a;
  insert into public.visit_changes (business_id, location_id, appointment_id, item_id, kind, before, after, by_staff_id, by_kind)
  values (v_visit.business_id, v_visit.location_id, v_visit.id, v_row.id, v_kind, v_before, v_after, v_staff, v_by);
  return null;
end;
$$;

create trigger appointment_items_log_changes
  after insert or delete or update of starts_at, ends_at, staff_id, service_id, price_cents on public.appointment_items
  for each row execute function private.log_visit_item_change();

revoke all on function private.log_visit_change() from public;
revoke all on function private.log_visit_item_change() from public;
