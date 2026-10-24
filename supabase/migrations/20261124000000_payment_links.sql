-- Text-to-pay: from checkout, staff send the client a payment link instead
-- of taking payment at the desk. The link opens a mobile page in the
-- salon's colors with the receipt, a tip for each stylist, and pay (through
-- the payment provider layer). When it's paid, the sale completes by
-- itself (the visit is checked out). Links expire, and work once.

create table public.payment_links (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  location_id         uuid not null references public.locations (id) on delete cascade,
  draft_id            uuid not null references public.sale_drafts (id) on delete cascade,
  client_id           uuid references public.clients (id) on delete set null,
  -- Only the token's hash: the link itself is only in the message.
  token_hash          text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status              text not null default 'open' check (status in ('open', 'paid', 'canceled')),
  -- The ticket as sent (what the page shows and what's completed), and its
  -- total before tips.
  snapshot            jsonb not null,
  amount_cents        integer not null check (amount_cents > 0),
  channel             text not null check (channel in ('sms', 'email')),
  sent_to             text not null check (length(sent_to) between 3 and 254),
  expires_at          timestamptz not null,
  tip_cents           integer check (tip_cents >= 0),
  provider            text,
  provider_reference  text check (length(provider_reference) <= 200),
  sale_id             uuid references public.sales (id) on delete set null,
  paid_at             timestamptz,
  canceled_at         timestamptz,
  created_by          uuid not null references public.staff (id),
  created_at          timestamptz not null default now()
);

create index payment_links_draft_idx on public.payment_links (draft_id);
create index payment_links_business_idx on public.payment_links (business_id, created_at desc);
-- One open link per checkout.
create unique index payment_links_one_open_idx on public.payment_links (draft_id) where status = 'open';

alter table public.payment_links enable row level security;

create policy "Front of house can view payment links" on public.payment_links for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- A link for an open checkout (any earlier open one is canceled).
create function public.create_payment_link(p_draft_id uuid, p_token_hash text, p_snapshot jsonb, p_amount_cents integer, p_channel text, p_to text, p_hours integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.sale_drafts;
  v_id uuid;
begin
  select * into v_draft from public.sale_drafts where id = p_draft_id for update;
  if v_draft.id is null or not private.has_business_role(v_draft.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to take payments' using errcode = '42501';
  end if;
  if v_draft.status <> 'open' then
    raise exception 'This checkout was already completed' using errcode = '55000';
  end if;
  if p_hours not between 1 and 72 then
    raise exception 'A link lasts 1 to 72 hours' using errcode = '22023';
  end if;
  update public.payment_links set status = 'canceled', canceled_at = now() where draft_id = p_draft_id and status = 'open';
  insert into public.payment_links (business_id, location_id, draft_id, client_id, token_hash, snapshot, amount_cents, channel, sent_to, expires_at, created_by)
  values (v_draft.business_id, v_draft.location_id, v_draft.id, v_draft.client_id, p_token_hash, p_snapshot, p_amount_cents, p_channel, trim(p_to),
          now() + make_interval(hours => p_hours), private.current_staff_id(v_draft.business_id))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.cancel_payment_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.payment_links;
begin
  select * into v_link from public.payment_links where id = p_link_id for update;
  if v_link.id is null or not private.has_business_role(v_link.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_link.status <> 'open' then
    raise exception 'This link was already paid or canceled' using errcode = '55000';
  end if;
  update public.payment_links set status = 'canceled', canceled_at = now() where id = v_link.id;
end;
$$;

-- The client paid (the provider took p_total_cents): the sale completes
-- through complete_sale, as the staff member who sent the link, so every
-- rule is checked again; then the payment is marked as taken online. Once
-- only, and not after it expires. Service role.
create function public.complete_payment_link(p_link_id uuid, p_tips jsonb, p_total_cents integer, p_provider text, p_reference text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.payment_links;
  v_user uuid;
  v_sale_id uuid;
  v_tips integer := 0;
begin
  select * into v_link from public.payment_links where id = p_link_id for update;
  if v_link.id is null then
    raise exception 'Link not found' using errcode = 'P0002';
  end if;
  if v_link.status <> 'open' then
    raise exception 'This link was already used' using errcode = '55000', hint = 'used';
  end if;
  if v_link.expires_at <= now() then
    raise exception 'This link has expired' using errcode = '55000', hint = 'expired';
  end if;
  select coalesce(sum((t ->> 'amount_cents')::int), 0) into v_tips from jsonb_array_elements(coalesce(p_tips, '[]')) t;
  select user_id into v_user from public.staff where id = v_link.created_by and is_active;
  if v_user is null then
    raise exception 'The staff member who sent this link can''t take payments now' using errcode = '42501';
  end if;
  -- complete_sale checks who's asking: the sender, for this transaction only.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  v_sale_id := public.complete_sale(v_link.location_id, (v_link.snapshot -> 'input') || jsonb_build_object(
    'draft_id', v_link.draft_id,
    'tips', coalesce(p_tips, '[]'),
    'payments', jsonb_build_array(jsonb_build_object('method', 'card', 'amount_cents', p_total_cents, 'reference', 'Payment link'))
  ));
  perform set_config('request.jwt.claim.sub', '', true);
  update public.payments set processor = p_provider, processor_reference = left(p_reference, 200) where sale_id = v_sale_id and method = 'card' and amount_cents > 0;
  update public.payment_links set status = 'paid', paid_at = now(), canceled_at = null, sale_id = v_sale_id, tip_cents = v_tips, provider = p_provider, provider_reference = left(p_reference, 200)
  where id = v_link.id;
  return v_sale_id;
end;
$$;

-- Paid at the desk after all: the link stops working.
create function private.cancel_links_on_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.payment_links set status = 'canceled', canceled_at = now() where draft_id = new.id and status = 'open';
  return new;
end;
$$;

create trigger sale_drafts_cancel_links after update of status on public.sale_drafts
  for each row when (old.status = 'open' and new.status = 'completed')
  execute function private.cancel_links_on_completion();

revoke all on function private.cancel_links_on_completion() from public;
revoke all on function public.create_payment_link(uuid, text, jsonb, integer, text, text, integer) from public, anon;
revoke all on function public.cancel_payment_link(uuid) from public, anon;
revoke all on function public.complete_payment_link(uuid, jsonb, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_payment_link(uuid, text, jsonb, integer, text, text, integer) to authenticated;
grant execute on function public.cancel_payment_link(uuid) to authenticated;
grant execute on function public.complete_payment_link(uuid, jsonb, integer, text, text) to service_role;
