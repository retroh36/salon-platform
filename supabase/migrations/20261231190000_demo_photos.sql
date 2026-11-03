-- The demo salons' photos ship with the app (public/demo/), so a stylist's
-- portrait may also be one of those files, stored as its path from the
-- site's root ("/demo/team/gil.jpg"); any other photo is still a file in
-- Storage under the business id. The same rule as `isBundledPhoto` in
-- lib/branding.ts.

alter table public.staff drop constraint staff_photo_path_check;
alter table public.staff add constraint staff_photo_path_check check (
  photo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
  or photo_path ~ '^/demo/[a-z0-9-]+(/[a-z0-9-]+)*\.(jpg|png|webp)$'
);
