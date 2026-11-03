-- The demo salons' invented logos ship with the app as SVGs
-- (public/demo/logos/), so a salon's logo may also be one of those files,
-- stored as its path from the site's root ("/demo/logos/maple-and-ash.svg");
-- an uploaded logo is still a file in Storage under the business id. The
-- same rule as `isBundledPhoto` in lib/branding.ts.

alter table public.businesses drop constraint businesses_logo_path_check;
alter table public.businesses add constraint businesses_logo_path_check check (
  logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
  or logo_path ~ '^/demo/logos/[a-z0-9-]+\.svg$'
);
