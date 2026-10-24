-- Where online bookings come from: each place a salon shares its booking
-- link (Google, Instagram, Facebook, its website) gets a tagged link
-- (?src=…), as do automated messages; the booking site records the tag on
-- the visit and in the log, for Reports (lib/online-booking/sources.ts).

alter table public.appointments add column online_source text check (online_source ~ '^[a-z_]{1,30}$');
alter table public.online_booking_log add column source text check (source ~ '^[a-z_]{1,30}$');

create index appointments_online_source_idx on public.appointments (business_id, created_at) where source = 'online';

drop function public.save_online_appointment(uuid, uuid, uuid, text, jsonb, bigint, text);

create function public.save_online_appointment(
  p_location_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_notes text,
  p_items jsonb,
  p_expected_version bigint,
  p_manage_token_hash text,
  p_source text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment_id uuid;
begin
  if p_client_id is null then
    raise exception 'An online booking needs a client' using errcode = '22023';
  end if;
  if p_appointment_id is not null and not exists (
    select 1 from public.appointments a
    where a.id = p_appointment_id and a.manage_token_hash = p_manage_token_hash and a.client_id = p_client_id
      and a.status in ('booked', 'confirmed')
  ) then
    raise exception 'Appointment not found or can''t be changed' using errcode = 'P0002';
  end if;

  v_appointment_id := private.write_appointment(p_location_id, p_appointment_id, p_client_id, p_notes, p_items, p_expected_version, 'online', null);

  update public.appointments a set
    manage_token_hash = p_manage_token_hash,
    -- Where a new booking came from (a reschedule keeps the original's).
    online_source = case when p_appointment_id is null then p_source else a.online_source end,
    deposit_cents = coalesce((
      select sum(case s.deposit_kind
                   when 'fixed' then least(s.deposit_amount, i.price_cents)
                   when 'percent' then round(i.price_cents * s.deposit_amount / 100.0)::integer
                   else 0 end)
      from public.appointment_items i join public.services s on s.id = i.service_id
      where i.appointment_id = a.id
    ), 0)
  where a.id = v_appointment_id;
  return v_appointment_id;
end;
$$;

revoke all on function public.save_online_appointment(uuid, uuid, uuid, text, jsonb, bigint, text, text) from public, anon, authenticated;
grant execute on function public.save_online_appointment(uuid, uuid, uuid, text, jsonb, bigint, text, text) to service_role;
