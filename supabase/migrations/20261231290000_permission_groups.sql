-- Permission groups (Coterie's 3a): named sets of the switches owners can
-- change (lib/permissions.ts), given to people, edited once for everyone in
-- the group, and copied. The one rule stays private.can; for each switch it
-- now reads, in order:
-- 1. owners can do everything;
-- 2. the person's own switch (staff_permissions);
-- 3. their group's (permission_groups.permissions: switch → on or off; a
--    switch the group leaves out follows the role);
-- 4. the role's default.
-- A group never gives a role a switch it can't have (private.toggleable),
-- so one group can be shared by managers and the front desk. Denise, the
-- app and RLS all go through private.can, so they follow groups at once.
--
-- Owners make, change, copy and remove groups (save_permission_group,
-- delete_permission_group) and put people in them (set_staff_permission_group);
-- nothing writes them directly, and a trigger keeps anyone else from
-- changing a person's group through the staff row.

create table public.permission_groups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 60),
  permissions  jsonb not null default '{}' check (jsonb_typeof(permissions) = 'object'),
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, business_id),
  foreign key (updated_by, business_id) references public.staff (id, business_id) on delete set null (updated_by)
);

create unique index permission_groups_name on public.permission_groups (business_id, lower(trim(name)));

alter table public.permission_groups enable row level security;

alter table public.staff
  add column permission_group_id uuid,
  add constraint staff_permission_group_fk foreign key (permission_group_id, business_id)
    references public.permission_groups (id, business_id) on delete set null (permission_group_id);

create index staff_permission_group_idx on public.staff (permission_group_id) where permission_group_id is not null;

-- Those who manage the team see every group; anyone sees their own.
create policy "The team's groups for managers, your own for you" on public.permission_groups for select to authenticated
  using (
    business_id in (select private.businesses_with('team'))
    or id in (select s.permission_group_id from public.staff s where s.user_id = (select auth.uid()) and s.is_active)
  );

-- Only owners (or the server) change someone's group.
create function private.lock_staff_permission_group()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('maestra.setting_group', true), '') <> 'on'
     and (tg_op = 'INSERT' and new.permission_group_id is not null
          or tg_op = 'UPDATE' and new.permission_group_id is distinct from old.permission_group_id) then
    raise exception 'Only owners change someone''s permission group' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger staff_lock_permission_group before insert or update of permission_group_id on public.staff
  for each row execute function private.lock_staff_permission_group();

-- The switches a group may hold.
create function private.permission_toggles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts', 'see_team_numbers', 'adjust_points', 'audit'];
$$;

-- What the person has without their own switch: their group's, else the
-- role's default.
create function private.inherited_permission(p_staff_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.role = 'owner' then true
    when private.toggleable(s.role, p_permission) and g.permissions ? p_permission then (g.permissions ->> p_permission)::boolean
    else private.role_default(s.role, p_permission, s.business_id)
  end
  from public.staff s
  left join public.permission_groups g on g.id = s.permission_group_id
  where s.id = p_staff_id;
$$;

create or replace function private.staff_can(p_staff_id uuid, p_permission text)
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
      when g.permissions ? p_permission and private.toggleable(s.role, p_permission) then (g.permissions ->> p_permission)::boolean
      else private.role_default(s.role, p_permission, s.business_id)
    end
    from public.staff s
    left join public.staff_permissions p on p.staff_id = s.id and p.permission = p_permission
    left join public.permission_groups g on g.id = s.permission_group_id
    where s.id = p_staff_id and s.is_active
  ), false);
$$;

revoke all on function private.permission_toggles() from public;
revoke all on function private.inherited_permission(uuid, text) from public;
grant execute on function private.permission_toggles() to authenticated;

-- Each switch for one person: whether they have it, what their group or
-- role gives them (`inherited`), whether it's their own switch, and
-- whether it can be changed for their role. Owners and managers.
drop function public.staff_permission_list(uuid);

