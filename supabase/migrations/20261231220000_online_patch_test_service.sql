-- Patch tests on the booking site: the service a patch test is done at
-- (Settings → Online booking, "Patch tests are done at"; the seed uses the
-- Color Consultation). A client without a patch test is offered it first,
-- and a color visit can then be booked online 48+ hours after it (the
-- salon's patch_test_min_hours), since it's booked. Checking in still needs
-- the result on file, as before (appointments_patch_test_on_arrival).
-- online_booking_settings already has RLS (owners write, members read).

alter table public.online_booking_settings
  add column patch_test_service_id uuid,
  add foreign key (patch_test_service_id, business_id) references public.services (id, business_id) on delete set null (patch_test_service_id);
