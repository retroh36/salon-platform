-- Who sees which visits, clients, insights and sales, worked out once per
-- query instead of once per row. The policies called private.sees_visit /
-- private.sees_client / private.can for every row they read (each a staff
-- lookup), which made the calendar, Dashboard and My day's reads 100 to 300
-- times slower than the rows themselves (about 600 ms for a few thousand
-- visits). These set-returning helpers run once per query (an uncorrelated
-- subquery, hashed), and the policies check membership in their result.
-- Who sees what is unchanged: the front of house sees every visit and
-- client at their salon; stylists and assistants their own book's
-- (private.my_book: themselves, or the stylist they assist); sales by
-- private.sees_sale's rules. tests/db/permissions.test.ts proves each role.

-- The salons where the signed-in person is active.
create function private.member_businesses() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.business_id from public.staff s where s.user_id = (select auth.uid()) and s.is_active;
$$;

-- The salons where they're front of house (private.front_of_house).
create function private.front_of_house_businesses() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.business_id from public.staff s
  where s.user_id = (select auth.uid()) and s.is_active and s.role in ('owner', 'manager', 'front_desk');
$$;

-- The salons where they have a permission (private.can).
create function private.businesses_with(p_permission text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select b from private.member_businesses() b where private.can(b, p_permission);
$$;

-- The staff in their book at each salon: themselves, and the stylist they
-- assist (private.my_book, for every salon at once).
create function private.my_book_staff() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select x from public.staff s, unnest(array[s.id, s.assists_staff_id]) x
  where s.user_id = (select auth.uid()) and s.is_active and x is not null;
$$;

-- The visits in their book (private.sees_visit without the front of house).
create function private.my_book_visits() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct i.appointment_id
  from public.staff s
  join public.appointment_items i on i.business_id = s.business_id and (i.staff_id = s.id or i.staff_id = s.assists_staff_id)
  where s.user_id = (select auth.uid()) and s.is_active;
$$;

-- The clients in their book (private.sees_client without the front of house).
create function private.my_book_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct a.client_id
  from public.staff s
  join public.appointment_items i on i.business_id = s.business_id and (i.staff_id = s.id or i.staff_id = s.assists_staff_id)
  join public.appointments a on a.id = i.appointment_id
  where s.user_id = (select auth.uid()) and s.is_active and a.client_id is not null;
$$;

revoke all on function private.member_businesses(), private.front_of_house_businesses(), private.businesses_with(text),
  private.my_book_staff(), private.my_book_visits(), private.my_book_clients() from public;
grant execute on function private.member_businesses(), private.front_of_house_businesses(), private.businesses_with(text),
  private.my_book_staff(), private.my_book_visits(), private.my_book_clients() to authenticated;

-- Visits.
alter policy "Members can view appointments" on public.appointments using (
  business_id in (select private.front_of_house_businesses()) or id in (select private.my_book_visits())
);
alter policy "Members can view appointment items" on public.appointment_items using (
  business_id in (select private.front_of_house_businesses()) or appointment_id in (select private.my_book_visits())
);

-- Clients, and what's kept about them.
alter policy "Members can view clients" on public.clients using (
  business_id in (select private.front_of_house_businesses()) or id in (select private.my_book_clients())
);
do $$
declare
  t text;
begin
  foreach t in array array['client_forms', 'client_formulas', 'client_memberships', 'client_packages', 'client_patch_tests', 'visit_photos'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and qual like '%sees_client(business_id, client_id)%') then
      raise exception '% has no sees_client policy to rewrite', t;
    end if;
    execute format(
      'alter policy %I on public.%I using (business_id in (select private.front_of_house_businesses()) or client_id in (select private.my_book_clients()))',
      (select policyname from pg_policies where schemaname = 'public' and tablename = t and qual like '%sees_client(business_id, client_id)%'), t
    );
  end loop;
end $$;
alter policy "Members can view package uses for clients they see" on public.client_package_items using (
  exists (
    select 1 from public.client_packages cp
    where cp.id = client_package_items.client_package_id
      and (cp.business_id in (select private.front_of_house_businesses()) or cp.client_id in (select private.my_book_clients()))
  )
);
alter policy "Members can view package history for clients they see" on public.package_events using (
  exists (
    select 1 from public.client_packages cp
    where cp.id = package_events.client_package_id
      and (cp.business_id in (select private.front_of_house_businesses()) or cp.client_id in (select private.my_book_clients()))
  )
);

-- What Denise has learned.
alter policy "Front of house can view insights" on public.insights using (
  business_id in (select private.front_of_house_businesses())
);
alter policy "Stylists can view their own durations, client habits and salon " on public.insights using (
  business_id in (select private.member_businesses())
  and (
    kind = 'salon'
    or (kind = 'client' and key in (select c::text from private.my_book_clients() c))
    or (
      kind = 'duration'
      and (split_part(key, ':', 1) in (select x::text from private.my_book_staff() x) or business_id in (select private.businesses_with('see_team_numbers')))
    )
  )
);

-- Sales: everything with reports, else today's at the front of house.
alter policy "Front of house can view sales" on public.sales using (
  business_id in (select private.businesses_with('reports'))
  or (business_id in (select private.front_of_house_businesses()) and created_at >= private.local_day_start(location_id))
);
