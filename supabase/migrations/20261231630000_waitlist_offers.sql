-- Waitlist offers with one tap: when time opens up, the front of house taps
-- Offer by a waitlist client Denise matched to it, and the client gets the
-- salon's fixed message with a secure link (lib/waitlist-offers.ts,
-- /offer/<token>). Nothing goes unless staff tap it. The client takes the
-- time themselves (booked like an online booking, by the booking rules, so
-- two people can never get it) or says no thanks; either way the desk is
-- told in the app. An offer is held for the client until it expires; the
-- time itself isn't held, so whoever books it first has it. Only the
-- token's sha256 is kept.

create table public.waitlist_offers (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null references public.locations (id) on delete cascade,
  entry_id        uuid not null references public.waitlist_entries (id) on delete cascade,
  client_id       uuid not null,
  staff_id        uuid not null,
  starts_at       timestamptz not null,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  channel         text not null check (channel in ('sms', 'email')),
  sent_to         text not null check (length(sent_to) between 3 and 254),
  status          text not null default 'open' check (status in ('open', 'taken', 'declined', 'canceled')),
  expires_at      timestamptz not null,
  created_by      uuid references public.staff (id) on delete set null,
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  appointment_id  uuid references public.appointments (id) on delete set null,
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);
create index waitlist_offers_entry_idx on public.waitlist_offers (entry_id);
create index waitlist_offers_location_idx on public.waitlist_offers (location_id, starts_at);
create index waitlist_offers_business_idx on public.waitlist_offers (business_id);
create unique index waitlist_offers_one_open_idx on public.waitlist_offers (entry_id) where status = 'open';

alter table public.waitlist_offers enable row level security;
create policy "The front of house reads waitlist offers" on public.waitlist_offers
  for select to authenticated using (business_id in (select private.front_of_house_businesses()));

-- An offer to a waiting client for a time still to come. Any open offer to
-- them is replaced. It's held until p_minutes from now, and never past
-- 15 minutes before the time.
create function public.create_waitlist_offer(p_entry_id uuid, p_staff_id uuid, p_starts_at timestamptz, p_token_hash text, p_channel text, p_to text, p_minutes integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.waitlist_entries;
  v_until timestamptz;
  v_id uuid;
begin
  select * into v_e from public.waitlist_entries where id = p_entry_id for update;
  if v_e.id is null or not private.front_of_house(v_e.business_id) then
    raise exception 'Only the front of house can offer a waitlist spot' using errcode = '42501';
  end if;
  if v_e.status <> 'waiting' then
    raise exception 'That client is no longer on the waitlist' using errcode = '55000', hint = 'not_waiting';
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff_id and s.business_id = v_e.business_id and s.is_active) then
    raise exception 'Choose the stylist again' using errcode = '22023';
  end if;
  if p_minutes not between 5 and 1440 or p_channel not in ('sms', 'email') then
    raise exception 'Check the offer' using errcode = '22023';
  end if;
  v_until := least(now() + make_interval(mins => p_minutes), p_starts_at - interval '15 minutes');
  if v_until <= now() + interval '5 minutes' then
    raise exception 'That time is too soon to offer' using errcode = '55000', hint = 'too_soon';
  end if;
  update public.waitlist_offers set status = 'canceled', answered_at = now() where entry_id = p_entry_id and status = 'open';
  insert into public.waitlist_offers (business_id, location_id, entry_id, client_id, staff_id, starts_at, token_hash, channel, sent_to, expires_at, created_by)
  values (v_e.business_id, v_e.location_id, v_e.id, v_e.client_id, p_staff_id, p_starts_at, p_token_hash, p_channel, btrim(p_to), v_until,
          private.current_staff_id(v_e.business_id))
  returning id into v_id;
  return v_id;
end;
$$;

-- Staff take an offer back (it's then no longer open on the link).
create function public.cancel_waitlist_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.waitlist_offers;
begin
  select * into v_o from public.waitlist_offers where id = p_offer_id for update;
  if v_o.id is null or not private.front_of_house(v_o.business_id) then
    raise exception 'Only the front of house can cancel an offer' using errcode = '42501';
  end if;
  update public.waitlist_offers set status = 'canceled', answered_at = now() where id = p_offer_id and status = 'open';
end;
$$;

-- The client's answer from the link (the service role). Taking it records
-- the visit our code booked (by the booking rules, as an online booking),
-- and the client comes off the waitlist. Whoever sent it is told in the app.
create function public.answer_waitlist_offer(p_offer_id uuid, p_take boolean, p_appointment_id uuid, p_notice text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.waitlist_offers;
begin
  select * into v_o from public.waitlist_offers where id = p_offer_id for update;
  if v_o.id is null or v_o.status <> 'open' then
    raise exception 'This offer is no longer open' using errcode = '55000', hint = 'closed';
  end if;
  if v_o.expires_at <= now() then
    raise exception 'This offer has expired' using errcode = '55000', hint = 'expired';
  end if;
  if p_take and (p_appointment_id is null or not exists (
       select 1 from public.appointments a where a.id = p_appointment_id and a.client_id = v_o.client_id and a.business_id = v_o.business_id)) then
    raise exception 'Book the visit first' using errcode = '22023';
  end if;
  update public.waitlist_offers
    set status = case when p_take then 'taken' else 'declined' end, answered_at = now(), appointment_id = p_appointment_id
  where id = p_offer_id;
  if p_take then
    update public.waitlist_entries set status = 'booked', appointment_id = p_appointment_id where id = v_o.entry_id;
  end if;
  if v_o.created_by is not null and length(btrim(coalesce(p_notice, ''))) > 0 then
    insert into public.notifications (business_id, location_id, appointment_id, staff_id, channel, template, body, status)
    values (v_o.business_id, v_o.location_id, p_appointment_id, v_o.created_by, 'app',
            case when p_take then 'waitlist_offer_taken' else 'waitlist_offer_declined' end, left(p_notice, 1000), 'sent');
  end if;
end;
$$;

revoke all on function public.create_waitlist_offer(uuid, uuid, timestamptz, text, text, text, integer) from public, anon;
grant execute on function public.create_waitlist_offer(uuid, uuid, timestamptz, text, text, text, integer) to authenticated;
revoke all on function public.cancel_waitlist_offer(uuid) from public, anon;
grant execute on function public.cancel_waitlist_offer(uuid) to authenticated;
revoke all on function public.answer_waitlist_offer(uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.answer_waitlist_offer(uuid, boolean, uuid, text) to service_role;
