-- Before and after photos on visits: files in the private `visit-photos`
-- bucket under <business_id>/<client_id>/, never public (shown through
-- short-lived signed URLs), a row per photo, and the client's consent to
-- use their photos in marketing, recorded with a date. Photos are never
-- sent to the AI.

-- The client's say-so for marketing use, and who recorded it.
alter table public.clients
  add column photo_consent_on date,
  add column photo_consent_by uuid references public.staff (id) on delete set null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Anyone at the salon adds and sees its photos; a file is removed by
-- whoever added it, or an owner or manager.
create policy "Members can add visit photo files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-photos' and (select private.is_business_member(private.logo_business(name))));
create policy "Members can see their salon's visit photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'visit-photos' and (select private.is_business_member(private.logo_business(name))));
create policy "The uploader or a manager can remove a visit photo file"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'visit-photos'
    and (
      (owner_id = (select auth.uid())::text and (select private.is_business_member(private.logo_business(name))))
      or (select private.has_business_role(private.logo_business(name), array['owner', 'manager']::public.staff_role[]))
    )
  );

create table public.visit_photos (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  client_id            uuid not null references public.clients (id) on delete cascade,
  appointment_id       uuid not null references public.appointments (id) on delete cascade,
  -- The visit's stylist (its first service), for the gallery.
  staff_id             uuid references public.staff (id) on delete set null,
  kind                 text not null check (kind in ('before', 'after')),
  storage_path         text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  marketing_ok         boolean not null default false,
  marketing_marked_by  uuid references public.staff (id) on delete set null,
  marketing_marked_at  timestamptz,
  created_by           uuid references public.staff (id) on delete set null,
  created_at           timestamptz not null default now()
);

create index visit_photos_client_idx on public.visit_photos (client_id, created_at desc);
create index visit_photos_appointment_idx on public.visit_photos (appointment_id);
create index visit_photos_business_idx on public.visit_photos (business_id);

alter table public.visit_photos enable row level security;

-- Read by the salon; written only through the functions below.
create policy "Members can view visit photos"
  on public.visit_photos for select to authenticated
  using ((select private.is_business_member(business_id)));

-- A photo just uploaded to <business>/<client>/<id>.<ext>, saved to the
-- visit. The file must be there, in the visit's client's folder.
create function public.add_visit_photo(p_appointment_id uuid, p_kind text, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments;
  v_me uuid;
  v_id uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id;
  if v_appt.id is null or not private.is_business_member(v_appt.business_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_appt.client_id is null then
    raise exception 'Photos are saved to a client; this visit has none' using errcode = '22023';
  end if;
  if p_kind not in ('before', 'after') then
    raise exception 'Say whether it''s before or after' using errcode = '22023';
  end if;
  if split_part(p_path, '/', 1) <> v_appt.business_id::text or split_part(p_path, '/', 2) <> v_appt.client_id::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'visit-photos' and o.name = p_path) then
    raise exception 'Upload the photo first' using errcode = '22023';
  end if;
  v_me := private.current_staff_id(v_appt.business_id);
  insert into public.visit_photos (business_id, client_id, appointment_id, staff_id, kind, storage_path, created_by)
  values (
    v_appt.business_id, v_appt.client_id, v_appt.id,
    (select i.staff_id from public.appointment_items i where i.appointment_id = v_appt.id order by i.starts_at, i.id limit 1),
    p_kind, p_path, v_me
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Removes the row (the caller then removes the file); returns its path.
-- Whoever added it, or an owner or manager.
create function public.delete_visit_photo(p_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.visit_photos;
begin
  select * into v_photo from public.visit_photos where id = p_photo_id;
  if v_photo.id is null
     or not (private.is_current_staff(v_photo.business_id, v_photo.created_by) or private.has_business_role(v_photo.business_id, array['owner', 'manager']::public.staff_role[])) then
    raise exception 'Only whoever added it, or a manager, can remove a photo' using errcode = '42501';
  end if;
  delete from public.visit_photos where id = p_photo_id;
  return v_photo.storage_path;
end;
$$;

-- The client's consent to marketing use, on a date (null withdraws it,
-- and takes every photo of theirs out of marketing).
create function public.set_photo_consent(p_client_id uuid, p_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.clients where id = p_client_id;
  if v_business is null or not private.is_business_member(v_business) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_on > current_date + 1 then
    raise exception 'Consent can''t be dated in the future' using errcode = '22023';
  end if;
  update public.clients set photo_consent_on = p_on, photo_consent_by = case when p_on is null then null else private.current_staff_id(v_business) end where id = p_client_id;
  if p_on is null then
    update public.visit_photos set marketing_ok = false, marketing_marked_by = private.current_staff_id(v_business), marketing_marked_at = now()
    where client_id = p_client_id and marketing_ok;
  end if;
end;
$$;

-- OK (or not) to use a photo in marketing: only with the client's consent.
create function public.set_photo_marketing(p_photo_id uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.visit_photos;
begin
  select * into v_photo from public.visit_photos where id = p_photo_id;
  if v_photo.id is null or not private.is_business_member(v_photo.business_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_ok and (select photo_consent_on from public.clients where id = v_photo.client_id) is null then
    raise exception 'Record the client''s consent first' using errcode = '55000', hint = 'photo_consent';
  end if;
  update public.visit_photos set marketing_ok = p_ok, marketing_marked_by = private.current_staff_id(v_photo.business_id), marketing_marked_at = now()
  where id = p_photo_id;
end;
$$;

revoke all on function public.add_visit_photo(uuid, text, text) from public, anon;
revoke all on function public.delete_visit_photo(uuid) from public, anon;
revoke all on function public.set_photo_consent(uuid, date) from public, anon;
revoke all on function public.set_photo_marketing(uuid, boolean) from public, anon;
grant execute on function public.add_visit_photo(uuid, text, text) to authenticated;
grant execute on function public.delete_visit_photo(uuid) to authenticated;
grant execute on function public.set_photo_consent(uuid, date) to authenticated;
grant execute on function public.set_photo_marketing(uuid, boolean) to authenticated;
