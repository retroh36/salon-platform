-- Clients and their color formula history.
--
-- Search: generated lowercase name and digits-only phone columns with
-- trigram indexes, so partial matches ("pri sha", "4567") stay fast as the
-- client list grows.
--
-- Formulas are append-only: a dated entry per visit, attributed to the
-- staff member who wrote it. Corrections are made by adding a new entry.

create extension if not exists pg_trgm with schema extensions;
-- Lets one GIN index cover both business_id and the trigram search column.
create extension if not exists btree_gin with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  first_name          text not null check (length(trim(first_name)) > 0),
  last_name           text not null default '',
  email               text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone               text,
  -- Preferred stylist, if any.
  preferred_staff_id  uuid,
  preferences         text,
  notes               text,
  -- Shown prominently wherever the client appears.
  allergies           text,
  sms_opt_in          boolean not null default false,
  email_opt_in        boolean not null default false,
  -- Date the client signed the consent form; null if not signed.
  consent_signed_on   date,
  search_name         text generated always as (lower(first_name || ' ' || last_name)) stored,
  phone_digits        text generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, business_id),
  foreign key (preferred_staff_id, business_id)
    references public.staff (id, business_id) on delete set null (preferred_staff_id)
);

-- Alphabetical client list.
create index clients_business_id_search_name_idx on public.clients (business_id, search_name);
-- Partial-match search within one business.
create index clients_search_name_trgm_idx on public.clients using gin (business_id, search_name extensions.gin_trgm_ops);
create index clients_phone_digits_trgm_idx on public.clients using gin (business_id, phone_digits extensions.gin_trgm_ops);
create index clients_preferred_staff_id_idx on public.clients (preferred_staff_id) where preferred_staff_id is not null;

create table public.client_formulas (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  client_id    uuid not null,
  -- Who wrote it.
  staff_id     uuid not null,
  visit_date   date not null default current_date,
  formula      text not null check (length(trim(formula)) > 0),
  notes        text,
  created_at   timestamptz not null default now(),
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id),
  -- A day of slack covers locations ahead of UTC.
  constraint client_formulas_visit_date_not_future check (visit_date <= current_date + 1)
);

create index client_formulas_client_id_idx on public.client_formulas (client_id, visit_date desc);
create index client_formulas_business_id_idx on public.client_formulas (business_id);
create index client_formulas_staff_id_idx on public.client_formulas (staff_id);

create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- True when staff_id is the current user's own active staff row in the business.
create function private.is_current_staff(target_business_id uuid, target_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    where s.id = target_staff_id
      and s.business_id = target_business_id
      and s.user_id = (select auth.uid())
      and s.is_active
  );
$$;

revoke all on function private.is_current_staff(uuid, uuid) from public;
grant execute on function private.is_current_staff(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- clients: members read; owners, managers and front desk add and edit.
-- No delete for now (removing client data will be its own privacy flow).
--
-- client_formulas: members read; any member adds entries as themselves.
-- No update or delete: the history is append-only.
-- ---------------------------------------------------------------------------

alter table public.clients enable row level security;
alter table public.client_formulas enable row level security;

create policy "Members can view clients"
  on public.clients for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Front of house can add clients"
  on public.clients for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

create policy "Front of house can update clients"
  on public.clients for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

create policy "Members can view formulas"
  on public.client_formulas for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Members can add formulas as themselves"
  on public.client_formulas for insert to authenticated
  with check ((select private.is_current_staff(business_id, staff_id)));