create function public.staff_permission_list(p_staff_id uuid)
returns table (permission text, allowed boolean, role_default boolean, inherited boolean, own boolean, toggleable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p,
         private.staff_can(s.id, p),
         private.role_default(s.role, p, s.business_id),
         private.inherited_permission(s.id, p),
         exists (select 1 from public.staff_permissions sp where sp.staff_id = s.id and sp.permission = p),
         private.toggleable(s.role, p)
  from public.staff s, unnest(private.permission_toggles()) p
  where s.id = p_staff_id and private.can(s.business_id, 'team');
$$;

revoke all on function public.staff_permission_list(uuid) from public, anon;
grant execute on function public.staff_permission_list(uuid) to authenticated;

-- An owner's switch for one person: kept only while it differs from what
-- their group or role gives them; null clears it (back to the group).
create or replace function public.set_staff_permission(p_staff_id uuid, p_permission text, p_allowed boolean)
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
  if p_allowed is null or p_allowed = private.inherited_permission(p_staff_id, p_permission) then
    delete from public.staff_permissions where staff_id = p_staff_id and permission = p_permission;
  else
    insert into public.staff_permissions (staff_id, business_id, permission, allowed, updated_by)
    values (p_staff_id, v_staff.business_id, p_permission, p_allowed, private.current_staff_id(v_staff.business_id))
    on conflict (staff_id, permission) do update set allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = now();
  end if;
end;
$$;

-- Make (p_id null) or change a group: a name and switch → on/off for the
-- switches it sets. Returns its id.
create function public.save_permission_group(p_business_id uuid, p_id uuid, p_name text, p_permissions jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_key text;
  v_value jsonb;
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners change permission groups' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 60 then
    raise exception 'Give the group a name' using errcode = '22023';
  end if;
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    raise exception 'Choose the group''s switches' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(p_permissions) loop
    if not v_key = any (private.permission_toggles()) or jsonb_typeof(v_value) <> 'boolean' then
      raise exception 'That isn''t a switch a group can hold' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from public.permission_groups g where g.business_id = p_business_id and lower(trim(g.name)) = lower(trim(p_name)) and g.id is distinct from p_id) then
    raise exception 'There''s already a group with that name' using errcode = '23505', hint = 'name_taken';
  end if;
  if p_id is null then
    insert into public.permission_groups (business_id, name, permissions, updated_by)
    values (p_business_id, trim(p_name), p_permissions, private.current_staff_id(p_business_id))
    returning id into v_id;
  else
    update public.permission_groups set name = trim(p_name), permissions = p_permissions, updated_by = private.current_staff_id(p_business_id), updated_at = now()
    where id = p_id and business_id = p_business_id
    returning id into v_id;
    if v_id is null then
      raise exception 'That group is gone' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- Remove a group: its people go back to their role's defaults (and their
-- own switches).
create function public.delete_permission_group(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.permission_groups where id = p_id;
  if v_business is null or not private.has_business_role(v_business, array['owner']::public.staff_role[]) then
    raise exception 'Only owners change permission groups' using errcode = '42501';
  end if;
  -- Its people's group is cleared by the foreign key, past the lock.
  perform set_config('maestra.setting_group', 'on', true);
  delete from public.permission_groups where id = p_id;
  perform set_config('maestra.setting_group', 'off', true);
end;
$$;

-- Put someone in a group, or none (p_group_id null). Never an owner.
create function public.set_staff_permission_group(p_staff_id uuid, p_group_id uuid)
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
    raise exception 'Only owners change someone''s permission group' using errcode = '42501';
  end if;
  if v_staff.role = 'owner' then
    raise exception 'Owners can always do everything' using errcode = '22023';
  end if;
  if p_group_id is not null and not exists (select 1 from public.permission_groups g where g.id = p_group_id and g.business_id = v_staff.business_id) then
    raise exception 'That group is gone' using errcode = 'P0002';
  end if;
  perform set_config('maestra.setting_group', 'on', true);
  update public.staff set permission_group_id = p_group_id where id = p_staff_id;
  perform set_config('maestra.setting_group', 'off', true);
end;
$$;

revoke all on function public.save_permission_group(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.delete_permission_group(uuid) from public, anon;
revoke all on function public.set_staff_permission_group(uuid, uuid) from public, anon;
grant execute on function public.save_permission_group(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.delete_permission_group(uuid) to authenticated;
grant execute on function public.set_staff_permission_group(uuid, uuid) to authenticated;
