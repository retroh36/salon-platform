-- Card authorization: a family member's visits held by another member's
-- card on file, with that card's owner's consent, given by link.
--
-- The front of house asks (create_card_authorization: the two are in the
-- same family, the payer has a card on file of their own, the client has
-- none); the payer opens the link, reads the policy and what it covers,
-- types their name and approves or declines (answer_card_authorization,
-- service role). Approving gives the client a card on file of their own
-- (client_cards with authorization_id) pointing at the payer's card, with
-- the payer's agreement as its consent, so the cancellation policy (card
-- needed to book, fees) works as for any card. Never a card number: the
-- provider's token, as for every card.
--
-- It ends when staff end it (end_card_authorization), the payer's card is
-- removed or replaced, or the client's card from it is removed or replaced
-- by one of their own.

create table public.card_authorizations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  payer_client_id uuid not null,
  client_id       uuid not null,
  -- The payer's card it's for (their own, not one from another authorization).
  card_id         uuid not null references public.client_cards (id),
  status          text not null default 'open' check (status in ('open', 'approved', 'declined', 'canceled', 'ended')),
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  channel         text not null check (channel in ('sms', 'email')),
  sent_to         text not null check (length(sent_to) between 3 and 254),
  expires_at      timestamptz not null,
  created_by      uuid not null references public.staff (id),
  created_at      timestamptz not null default now(),
  -- The payer's answer: their typed name and what they read.
  signed_name     text check (length(btrim(signed_name)) between 2 and 120),
  agreed_text     text check (length(agreed_text) between 1 and 6000),
  ip_hash         text check (ip_hash ~ '^[0-9a-f]{32,64}$'),
  answered_at     timestamptz,
  ended_at        timestamptz,
  ended_by        uuid references public.staff (id) on delete set null,
  end_reason      text check (end_reason in ('staff', 'card_removed', 'own_card')),
  check (payer_client_id <> client_id),
  check (status <> 'approved' or (signed_name is not null and agreed_text is not null and answered_at is not null)),
  foreign key (payer_client_id, business_id) references public.clients (id, business_id) on delete cascade,
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade
);

-- At most one asked or in force per client.
create unique index card_authorizations_one_idx on public.card_authorizations (client_id) where status in ('open', 'approved');
create index card_authorizations_payer_idx on public.card_authorizations (payer_client_id);
create index card_authorizations_card_idx on public.card_authorizations (card_id) where status in ('open', 'approved');

alter table public.client_cards add column authorization_id uuid references public.card_authorizations (id);

alter table public.card_authorizations enable row level security;
create policy "Front of house see card authorizations" on public.card_authorizations for select to authenticated
  using (business_id in (select private.front_of_house_businesses()));
grant select on public.card_authorizations to authenticated;

-- The policy consent and card a client gets from an approved authorization
-- name the payer: "agreed by" in the text, and the card's label.

