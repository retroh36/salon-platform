-- Services and which staff offer them.
--
-- A service's time is three parts, so the scheduler can book other clients
-- into the processing gap (e.g. while color develops):
--   active_minutes      stylist busy (application, cutting)
--   processing_minutes  stylist free while the service processes
--   finishing_minutes   stylist busy again (rinse, blow-dry); only with processing
-- Prices are whole cents.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Lets child tables enforce that their staff member is in the same business.
alter table public.staff add constraint staff_id_business_id_key unique (id, business_id);

create table public.services (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  name                text not null check (length(trim(name)) > 0),
  category            text not null check (length(trim(category)) > 0),
  description         text,
  active_minutes      integer not null check (active_minutes > 0 and active_minutes % 5 = 0),
  processing_minutes  integer not null default 0 check (processing_minutes >= 0 and processing_minutes % 5 = 0),
  finishing_minutes   integer not null default 0 check (finishing_minutes >= 0 and finishing_minutes % 5 = 0),
  duration_minutes    integer generated always as (active_minutes + processing_minutes + finishing_minutes) stored,
  price_cents         integer not null check (price_cents >= 0),
  -- Archived services stay on past appointments but can't be booked.
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, business_id),
  constraint services_finishing_needs_processing check (processing_minutes > 0 or finishing_minutes = 0)
);

-- One active service per name in a business; archived ones don't count.
create unique index services_business_id_name_key
  on public.services (business_id, lower(trim(name)))
  where archived_at is null;
create index services_business_id_category_idx on public.services (business_id, category);

create table public.staff_services (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  staff_id     uuid not null,
  service_id   uuid not null,
  -- This stylist's price; null means the service's default price.
  price_cents  integer check (price_cents >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (staff_id, service_id),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);

create index staff_services_service_id_idx on public.staff_services (service_id, business_id);
create index staff_services_business_id_idx on public.staff_services (business_id);

create trigger services_set_updated_at before update on public.services
  for each row execute function public.set_updated_at();
create trigger staff_services_set_updated_at before update on public.staff_services
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: members read; owners and managers manage.
-- Services are archived, never deleted, so there is no delete policy.
-- ---------------------------------------------------------------------------

alter table public.services enable row level security;
alter table public.staff_services enable row level security;

create policy "Members can view services"
  on public.services for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Owners and managers can add services"
  on public.services for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Owners and managers can update services"
  on public.services for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Members can view who offers services"
  on public.staff_services for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Owners and managers can assign services"
  on public.staff_services for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Owners and managers can update service assignments"
  on public.staff_services for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create policy "Owners and managers can remove service assignments"
  on public.staff_services for delete to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

-- ---------------------------------------------------------------------------
-- save_service: create or update a service and set exactly which staff offer
-- it, in one transaction.
--
-- security invoker: runs as the caller, so the RLS policies above decide
-- whether they may do this.
--
-- p_staff is a JSON array of {"staff_id": uuid, "price_cents": int | null}.
-- Staff not in the array stop offering the service.
-- ---------------------------------------------------------------------------

create function public.save_service(
  p_business_id uuid,
  p_service_id uuid,
  p_name text,
  p_category text,
  p_description text,
  p_active_minutes integer,
  p_processing_minutes integer,
  p_finishing_minutes integer,
  p_price_cents integer,
  p_staff jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_service_id uuid;
begin
  if jsonb_typeof(p_staff) is distinct from 'array' then
    raise exception 'p_staff must be a JSON array' using errcode = '22023';
  end if;

  if p_service_id is null then
    insert into public.services (
      business_id, name, category, description,
      active_minutes, processing_minutes, finishing_minutes, price_cents
    ) values (
      p_business_id, trim(p_name), trim(p_category), nullif(trim(p_description), ''),
      p_active_minutes, p_processing_minutes, p_finishing_minutes, p_price_cents
    )
    returning id into v_service_id;
  else
    update public.services set
      name = trim(p_name),
      category = trim(p_category),
      description = nullif(trim(p_description), ''),
      active_minutes = p_active_minutes,
      processing_minutes = p_processing_minutes,
      finishing_minutes = p_finishing_minutes,
      price_cents = p_price_cents
    where id = p_service_id and business_id = p_business_id
    returning id into v_service_id;

    -- Not found, or RLS hid it / blocked the update.
    if v_service_id is null then
      raise exception 'Service not found or not editable' using errcode = '42501';
    end if;
  end if;

  delete from public.staff_services ss
  where ss.service_id = v_service_id
    and ss.staff_id not in (
      select (s ->> 'staff_id')::uuid from jsonb_array_elements(p_staff) s
    );

  insert into public.staff_services (business_id, staff_id, service_id, price_cents)
  select p_business_id, (s ->> 'staff_id')::uuid, v_service_id, (s ->> 'price_cents')::integer
  from jsonb_array_elements(p_staff) s
  on conflict (staff_id, service_id) do update
    set price_cents = excluded.price_cents
    where public.staff_services.price_cents is distinct from excluded.price_cents;

  return v_service_id;
end;
$$;

revoke all on function public.save_service(uuid, uuid, text, text, text, integer, integer, integer, integer, jsonb) from public, anon;
grant execute on function public.save_service(uuid, uuid, text, text, text, integer, integer, integer, integer, jsonb) to authenticated;
