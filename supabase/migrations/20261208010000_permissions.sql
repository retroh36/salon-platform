-- Roles and permissions.
--
-- Roles: owner (everything), manager (everything but Maestra billing,
-- deleting the business and managing owners), front desk (calendar,
-- check-in and out, checkout, clients, gift cards; sales from today only),
-- stylist (their own schedule, clients, tips, commission and goals) and
-- assistant (the day of the stylist they assist, staff.assists_staff_id).
--
-- Permissions are checked in one place, private.can(business, permission):
-- the role's default (private.role_default), unless an owner has switched
-- it for that person (staff_permissions, only where private.toggleable
-- allows, so nobody can be given an owner's powers). Owners can do
-- everything, always. The app reads the same answers (my_permissions).

-- ---------------------------------------------------------------------------
-- Assistants
-- ---------------------------------------------------------------------------

alter table public.staff
  add column assists_staff_id uuid references public.staff (id) on delete set null,
  add constraint staff_assists_not_self check (assists_staff_id is null or assists_staff_id <> id);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create table public.staff_permissions (
  staff_id    uuid not null references public.staff (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  permission  text not null check (permission in (
    'settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts', 'see_team_numbers')),
  allowed     boolean not null,
  updated_by  uuid references public.staff (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (staff_id, permission)
);

create index staff_permissions_business_id_idx on public.staff_permissions (business_id);

alter table public.staff_permissions enable row level security;

-- Read below, once private.can exists; written only by set_staff_permission.

-- What a role can do unless an owner changes it for someone.
create function private.role_default(p_role public.staff_role, p_permission text, p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_role = 'owner' then true
    when p_permission in ('billing', 'delete_business') then false
    when p_permission in ('settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'big_discounts', 'see_team_numbers')
      then p_role = 'manager'
    when p_permission = 'waive_fees'
      then p_role = any (coalesce((select ps.waive_roles from public.policy_settings ps where ps.business_id = p_business),
                                  array['owner', 'manager']::public.staff_role[]))
    else false
  end;
$$;

-- Which permissions an owner may switch on or off for someone in a role.
create function private.toggleable(p_role public.staff_role, p_permission text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'manager' then p_permission in ('settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts', 'see_team_numbers')
    when 'front_desk' then p_permission in ('reports', 'void_refund', 'waive_fees', 'big_discounts')
    when 'stylist' then p_permission = 'see_team_numbers'
    else false
  end;
$$;

create function private.staff_can(p_staff_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when s.role = 'owner' then true
      when p.allowed is not null and private.toggleable(s.role, p_permission) then p.allowed
      else private.role_default(s.role, p_permission, s.business_id)
    end
    from public.staff s
    left join public.staff_permissions p on p.staff_id = s.id and p.permission = p_permission
    where s.id = p_staff_id and s.is_active
  ), false);
$$;

-- Whether the signed-in person may do this at this salon.
create function private.can(p_business uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.staff_can(private.current_staff_id(p_business), p_permission);
$$;

revoke all on function private.role_default(public.staff_role, text, uuid) from public;
revoke all on function private.staff_can(uuid, text) from public;
revoke all on function private.can(uuid, text) from public;
grant execute on function private.role_default(public.staff_role, text, uuid) to authenticated;
grant execute on function private.toggleable(public.staff_role, text) to authenticated;
grant execute on function private.staff_can(uuid, text) to authenticated;
grant execute on function private.can(uuid, text) to authenticated;

create policy "The team's permissions for managers, your own for you" on public.staff_permissions
  for select to authenticated
  using ((select private.can(business_id, 'team')) or (select private.is_current_staff(business_id, staff_id)));

-- Everything the signed-in person can do here, for the app to show.
create function public.my_permissions(p_business_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p order by p), '{}')
  from unnest(array['settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts',
                    'see_team_numbers', 'billing', 'delete_business']) p
  where private.can(p_business_id, p);
$$;

-- Each permission for one person: whether they have it, the role's
-- default, and whether an owner can switch it. Owners and managers.
create function public.staff_permission_list(p_staff_id uuid)
returns table (permission text, allowed boolean, role_default boolean, toggleable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p, private.staff_can(s.id, p), private.role_default(s.role, p, s.business_id), private.toggleable(s.role, p)
  from public.staff s,
       unnest(array['settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts', 'see_team_numbers']) p
  where s.id = p_staff_id and private.can(s.business_id, 'team');
$$;

-- An owner switches one permission for someone (null puts it back to the
-- role's default). Never for an owner, and only what the role allows.
create function public.set_staff_permission(p_staff_id uuid, p_permission text, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null or not private.has_business_role(v_staff.business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners change permissions' using errcode = '42501';
  end if;
  if not private.toggleable(v_staff.role, p_permission) then
    raise exception 'That can''t be changed for this role' using errcode = '22023';
  end if;
  if p_allowed is null or p_allowed = private.role_default(v_staff.role, p_permission, v_staff.business_id) then
    delete from public.staff_permissions where staff_id = p_staff_id and permission = p_permission;
  else
    insert into public.staff_permissions (staff_id, business_id, permission, allowed, updated_by)
    values (p_staff_id, v_staff.business_id, p_permission, p_allowed, private.current_staff_id(v_staff.business_id))
    on conflict (staff_id, permission) do update set allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = now();
  end if;
end;
$$;

-- Owners and managers (with team) choose whose day an assistant sees.
create function public.set_assistant_stylist(p_staff_id uuid, p_stylist_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null or not private.can(v_staff.business_id, 'team') then
    raise exception 'Only owners and managers choose this' using errcode = '42501';
  end if;
  if v_staff.role <> 'assistant' and p_stylist_id is not null then
    raise exception 'Only assistants assist a stylist' using errcode = '22023';
  end if;
  if p_stylist_id is not null and not exists (
    select 1 from public.staff s where s.id = p_stylist_id and s.business_id = v_staff.business_id and s.role = 'stylist'
  ) then
    raise exception 'Choose a stylist at this salon' using errcode = '22023';
  end if;
  update public.staff set assists_staff_id = p_stylist_id where id = p_staff_id;
end;
$$;

revoke all on function public.my_permissions(uuid) from public, anon;
revoke all on function public.staff_permission_list(uuid) from public, anon;
revoke all on function public.set_staff_permission(uuid, text, boolean) from public, anon;
revoke all on function public.set_assistant_stylist(uuid, uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;
grant execute on function public.staff_permission_list(uuid) to authenticated;
grant execute on function public.set_staff_permission(uuid, text, boolean) to authenticated;
grant execute on function public.set_assistant_stylist(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The existing checks, moved onto permissions. Each swap must find exactly
-- the text expected, or the migration stops.
-- ---------------------------------------------------------------------------

create function private.swap_check(p_fn regprocedure, p_old text, p_new text, p_count integer default 1)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  v_found integer := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
begin
  if v_found <> p_count then
    raise exception '% has % of "%", expected %', p_fn, v_found, p_old, p_count;
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

do $$
declare
  v_owner text := ', array[''owner'']::public.staff_role[])';
  v_managers text := ', array[''owner'', ''manager'']::public.staff_role[])';
begin
  -- Salon settings: owners and managers.
  perform private.swap_check('public.set_checkout_settings(uuid,jsonb)', 'private.has_business_role(p_business_id' || v_owner, 'private.can(p_business_id, ''settings'')');
  perform private.swap_check('public.set_gift_card_settings(uuid,integer[],integer,integer)', 'private.has_business_role(p_business_id' || v_owner, 'private.can(p_business_id, ''settings'')');
  perform private.swap_check('public.save_membership_plan(uuid,uuid,jsonb)', 'private.has_business_role(p_business_id' || v_owner, 'private.can(p_business_id, ''settings'')');
  perform private.swap_check('public.save_automation(uuid,text,jsonb)', 'private.has_business_role(p_business_id' || v_owner, 'private.can(p_business_id, ''settings'')');
  perform private.swap_check('public.apply_automation_action(uuid)', 'private.has_business_role(v_action.business_id' || v_owner, 'private.can(v_action.business_id, ''settings'')');
  perform private.swap_check('public.undo_automation_action(uuid)', 'private.has_business_role(v_action.business_id' || v_owner, 'private.can(v_action.business_id, ''settings'')');
  perform private.swap_check('public.save_policy_settings(uuid,jsonb)', 'private.has_business_role(p_business_id' || v_owner, 'private.can(p_business_id, ''settings'')');
  perform private.swap_check('public.save_staff_policy(uuid,jsonb)', 'private.has_business_role(v_business' || v_owner, 'private.can(v_business, ''settings'')');
  perform private.swap_check('public.set_calendar_order(uuid,uuid[])', 'private.has_business_role(p_business_id' || v_owner, 'private.can(p_business_id, ''settings'')');
  perform private.swap_check('public.save_calendar_view(uuid,uuid,text,uuid[],boolean)', 'private.has_business_role(v_business' || v_owner, 'private.can(v_business, ''settings'')');
  perform private.swap_check('public.delete_calendar_view(uuid)', 'private.has_business_role(v_view.business_id' || v_owner, 'private.can(v_view.business_id, ''settings'')');

  -- The team, and goals for others.
  perform private.swap_check('public.save_team_member(uuid,uuid,uuid,jsonb)', 'private.has_business_role(p_business_id' || v_managers, 'private.can(p_business_id, ''team'')');
  perform private.swap_check('public.set_staff_active(uuid,boolean)', 'private.has_business_role(v_staff.business_id' || v_managers, 'private.can(v_staff.business_id, ''team'')');
  perform private.swap_check('public.team_logins(uuid)', 'private.has_business_role(p_business_id' || v_managers, 'private.can(p_business_id, ''team'')');
  perform private.swap_check('public.save_staff_goal(uuid,text,text,integer)', 'private.has_business_role(v_business' || v_owner, 'private.can(v_business, ''team'')');
  perform private.swap_check('public.delete_staff_goal(uuid)', 'private.has_business_role(v_goal.business_id' || v_owner, 'private.can(v_goal.business_id, ''team'')');

  -- Payroll and pay rates.
  perform private.swap_check('public.set_payroll_settings(uuid,text,date)', 'private.has_business_role(p_business_id' || v_owner, 'private.can(p_business_id, ''payroll'')');
  perform private.swap_check('public.payroll_sales(uuid,timestamp with time zone,timestamp with time zone,uuid)', 'private.has_business_role(p_business_id' || v_managers, 'private.can(p_business_id, ''payroll'')');

  -- Reports, the data export, voids and refunds, fees, big discounts.
  perform private.swap_check('public.save_closeout(uuid,date,integer,text,integer)', 'private.has_business_role(v_business_id' || v_owner, 'private.can(v_business_id, ''reports'')');
  perform private.swap_check('public.log_data_export(uuid,jsonb,integer)', 'private.has_business_role(p_business_id' || v_owner, 'private.can(p_business_id, ''export_data'')');
  perform private.swap_check('public.void_sale(uuid,text)', 'private.has_business_role(v_sale.business_id' || v_managers, 'private.can(v_sale.business_id, ''void_refund'')');
  perform private.swap_check('public.refund_sale(uuid,jsonb)', 'private.has_business_role(v_sale.business_id' || v_managers, 'private.can(v_sale.business_id, ''void_refund'')');
  perform private.swap_check('public.waive_policy_fee(uuid,text)', 'private.has_business_role(v_fee.business_id, v_roles)', 'private.can(v_fee.business_id, ''waive_fees'')');
  perform private.swap_check('public.complete_sale(uuid,jsonb)',
    E'not private.has_business_role(v_business.id, array[''owner'', ''manager'']::public.staff_role[])\n       and (v_discount + v_line_discounts)',
    E'not private.can(v_business.id, ''big_discounts'')\n       and (v_discount + v_line_discounts)');
end;
$$;

drop function private.swap_check(regprocedure, text, text, integer);

-- Policies for the same areas.
alter policy "Owners can update their business" on public.businesses
  using ((select private.can(id, 'settings'))) with check ((select private.can(id, 'settings')));
alter policy "Owners can manage form templates" on public.form_templates
  using ((select private.can(business_id, 'settings'))) with check ((select private.can(business_id, 'settings')));
alter policy "Owners can change online booking" on public.online_booking_settings
  using ((select private.can(business_id, 'settings'))) with check ((select private.can(business_id, 'settings')));
alter policy "Owners can set up online booking" on public.online_booking_settings
  with check ((select private.can(business_id, 'settings')));
alter policy "Owners can add packages" on public.package_templates
  with check ((select private.can(business_id, 'settings')));
alter policy "Owners can change packages" on public.package_templates
  using ((select private.can(business_id, 'settings'))) with check ((select private.can(business_id, 'settings')));
alter policy "Owners can set package services" on public.package_template_items
  using ((select private.can(business_id, 'settings'))) with check ((select private.can(business_id, 'settings')));
alter policy "Owners can add their salon's logo" on storage.objects
  with check (bucket_id = 'salon-logos' and (select private.can(private.logo_business(name), 'settings')));
alter policy "Owners can replace their salon's logo" on storage.objects
  using (bucket_id = 'salon-logos' and (select private.can(private.logo_business(name), 'settings')))
  with check (bucket_id = 'salon-logos' and (select private.can(private.logo_business(name), 'settings')));
alter policy "Owners can remove their salon's logo" on storage.objects
  using (bucket_id = 'salon-logos' and (select private.can(private.logo_business(name), 'settings')));
alter policy "Owners can view close-outs" on public.cash_closeouts
  using ((select private.can(business_id, 'reports')));
alter policy "Owners can view their data exports" on public.data_exports
  using ((select private.can(business_id, 'export_data')));

-- Managers manage everyone but owners, while they have the team.
alter policy "Owners and managers can add staff" on public.staff
  with check (
    (select private.has_business_role(business_id, array['owner']::public.staff_role[]))
    or (role <> 'owner' and (select private.has_business_role(business_id, array['manager']::public.staff_role[])) and (select private.can(business_id, 'team')))
  );
alter policy "Owners and managers can update staff" on public.staff
  using (
    (select private.has_business_role(business_id, array['owner']::public.staff_role[]))
    or (role <> 'owner' and (select private.has_business_role(business_id, array['manager']::public.staff_role[])) and (select private.can(business_id, 'team')))
  )
  with check (
    (select private.has_business_role(business_id, array['owner']::public.staff_role[]))
    or (role <> 'owner' and (select private.has_business_role(business_id, array['manager']::public.staff_role[])) and (select private.can(business_id, 'team')))
  );

alter policy "Managers and the staff member can view commission" on public.staff_compensation
  using ((select private.can(business_id, 'payroll')) or (select private.is_current_staff(business_id, staff_id)));
alter policy "Owners and managers can manage commission" on public.staff_compensation
  using ((select private.can(business_id, 'payroll'))) with check ((select private.can(business_id, 'payroll')));

-- Others' numbers: the team's goals and how long each stylist takes.
alter policy "Owners and managers see the team's goals, everyone their own" on public.staff_goals
  using (private.can(business_id, 'team') or private.can(business_id, 'see_team_numbers') or private.current_staff_id(business_id) = staff_id);

-- ---------------------------------------------------------------------------
-- Stylists and assistants: their own clients and visits only.
-- ---------------------------------------------------------------------------

-- The staff whose book the signed-in person sees: themselves, and the
-- stylist they assist.
create function private.my_book(p_business uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x) filter (where x is not null), '{}')
  from public.staff s, unnest(array[s.id, s.assists_staff_id]) x
  where s.business_id = p_business and s.user_id = (select auth.uid()) and s.is_active;
$$;

create function private.front_of_house(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_business_role(p_business, array['owner', 'manager', 'front_desk']::public.staff_role[]);
$$;

-- A client is on a stylist's book once they've had or booked a visit with
-- them (or the stylist they assist).
create function private.sees_client(p_business uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.front_of_house(p_business) or exists (
    select 1
    from public.appointments a
    join public.appointment_items i on i.appointment_id = a.id
    where a.client_id = p_client and a.business_id = p_business and i.staff_id = any (private.my_book(p_business))
  );
$$;

create function private.sees_visit(p_business uuid, p_appointment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.front_of_house(p_business) or exists (
    select 1 from public.appointment_items i
    where i.appointment_id = p_appointment and i.staff_id = any (private.my_book(p_business))
  );
$$;

revoke all on function private.my_book(uuid) from public;
revoke all on function private.front_of_house(uuid) from public;
revoke all on function private.sees_client(uuid, uuid) from public;
revoke all on function private.sees_visit(uuid, uuid) from public;
grant execute on function private.my_book(uuid) to authenticated;
grant execute on function private.front_of_house(uuid) to authenticated;
grant execute on function private.sees_client(uuid, uuid) to authenticated;
grant execute on function private.sees_visit(uuid, uuid) to authenticated;

alter policy "Members can view clients" on public.clients
  using ((select private.is_business_member(business_id)) and private.sees_client(business_id, id));
alter policy "Members can view appointments" on public.appointments
  using ((select private.is_business_member(business_id)) and private.sees_visit(business_id, id));
alter policy "Members can view appointment items" on public.appointment_items
  using ((select private.is_business_member(business_id)) and private.sees_visit(business_id, appointment_id));
alter policy "Members can view formulas" on public.client_formulas
  using ((select private.is_business_member(business_id)) and private.sees_client(business_id, client_id));
alter policy "Members can view signed forms" on public.client_forms
  using ((select private.is_business_member(business_id)) and private.sees_client(business_id, client_id));
alter policy "Members can view patch tests" on public.client_patch_tests
  using ((select private.is_business_member(business_id)) and private.sees_client(business_id, client_id));
alter policy "Members can view visit photos" on public.visit_photos
  using ((select private.is_business_member(business_id)) and private.sees_client(business_id, client_id));
alter policy "Members can view client memberships" on public.client_memberships
  using ((select private.is_business_member(business_id)) and private.sees_client(business_id, client_id));
alter policy "Members can view client packages" on public.client_packages
  using ((select private.is_business_member(business_id)) and private.sees_client(business_id, client_id));
alter policy "Members can view the waitlist" on public.waitlist_entries
  using ((select private.front_of_house(business_id)));
alter policy "Members can view walk-ins" on public.walk_ins
  using ((select private.front_of_house(business_id)));
alter policy "Members can see their salon's visit photo files" on storage.objects
  using (bucket_id = 'visit-photos' and (select private.is_business_member(private.logo_business(name)))
         and private.sees_client(private.logo_business(name),
               case when split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 2)::uuid end));

-- Time off says why (sick, vacation): the front of house sees everyone's,
-- anyone else their own.
alter policy "Members can view approved time off, and their own requests" on public.staff_time_off
  using (
    (select private.is_business_member(business_id))
    and (
      (status = 'approved' and (select private.front_of_house(business_id)))
      or (select private.is_current_staff(business_id, staff_id))
      or (select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]))
    )
  );

-- What Denise has learned: stylists see their own durations (others' with
-- see_team_numbers), their own clients' habits and the salon's patterns.
alter policy "Stylists can view their own durations, client habits and salon patterns" on public.insights
  using (
    (select private.is_business_member(business_id))
    and (
      kind = 'salon'
      or (kind = 'client' and private.sees_client(business_id, key::uuid))
      or (kind = 'duration' and (split_part(key, ':', 1)::uuid = any (private.my_book(business_id)) or private.can(business_id, 'see_team_numbers')))
    )
  );

-- ---------------------------------------------------------------------------
-- The front desk: today's sales; earlier ones are reports.
-- ---------------------------------------------------------------------------

create function private.local_day_start(p_location uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (date_trunc('day', now() at time zone l.timezone)) at time zone l.timezone
  from public.locations l where l.id = p_location;
$$;

create function private.sees_sale(p_business uuid, p_location uuid, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can(p_business, 'reports')
    or (private.front_of_house(p_business) and p_created_at >= private.local_day_start(p_location));
$$;

revoke all on function private.local_day_start(uuid) from public;
revoke all on function private.sees_sale(uuid, uuid, timestamptz) from public;
grant execute on function private.local_day_start(uuid) to authenticated;
grant execute on function private.sees_sale(uuid, uuid, timestamptz) to authenticated;

alter policy "Front of house can view sales" on public.sales
  using (private.sees_sale(business_id, location_id, created_at));
alter policy "Front of house can view sale items" on public.sale_items
  using (exists (select 1 from public.sales s where s.id = sale_id));
alter policy "Front of house can view tips" on public.sale_tips
  using (exists (select 1 from public.sales s where s.id = sale_id));
alter policy "Front of house can view payments" on public.payments
  using (exists (select 1 from public.sales s where s.id = sale_id));
alter policy "Front of house can view sale events" on public.sale_events
  using (exists (select 1 from public.sales s where s.id = sale_id));

-- Managers change the salon's settings, but its Maestra plan and AI limit
-- are billing (owners), and its pay period is payroll.
create function private.guard_business_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (new.plan is distinct from old.plan or new.ai_daily_token_limit is distinct from old.ai_daily_token_limit)
     and not private.can(new.id, 'billing') then
    raise exception 'Only owners change billing' using errcode = '42501';
  end if;
  if (new.pay_period is distinct from old.pay_period or new.pay_period_anchor is distinct from old.pay_period_anchor)
     and not private.can(new.id, 'payroll') then
    raise exception 'Only payroll changes the pay period' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger businesses_guard_columns before update on public.businesses
  for each row execute function private.guard_business_columns();
