-- Working roles: what someone is doing in a stretch of their day ("Wash
-- House" in the morning, "Beauty Bar" in the afternoon), each salon's own.
-- A role says which services can be booked while someone works it (none
-- listed: all of theirs), whether that time shows on the booking site, and
-- how it's paid (the person's usual pay, hourly, or commission). Shifts
-- carry a role in a later migration; this one is the setup.
--
-- Pay is kept apart from the rest (working_role_pay, staff_role_pay), read
-- only with the `payroll` permission or by the person it pays, as rates are
-- elsewhere. Written only through the functions below.

create table public.working_roles (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 40),
  online       boolean not null default true,
  position     smallint not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (id, business_id)
);
create unique index working_roles_name_idx on public.working_roles (business_id, lower(trim(name))) where archived_at is null;

-- The services a role takes; none listed means all the person's services.
create table public.working_role_services (
  role_id      uuid not null,
  service_id   uuid not null,
  business_id  uuid not null,
  primary key (role_id, service_id),
  foreign key (role_id, business_id) references public.working_roles (id, business_id) on delete cascade,
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);

-- Who works which role.
create table public.staff_working_roles (
  staff_id     uuid not null,
  role_id      uuid not null,
  business_id  uuid not null,
  primary key (staff_id, role_id),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (role_id, business_id) references public.working_roles (id, business_id) on delete cascade
);

-- How a role pays: `usual` (the person's own pay, as without roles),
-- `hourly` (each hour in it at the rate; no commission on its services) or
-- `commission` (its services at the percent; its hours unpaid).
create table public.working_role_pay (
  role_id            uuid primary key,
  business_id        uuid not null,
  method             text not null default 'usual' check (method in ('usual', 'hourly', 'commission')),
  hourly_rate_cents  integer check (hourly_rate_cents between 0 and 100000),
  commission_pct     numeric(5, 2) check (commission_pct between 0 and 100),
  updated_at         timestamptz not null default now(),
  foreign key (role_id, business_id) references public.working_roles (id, business_id) on delete cascade,
  check (method <> 'hourly' or hourly_rate_cents is not null),
  check (method <> 'commission' or commission_pct is not null)
);

-- A person's own rate in a role, over the role's.
create table public.staff_role_pay (
  staff_id           uuid not null,
  role_id            uuid not null,
  business_id        uuid not null,
  hourly_rate_cents  integer check (hourly_rate_cents between 0 and 100000),
  commission_pct     numeric(5, 2) check (commission_pct between 0 and 100),
  updated_at         timestamptz not null default now(),
  primary key (staff_id, role_id),
  foreign key (staff_id, role_id) references public.staff_working_roles (staff_id, role_id) on delete cascade,
  check (hourly_rate_cents is not null or commission_pct is not null)
);

alter table public.working_roles enable row level security;
alter table public.working_role_services enable row level security;
alter table public.staff_working_roles enable row level security;
alter table public.working_role_pay enable row level security;
alter table public.staff_role_pay enable row level security;

create policy "The salon reads its roles" on public.working_roles
  for select to authenticated using (business_id in (select private.member_businesses()));
create policy "The salon reads its roles' services" on public.working_role_services
  for select to authenticated using (business_id in (select private.member_businesses()));
create policy "The salon reads who works which role" on public.staff_working_roles
  for select to authenticated using (business_id in (select private.member_businesses()));
create policy "Payroll and the role's people read its pay" on public.working_role_pay
  for select to authenticated using (
    business_id in (select private.businesses_with('payroll'))
    or role_id in (select r.role_id from public.staff_working_roles r where r.staff_id = (select private.current_staff_id(r.business_id)))
  );
create policy "Payroll and the person read their role pay" on public.staff_role_pay
  for select to authenticated using (
    business_id in (select private.businesses_with('payroll')) or staff_id = (select private.current_staff_id(business_id))
  );

-- Saves a role (p_role_id null adds one): its name, whether it's online,
-- its services (all of them replaced) and its place in the list; p_archive
-- takes it out of use (shifts keep it as history). The `settings`
-- permission.
create function public.save_working_role(
  p_business_id uuid, p_role_id uuid, p_name text, p_online boolean, p_service_ids uuid[], p_position integer default 0, p_archive boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_role_id;
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only those who manage settings can change working roles' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 40 then
    raise exception 'A role needs a name of up to 40 characters' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_service_ids, '{}')) s where s not in (select id from public.services where business_id = p_business_id)) then
    raise exception 'That service isn''t on the menu' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.working_roles (business_id, name, online, position)
    values (p_business_id, trim(p_name), coalesce(p_online, true), coalesce(p_position, 0))
    returning id into v_id;
    insert into public.working_role_pay (role_id, business_id) values (v_id, p_business_id);
  else
    update public.working_roles
    set name = trim(p_name), online = coalesce(p_online, true), position = coalesce(p_position, position),
        archived_at = case when p_archive then coalesce(archived_at, now()) else null end
    where id = v_id and business_id = p_business_id;
    if not found then
      raise exception 'No such role' using errcode = 'P0002';
    end if;
  end if;
  delete from public.working_role_services where role_id = v_id;
  insert into public.working_role_services (role_id, service_id, business_id)
  select v_id, s, p_business_id from (select distinct unnest(coalesce(p_service_ids, '{}')) s) x;
  return v_id;
