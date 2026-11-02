-- Short booking links: a special's text says maestra…/b/K7QM3XRP instead of
-- the booking site's address with a stylist's and every service's id. The
-- code opens the same page with the same choices (/b/<code>, read with the
-- service role). Not secret: anyone with one could find the booking site
-- anyway. The front of house makes them (with a special); nobody changes
-- or removes one, so a link already sent keeps working.
create table public.booking_links (
  code text primary key check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  business_id uuid not null references public.businesses (id) on delete cascade,
  staff_id uuid references public.staff (id) on delete set null,
  service_ids uuid[] not null default '{}' check (cardinality(service_ids) <= 4),
  source text not null check (source ~ '^[a-z_]{1,20}$'),
  created_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now()
);

create index booking_links_business on public.booking_links (business_id);

alter table public.booking_links enable row level security;

create policy "front of house read their salon's links" on public.booking_links
  for select to authenticated
  using (business_id in (select private.front_of_house_businesses()));

-- Made as yourself, for your own salon's stylist.
create policy "front of house make links" on public.booking_links
  for insert to authenticated
  with check (
    business_id in (select private.front_of_house_businesses())
    and created_by in (select s.id from public.staff s where s.user_id = (select auth.uid()) and s.business_id = booking_links.business_id)
    and (staff_id is null or staff_id in (select s.id from public.staff s where s.business_id = booking_links.business_id))
  );

grant select, insert on public.booking_links to authenticated;
