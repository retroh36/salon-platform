-- What Denise has learned (lib/insights/): stored so the app stays fast,
-- recalculated every night and after each checkout by the server (service
-- role), never written by staff.
--
--   duration      key "<staff id>:<service id>": how long the stylist takes
--   client        key "<client id>": habits, rebooking, reliability
--   client_spend  key "<client id>": lifetime and average spend, retail
--   salon         key "<location id>": busy times, overruns, no-shows,
--                 rebooking rates
--
-- Owners, managers and the front desk read everything. Stylists read
-- their own durations, client habits and the salon's patterns, but no
-- spend.

create table public.insights (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  kind         text not null check (kind in ('duration', 'client', 'client_spend', 'salon')),
  key          text not null check (length(key) between 1 and 100),
  data         jsonb not null,
  computed_at  timestamptz not null default now(),
  primary key (business_id, kind, key)
);

alter table public.insights enable row level security;

create policy "Front of house can view insights"
  on public.insights for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

create policy "Stylists can view their own durations, client habits and salon patterns"
  on public.insights for select to authenticated
  using (
    (select private.is_business_member(business_id))
    and (
      kind in ('client', 'salon')
      or (kind = 'duration' and split_part(key, ':', 1) = (select private.current_staff_id(business_id))::text)
    )
  );