exception when unique_violation then
  raise exception 'There''s already a role called %', trim(p_name) using errcode = '23505';
end;
$$;

-- How a role pays. The `payroll` permission.
create function public.save_working_role_pay(p_role_id uuid, p_method text, p_hourly_rate_cents integer, p_commission_pct numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.working_roles where id = p_role_id;
  if v_business is null then
    raise exception 'No such role' using errcode = 'P0002';
  end if;
  if not private.can(v_business, 'payroll') then
    raise exception 'Only those who run payroll can change how a role pays' using errcode = '42501';
  end if;
  if p_method not in ('usual', 'hourly', 'commission') then
    raise exception 'Pay is usual, hourly or commission' using errcode = '22023';
  end if;
  if p_method = 'hourly' and p_hourly_rate_cents is null then
    raise exception 'An hourly role needs its rate' using errcode = '22023', hint = 'rate';
  end if;
  if p_method = 'commission' and p_commission_pct is null then
    raise exception 'A commission role needs its percent' using errcode = '22023', hint = 'rate';
  end if;
  insert into public.working_role_pay (role_id, business_id, method, hourly_rate_cents, commission_pct, updated_at)
  values (p_role_id, v_business, p_method, p_hourly_rate_cents, p_commission_pct, now())
  on conflict (role_id) do update
  set method = excluded.method, hourly_rate_cents = excluded.hourly_rate_cents, commission_pct = excluded.commission_pct, updated_at = now();
end;
$$;

-- The roles a person works (all of them replaced). Those who manage the
-- team; a manager never for an owner.
create function public.set_staff_working_roles(p_staff_id uuid, p_role_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
  v_my_role public.staff_role;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null then
    raise exception 'No such team member' using errcode = 'P0002';
  end if;
  select role into v_my_role from public.staff where id = private.current_staff_id(v_staff.business_id);
  if v_my_role is null or not private.can(v_staff.business_id, 'team') or (v_staff.role = 'owner' and v_my_role <> 'owner') then
    raise exception 'Only someone who manages % can change their roles', v_staff.first_name using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_role_ids, '{}')) r
    where r not in (select id from public.working_roles where business_id = v_staff.business_id and archived_at is null)
  ) then
    raise exception 'That role isn''t in use' using errcode = '22023';
  end if;
  delete from public.staff_working_roles where staff_id = p_staff_id and role_id <> all (coalesce(p_role_ids, '{}'));
  insert into public.staff_working_roles (staff_id, role_id, business_id)
  select p_staff_id, r, v_staff.business_id from (select distinct unnest(coalesce(p_role_ids, '{}')) r) x
  on conflict do nothing;
end;
$$;

-- A person's own rate in a role (both null: the role's). The `payroll`
-- permission; a manager never for an owner.
create function public.set_staff_role_pay(p_staff_id uuid, p_role_id uuid, p_hourly_rate_cents integer, p_commission_pct numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
  v_my_role public.staff_role;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null then
    raise exception 'No such team member' using errcode = 'P0002';
  end if;
  select role into v_my_role from public.staff where id = private.current_staff_id(v_staff.business_id);
  if v_my_role is null or not private.can(v_staff.business_id, 'payroll') or (v_staff.role = 'owner' and v_my_role <> 'owner') then
    raise exception 'Only those who run payroll can change % rates', v_staff.first_name || '''s' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff_working_roles where staff_id = p_staff_id and role_id = p_role_id) then
    raise exception '% doesn''t work that role', v_staff.first_name using errcode = '22023', hint = 'not_their_role';
  end if;
  if p_hourly_rate_cents is null and p_commission_pct is null then
    delete from public.staff_role_pay where staff_id = p_staff_id and role_id = p_role_id;
  else
    insert into public.staff_role_pay (staff_id, role_id, business_id, hourly_rate_cents, commission_pct, updated_at)
    values (p_staff_id, p_role_id, v_staff.business_id, p_hourly_rate_cents, p_commission_pct, now())
    on conflict (staff_id, role_id) do update
    set hourly_rate_cents = excluded.hourly_rate_cents, commission_pct = excluded.commission_pct, updated_at = now();
  end if;
end;
$$;

revoke all on function public.save_working_role(uuid, uuid, text, boolean, uuid[], integer, boolean) from public, anon;
revoke all on function public.save_working_role_pay(uuid, text, integer, numeric) from public, anon;
revoke all on function public.set_staff_working_roles(uuid, uuid[]) from public, anon;
revoke all on function public.set_staff_role_pay(uuid, uuid, integer, numeric) from public, anon;
grant execute on function public.save_working_role(uuid, uuid, text, boolean, uuid[], integer, boolean) to authenticated;
grant execute on function public.save_working_role_pay(uuid, text, integer, numeric) to authenticated;
grant execute on function public.set_staff_working_roles(uuid, uuid[]) to authenticated;
grant execute on function public.set_staff_role_pay(uuid, uuid, integer, numeric) to authenticated;
