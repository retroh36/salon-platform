-- The Clients list's columns: each client's last visit (the latest checked
-- out), next visit (the soonest booked, confirmed or in the chair that
-- isn't over), usual stylist and spend (from what Denise has learned), so
-- the list can sort by any of them across every client, not just a page.
--
-- Security invoker: it runs as the signed-in member, so RLS decides what
-- they see, the same as reading the tables themselves. Stylists and
-- assistants get the clients and visits of their own book, and no spend
-- (they can't read client_spend insights).
create function public.client_overview()
returns table (
  id uuid,
  business_id uuid,
  first_name text,
  last_name text,
  phone text,
  email text,
  allergies text,
  search_name text,
  phone_digits text,
  last_visit_at timestamptz,
  next_visit_at timestamptz,
  usual_staff_id uuid,
  usual_staff_name text,
  spend_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.business_id, c.first_name, c.last_name, c.phone, c.email, c.allergies, c.search_name, c.phone_digits,
    (select max(a.starts_at) from public.appointments a where a.client_id = c.id and a.status = 'completed'),
    (select min(a.starts_at) from public.appointments a where a.client_id = c.id and a.status in ('booked', 'confirmed', 'checked_in') and a.ends_at > now()),
    st.id,
    st.first_name || ' ' || st.last_name,
    (s.data ->> 'lifetimeSpendCents')::bigint
  from public.clients c
  left join public.insights h on h.business_id = c.business_id and h.kind = 'client' and h.key = c.id::text
  left join public.staff st on st.id = nullif(h.data ->> 'preferredStaffId', '')::uuid
  left join public.insights s on s.business_id = c.business_id and s.kind = 'client_spend' and s.key = c.id::text
$$;

revoke execute on function public.client_overview() from public, anon;
grant execute on function public.client_overview() to authenticated;
