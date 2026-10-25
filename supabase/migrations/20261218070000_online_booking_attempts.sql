-- One online booking attempt books one visit, however many times it's sent.
-- The booking page makes a random key for each attempt; a retry (the
-- connection dropped, a double tap) sends the same key. The first request
-- claims it; one that comes in while it's still booking is told to wait;
-- once booked, a repeat gets the same booking back. Only the key's sha256 is
-- kept. A failed attempt is let go, so trying again works; an attempt
-- abandoned mid-way (the server stopped) can be taken over after two
-- minutes. Service role only.

create table public.online_booking_attempts (
  business_id uuid not null references public.businesses (id) on delete cascade,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  appointment_id uuid references public.appointments (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  booked_at timestamptz,
  primary key (business_id, key_hash)
);

alter table public.online_booking_attempts enable row level security;
revoke all on public.online_booking_attempts from anon, authenticated;

-- 'new' (go ahead), 'pending' (another request is booking it) or 'booked'.
create function public.claim_online_booking_attempt(p_business_id uuid, p_key_hash text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_attempt public.online_booking_attempts;
begin
  insert into public.online_booking_attempts (business_id, key_hash) values (p_business_id, p_key_hash)
  on conflict do nothing;
  if found then
    return 'new';
  end if;
  select * into v_attempt from public.online_booking_attempts where business_id = p_business_id and key_hash = p_key_hash for update;
  if v_attempt.booked_at is not null then
    return 'booked';
  end if;
  if v_attempt.claimed_at < now() - interval '2 minutes' then
    update public.online_booking_attempts set claimed_at = now() where business_id = p_business_id and key_hash = p_key_hash;
    return 'new';
  end if;
  return 'pending';
end;
$$;

-- Booked (p_appointment_id), or let go when it didn't book (null).
create function public.finish_online_booking_attempt(p_business_id uuid, p_key_hash text, p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_appointment_id is null then
    delete from public.online_booking_attempts where business_id = p_business_id and key_hash = p_key_hash and booked_at is null;
  else
    update public.online_booking_attempts set appointment_id = p_appointment_id, booked_at = now()
    where business_id = p_business_id and key_hash = p_key_hash;
  end if;
end;
$$;

revoke all on function public.claim_online_booking_attempt(uuid, text) from public, anon, authenticated;
revoke all on function public.finish_online_booking_attempt(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_online_booking_attempt(uuid, text) to service_role;
grant execute on function public.finish_online_booking_attempt(uuid, text, uuid) to service_role;
