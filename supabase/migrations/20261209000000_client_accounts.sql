-- Client accounts on the booking site (/book/<slug>/account): a client signs
-- in with a one-time code or link sent to their email or phone (no
-- passwords) and sees their own visits, balances, card and message
-- preferences, at this salon only.
--
-- Fully separate from staff logins: no Supabase Auth user, no RLS role.
-- The booking site's server code (service role) holds the session: the
-- browser keeps a random token in a cookie scoped to this salon's booking
-- path, and only its sha256 is stored here. Every read is filtered by the
-- session's client and salon. Staff can see whether a client has an account.

create table public.client_accounts (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  client_id        uuid not null,
  -- How they first proved who they are.
  verified_channel text not null check (verified_channel in ('sms', 'email')),
  created_at       timestamptz not null default now(),
  last_sign_in_at  timestamptz,
  unique (business_id, client_id),
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade
);

create table public.client_sessions (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  account_id  uuid not null references public.client_accounts (id) on delete cascade,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  -- A keyed hash, like online_booking_log.
  ip_hash     text
);

create index client_sessions_account_idx on public.client_sessions (account_id);

-- A sign-in link, as well as the code (the same verification).
alter table public.online_verifications
  add column link_hash text unique check (link_hash ~ '^[0-9a-f]{64}$');

-- Clients add a card from their account (no staff member sent the link).
alter table public.card_requests alter column created_by drop not null;
alter table public.card_requests add column from_account boolean not null default false;
alter table public.card_requests add constraint card_requests_sender check (created_by is not null or from_account);

alter table public.client_accounts enable row level security;
alter table public.client_sessions enable row level security;

create policy "Front of house see who has an account" on public.client_accounts
  for select to authenticated using ((select private.front_of_house(business_id)));
-- client_sessions: no policies; only the service role.

-- A client removes their own card (service role, for the account page).
create function public.remove_own_card(p_business_id uuid, p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.client_cards set removed_at = now(), removed_by = null
  where business_id = p_business_id and client_id = p_client_id and removed_at is null;
  update public.policy_fees set status = 'no_card', charge_after = null
  where business_id = p_business_id and client_id = p_client_id and status = 'pending';
end;
$$;

revoke all on function public.remove_own_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_own_card(uuid, uuid) to service_role;
