-- The salon's own brand: its name (businesses.name) and an optional logo,
-- shown at the top of the sidebar and on messages to its clients. Maestra
-- is the product brand around it (login, browser tab, platform emails).
--
-- Logos live in the public `salon-logos` bucket under <business_id>/, so
-- the sidebar can show them with a plain URL. Only the salon's owners can
-- add, replace or remove them.

alter table public.businesses
  add column logo_path text check (logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salon-logos', 'salon-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- A logo's folder is its business id.
create function private.logo_business(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end
$$;

create policy "Owners can add their salon's logo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'salon-logos' and (select private.has_business_role(private.logo_business(name), array['owner']::public.staff_role[])));
create policy "Owners can replace their salon's logo"
  on storage.objects for update to authenticated
  using (bucket_id = 'salon-logos' and (select private.has_business_role(private.logo_business(name), array['owner']::public.staff_role[])))
  with check (bucket_id = 'salon-logos' and (select private.has_business_role(private.logo_business(name), array['owner']::public.staff_role[])));
create policy "Owners can remove their salon's logo"
  on storage.objects for delete to authenticated
  using (bucket_id = 'salon-logos' and (select private.has_business_role(private.logo_business(name), array['owner']::public.staff_role[])));
-- The bucket is public for showing logos; listing goes through RLS too.
create policy "Members can see their salon's logo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'salon-logos' and (select private.is_business_member(private.logo_business(name))));
