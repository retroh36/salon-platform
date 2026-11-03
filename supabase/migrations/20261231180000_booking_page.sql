-- The booking site's intro and profiles (Settings → Booking page): a cover
-- photo for the salon, and for each stylist a one-line specialty, a short
-- bio and up to three portfolio photos; and a photo per service category.
-- Photos reuse the public buckets the booking site already shows: the cover
-- and category photos in `salon-logos`, portfolio photos in `staff-photos`,
-- each under the business id (their policies already check that folder).
-- The short description under the salon's name is the existing welcome line.

alter table public.online_booking_settings
  add column cover_path text check (length(cover_path) <= 300);

alter table public.staff
  add column specialty text check (length(specialty) <= 60),
  add column bio text check (length(bio) <= 400),
  add column portfolio_paths text[] not null default '{}'
    check (cardinality(portfolio_paths) <= 3 and array_position(portfolio_paths, null) is null);

-- One photo per category of the salon's menu (categories are services'
-- text, so a category with no services left just isn't shown).
create table public.service_category_photos (
  business_id uuid not null references public.businesses (id) on delete cascade,
  category    text not null check (length(category) between 1 and 100),
  photo_path  text not null check (length(photo_path) <= 300),
  updated_at  timestamptz not null default now(),
  primary key (business_id, category)
);

alter table public.service_category_photos enable row level security;

create policy "Members can view category photos"
  on public.service_category_photos for select to authenticated
  using (business_id in (select private.member_businesses()));
create policy "Owners can add category photos"
  on public.service_category_photos for insert to authenticated
  with check ((select private.can(business_id, 'settings')));
create policy "Owners can change category photos"
  on public.service_category_photos for update to authenticated
  using ((select private.can(business_id, 'settings')))
  with check ((select private.can(business_id, 'settings')));
create policy "Owners can remove category photos"
  on public.service_category_photos for delete to authenticated
  using ((select private.can(business_id, 'settings')));
