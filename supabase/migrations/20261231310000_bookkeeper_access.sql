-- What a bookkeeper sees (Coterie's 3b; the role is …_bookkeeper_role.sql):
-- the money, and none of the calendar or client details.
--
-- - Switches: Reports (and past sales, the close-out, Reconcile, Policy) and
--   the audit trail by default; Payroll and the data download only if an
--   owner turns them on (Payroll also changes pay rates). Never settings,
--   the team, voids, refunds, discounts, fees or points.
-- - Money they can read with Reports: every sale, payment and tip (already,
--   private.sees_sale), the close-outs and drawer counts, gift cards, fees,
--   points, packages and memberships, by their totals. Clients, visits,
--   events, formulas and photos stay front of house or a stylist's own
--   book, so a bookkeeper never reads a client's name or a visit.
-- - The calendar tables every member of a salon reads (blocked time,
--   call-outs, groups, series, saved views, chair loans, schedule
--   publishes, and what Denise has learned about the salon's days) are
--   closed to them. Working hours and approved time off
--   stay readable: hourly pay is worked out from them.

-- ---------------------------------------------------------------------------
-- Switches.
-- ---------------------------------------------------------------------------

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
    when p_role = 'bookkeeper' then p_permission in ('reports', 'audit')
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
    when 'bookkeeper' then p_permission in ('reports', 'payroll', 'export_data', 'audit')
    else false
  end;
$$;

-- Salons where the signed-in person is a bookkeeper, worked out once per
-- query.
create function private.bookkeeper_businesses() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.business_id from public.staff s
  where s.user_id = (select auth.uid()) and s.is_active and s.role = 'bookkeeper';
$$;

revoke all on function private.bookkeeper_businesses() from public;
grant execute on function private.bookkeeper_businesses() to authenticated;

-- ---------------------------------------------------------------------------
-- Money: readable with Reports (and the history with the audit trail).
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_qual text;
begin
  for r in
    select c.relname as tbl, p.polname as pol, extra
    from (values
      ('gift_cards', 'reports'), ('gift_card_events', 'both'), ('policy_fees', 'reports'), ('policy_fee_events', 'both'),
      ('reward_points', 'both'), ('client_packages', 'reports'), ('client_package_items', 'reports'), ('package_events', 'reports'),
      ('client_memberships', 'reports')
    ) as t(tbl, extra)
    join pg_class c on c.relname = t.tbl and c.relnamespace = 'public'::regnamespace
    join pg_policy p on p.polrelid = c.oid and p.polcmd = 'r'
  loop
    v_qual := pg_get_expr((select polqual from pg_policy where polrelid = ('public.' || r.tbl)::regclass and polname = r.pol), ('public.' || r.tbl)::regclass);
    execute format(
      'alter policy %I on public.%I using ((%s) or business_id in (select private.businesses_with(''reports''))%s)',
      r.pol, r.tbl, v_qual,
      case when r.extra = 'both' then ' or business_id in (select private.audit_businesses())' else '' end);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The calendar: closed to bookkeepers.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_qual text;
begin
  for r in
    select c.relname as tbl, p.polname as pol
    from pg_class c join pg_policy p on p.polrelid = c.oid and p.polcmd = 'r'
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('time_blocks', 'time_block_skips', 'schedule_disruptions', 'appointment_groups', 'appointment_series',
                        'calendar_views', 'station_assignments', 'schedule_publishes', 'insights')
  loop
    v_qual := pg_get_expr((select polqual from pg_policy where polrelid = ('public.' || r.tbl)::regclass and polname = r.pol), ('public.' || r.tbl)::regclass);
    execute format('alter policy %I on public.%I using ((%s) and business_id not in (select private.bookkeeper_businesses()))', r.pol, r.tbl, v_qual);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The close-out is the drawer counted at the salon: Reports, but never a
-- bookkeeper (they read it).
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text := pg_get_functiondef('public.save_closeout(uuid,date,integer,text,integer,integer)'::regprocedure);
  v_old text := 'if v_business_id is null or not private.can(v_business_id, ''reports'') then';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'save_closeout changed: update this migration';
  end if;
  execute replace(v_def, v_old,
    'if v_business_id is null or not private.can(v_business_id, ''reports'') or v_business_id in (select private.bookkeeper_businesses()) then');
end;
$$;
