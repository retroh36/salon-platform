-- Phase 1 foundation: businesses, locations and staff.
--
-- Tenancy model: a signed-in user belongs to a business when they have an
-- active staff row in it (staff.user_id = auth.uid()). Every RLS policy is
-- built on the helper functions below, so access rules live in one place.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.staff_role as enum ('owner', 'manager', 'front_desk', 'stylist');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  plan        text not null default 'trial',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.locations (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  address_line1  text,
  address_line2  text,
  city           text,
  region         text,
  postal_code    text,
  country        text not null default 'US',
  phone          text,
  -- IANA zone name, e.g. 'America/New_York'. Times are stored in UTC and
  -- shown in this zone.
  timezone       text not null,
  -- Opening hours keyed by weekday, e.g. {"mon": [{"open": "09:00", "close": "17:00"}]}
  hours          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Lets child tables enforce that their location is in the same business.
  unique (id, business_id)
);

create table public.staff (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  location_id  uuid not null,
  -- Login for this staff member, if they have one.
  user_id      uuid references auth.users (id) on delete set null,
  first_name   text not null check (length(trim(first_name)) > 0),
  last_name    text not null default '',
  email        text,
  phone        text,
  role         public.staff_role not null default 'stylist',
  -- Column color on the calendar.
  color        text check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (location_id, business_id)
    references public.locations (id, business_id) on delete cascade,
  unique (business_id, user_id)
);

create index locations_business_id_idx on public.locations (business_id);
create index staff_business_id_location_id_idx on public.staff (business_id, location_id);
create index staff_location_id_idx on public.staff (location_id, business_id);
create index staff_user_id_idx on public.staff (user_id) where user_id is not null;

create trigger businesses_set_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();
create trigger locations_set_updated_at before update on public.locations
  for each row execute function public.set_updated_at();
create trigger staff_set_updated_at before update on public.staff
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers
--
-- Kept in the `private` schema so they aren't exposed through the API.
-- security definer lets policies on `staff` look up staff rows without
-- recursing into staff's own RLS.
-- ---------------------------------------------------------------------------

create schema if not exists private;
grant usage on schema private to authenticated;

-- True when the current user is active staff in the business.
create function private.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    where s.business_id = target_business_id
      and s.user_id = (select auth.uid())
      and s.is_active
  );
$$;

-- True when the current user is active staff in the business with one of the roles.
create function private.has_business_role(target_business_id uuid, roles public.staff_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    where s.business_id = target_business_id
      and s.user_id = (select auth.uid())
      and s.is_active
      and s.role = any (roles)
  );
$$;

revoke all on function private.is_business_member(uuid) from public;
revoke all on function private.has_business_role(uuid, public.staff_role[]) from public;
grant execute on function private.is_business_member(uuid) to authenticated;
grant execute on function private.has_business_role(uuid, public.staff_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Anonymous users get nothing: every policy targets `authenticated` only.
-- Creating a business happens through a signup flow (later slice) that uses
-- the service role, so there is no insert policy on businesses yet.
-- ---------------------------------------------------------------------------

alter table public.businesses enable row level security;
alter table public.locations enable row level security;
alter table public.staff enable row level security;

-- businesses: members read; owners edit.
create policy "Members can view their business"
  on public.businesses for select to authenticated
  using ((select private.is_business_member(id)));

create policy "Owners can update their business"
  on public.businesses for update to authenticated
  using ((select private.has_business_role(id, array['owner']::public.staff_role[])))
  with check ((select private.has_business_role(id, array['owner']::public.staff_role[])));

-- locations: members read; owners and managers manage.
create policy "Members can view locations"
  on public.locations for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Owners and managers can add locations"
  on public.locations for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Owners and managers can update locations"
  on public.locations for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Owners can delete locations"
  on public.locations for delete to authenticated
  using ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));

-- staff: members read; owners and managers manage. Only owners can create,
-- promote to, or edit owner rows, so a manager can't escalate themselves.
create policy "Members can view staff"
  on public.staff for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Owners and managers can add staff"
  on public.staff for insert to authenticated
  with check (
    (select private.has_business_role(business_id, array['owner']::public.staff_role[]))
    or (
      role <> 'owner'
      and (select private.has_business_role(business_id, array['manager']::public.staff_role[]))
    )
  );

create policy "Owners and managers can update staff"
  on public.staff for update to authenticated
  using (
    (select private.has_business_role(business_id, array['owner']::public.staff_role[]))
    or (
      role <> 'owner'
      and (select private.has_business_role(business_id, array['manager']::public.staff_role[]))
    )
  )
  with check (
    (select private.has_business_role(business_id, array['owner']::public.staff_role[]))
    or (
      role <> 'owner'
      and (select private.has_business_role(business_id, array['manager']::public.staff_role[]))
    )
  );

create policy "Owners can remove staff"
  on public.staff for delete to authenticated
  using ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));