-- Asks the payer (front of house). Returns the authorization's id; the
-- app sends the link.
create function public.create_card_authorization(p_client_id uuid, p_payer_client_id uuid, p_token_hash text, p_channel text, p_to text, p_hours integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_payer public.clients;
  v_card uuid;
  v_id uuid;
begin
  select * into v_client from public.clients where id = p_client_id;
  select * into v_payer from public.clients where id = p_payer_client_id;
  if v_client.id is null or v_payer.id is null or v_client.business_id <> v_payer.business_id then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if not private.front_of_house(v_client.business_id) then
    raise exception 'Only owners, managers and front desk can ask for a card' using errcode = '42501';
  end if;
  if p_client_id = p_payer_client_id or v_client.family_id is null or v_client.family_id is distinct from v_payer.family_id then
    raise exception 'They need to be in the same family' using errcode = '22023', hint = 'family';
  end if;
  if exists (select 1 from public.client_cards where client_id = p_client_id and removed_at is null) then
    raise exception '% already has a card on file', v_client.first_name using errcode = '55000', hint = 'has_card';
  end if;
  select id into v_card from public.client_cards where client_id = p_payer_client_id and removed_at is null and authorization_id is null;
  if v_card is null then
    raise exception '% has no card of their own on file', v_payer.first_name using errcode = '55000', hint = 'no_card';
  end if;
  if p_hours not between 1 and 168 or p_channel not in ('sms', 'email') then
    raise exception 'Check the link' using errcode = '22023';
  end if;
  update public.card_authorizations set status = 'canceled' where client_id = p_client_id and status = 'open';
  insert into public.card_authorizations (business_id, payer_client_id, client_id, card_id, token_hash, channel, sent_to, expires_at, created_by)
  values (v_client.business_id, p_payer_client_id, p_client_id, v_card, p_token_hash, p_channel, btrim(p_to),
          now() + make_interval(hours => p_hours), private.current_staff_id(v_client.business_id))
  returning id into v_id;
  return v_id;
end;
$$;

-- The payer's answer from the link (service role). Approving records what
-- they read as the client's consent and gives the client a card on file
-- from the payer's; fees waiting for a card can then be tried.
create function public.answer_card_authorization(p_token_hash text, p_approve boolean, p_signed_name text, p_agreed_text text, p_terms jsonb, p_ip_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.card_authorizations;
  v_card public.client_cards;
  v_payer_name text;
  v_consent uuid;
begin
  select * into v_a from public.card_authorizations where token_hash = p_token_hash for update;
  if v_a.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if v_a.status <> 'open' then
    raise exception 'Already answered' using errcode = '55000', hint = 'used';
  end if;
  if v_a.expires_at <= now() then
    raise exception 'Expired' using errcode = '55000', hint = 'expired';
  end if;
  select * into v_card from public.client_cards where id = v_a.card_id;
  if v_card.removed_at is not null then
    raise exception 'The card has changed' using errcode = '55000', hint = 'card_changed';
  end if;
  if not p_approve then
    update public.card_authorizations set status = 'declined', answered_at = now(), ip_hash = p_ip_hash where id = v_a.id;
    return 'declined';
  end if;
  if length(btrim(coalesce(p_signed_name, ''))) not between 2 and 120 or length(coalesce(p_agreed_text, '')) not between 1 and 6000 or p_terms is null then
    raise exception 'Type your full name' using errcode = '22023', hint = 'name';
  end if;
  if exists (select 1 from public.client_cards where client_id = v_a.client_id and removed_at is null) then
    raise exception 'They have a card on file now' using errcode = '55000', hint = 'has_card';
  end if;
  select first_name into v_payer_name from public.clients where id = v_a.payer_client_id;

  update public.card_authorizations
  set status = 'approved', signed_name = btrim(p_signed_name), agreed_text = p_agreed_text, ip_hash = p_ip_hash, answered_at = now()
  where id = v_a.id;
  insert into public.policy_consents (business_id, client_id, policy_text, terms, channel, ip_hash)
  values (v_a.business_id, v_a.client_id, p_agreed_text, p_terms, 'link', p_ip_hash)
  returning id into v_consent;
  insert into public.client_cards (business_id, client_id, provider, payment_method_ref, label, consent_id, authorization_id)
  values (v_a.business_id, v_a.client_id, v_card.provider, v_card.payment_method_ref,
          left(v_card.label || ' (' || v_payer_name || '''s)', 60), v_consent, v_a.id);
  update public.policy_fees set status = 'pending', charge_after = now(), card_label = v_card.label
  where client_id = v_a.client_id and status = 'no_card';
  return 'approved';
end;
$$;

-- Ends one in force, or cancels one still asked (front of house).
create function public.end_card_authorization(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.card_authorizations;
begin
  select * into v_a from public.card_authorizations where id = p_id for update;
  if v_a.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if not private.front_of_house(v_a.business_id) then
    raise exception 'Only owners, managers and front desk can end it' using errcode = '42501';
  end if;
  if v_a.status = 'open' then
    update public.card_authorizations set status = 'canceled' where id = p_id;
    return;
  end if;
  if v_a.status <> 'approved' then
    return;
  end if;
  update public.card_authorizations set status = 'ended', ended_at = now(), ended_by = private.current_staff_id(v_a.business_id), end_reason = 'staff'
  where id = p_id;
  -- Takes the client's card from it off file (the trigger below sees it's ended).
  update public.client_cards set removed_at = now(), removed_by = private.current_staff_id(v_a.business_id)
  where authorization_id = p_id and removed_at is null;
end;
$$;

-- A card leaving file: the payer's ends what was authorized from it (and
-- cancels what's still asked); the client's own from an authorization ends
-- that authorization. Fees waiting on a card taken away wait again.
create function private.card_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.removed_at is not null or new.removed_at is null then
    return new;
  end if;
  if new.authorization_id is not null then
    update public.card_authorizations
    set status = 'ended', ended_at = coalesce(ended_at, now()), ended_by = coalesce(ended_by, new.removed_by),
        end_reason = coalesce(end_reason, case when exists (select 1 from public.client_cards c where c.client_id = new.client_id and c.removed_at is null and c.id <> new.id) then 'own_card' else 'staff' end)
    where id = new.authorization_id and status = 'approved';
    update public.policy_fees set status = 'no_card', charge_after = null where client_id = new.client_id and status = 'pending';
  else
    update public.card_authorizations set status = 'canceled' where card_id = new.id and status = 'open';
    update public.card_authorizations set status = 'ended', ended_at = now(), end_reason = 'card_removed'
    where card_id = new.id and status = 'approved';
    update public.client_cards set removed_at = now()
    where authorization_id in (select id from public.card_authorizations where card_id = new.id) and removed_at is null;
  end if;
  return new;
end;
$$;

create trigger client_cards_removed after update of removed_at on public.client_cards
  for each row execute function private.card_removed();

revoke all on function public.create_card_authorization(uuid, uuid, text, text, text, integer), public.end_card_authorization(uuid) from public, anon;
grant execute on function public.create_card_authorization(uuid, uuid, text, text, text, integer), public.end_card_authorization(uuid) to authenticated;
revoke all on function public.answer_card_authorization(text, boolean, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.answer_card_authorization(text, boolean, text, text, jsonb, text) to service_role;
revoke all on function private.card_removed() from public;
