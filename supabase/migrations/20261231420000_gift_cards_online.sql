-- Clients and their gift cards online: adding a card to their account by
-- its code, and reloading one they hold by card. Both are the booking
-- site's (service role), after it has checked the client's session.

-- A card can be in an account because it was added by code (the holder),
-- whether or not it was a gift; a card that isn't a gift is otherwise the
-- buyer's.
alter table public.gift_cards
  alter column owner_client_id set expression as (coalesce(holder_client_id, case when is_gift then null else client_id end));

alter table public.gift_card_events drop constraint gift_card_events_kind_check;
alter table public.gift_card_events add constraint gift_card_events_kind_check
  check (kind in ('sold', 'issued', 'imported', 'redeemed', 'reloaded', 'refunded', 'adjusted', 'voided', 'added'));

-- Adds a card to a client's account by its code. Refused when it's in
-- someone else's account already, voided, expired or empty (one answer for
-- all of those and an unknown code, so codes can't be tested one by one;
-- the site limits tries as well).
create function public.add_account_gift_card(p_business_id uuid, p_client_id uuid, p_code text)
returns table (card_id uuid, balance_cents integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.gift_cards;
begin
  if not exists (select 1 from public.clients where id = p_client_id and business_id = p_business_id) then
    raise exception 'Not a client of this salon' using errcode = '42501';
  end if;
  select * into v_card from public.gift_cards g
  where g.business_id = p_business_id and g.code = private.gift_code(p_code)
  for update;
  if v_card.id is null or v_card.status <> 'active' or (v_card.expires_at is not null and v_card.expires_at <= now()) or v_card.balance_cents <= 0 then
    raise exception 'No gift card with money on it has that code' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_card.owner_client_id = p_client_id then
    return query select v_card.id, v_card.balance_cents;
    return;
  end if;
  if v_card.owner_client_id is not null then
    raise exception 'That gift card is in another account' using errcode = '55000', hint = 'taken';
  end if;
  update public.gift_cards set holder_client_id = p_client_id where id = v_card.id;
  insert into public.gift_card_events (card_id, business_id, kind, amount_cents, balance_after, reason)
  values (v_card.id, p_business_id, 'added', 0, v_card.balance_cents, 'Added to their online account');
  return query select v_card.id, v_card.balance_cents;
end;
$$;

-- Records a reload paid online, once its card charge has gone through: a
-- sale with the reload and a card payment taken online (processor), like
-- a membership renewal. The same charge recorded twice gives back the
-- first sale.
create function public.reload_gift_card_online(
  p_business_id uuid, p_location_id uuid, p_client_id uuid, p_card_id uuid,
  p_amount_cents integer, p_card_label text, p_provider text, p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.gift_cards;
  v_number integer;
  v_sale_id uuid;
begin
  select sale_id into v_sale_id from public.payments where business_id = p_business_id and processor_reference = p_reference;
  if v_sale_id is not null then
    return v_sale_id;
  end if;
  if p_amount_cents is null or p_amount_cents < 500 or p_amount_cents > 100000 then
    raise exception 'A reload is $5 to $1,000' using errcode = '22023';
  end if;
  if nullif(trim(p_reference), '') is null or nullif(trim(p_provider), '') is null then
    raise exception 'A reload needs its card charge' using errcode = '22023';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id and business_id = p_business_id) then
    raise exception 'Not a location of this salon' using errcode = '42501';
  end if;
  select * into v_card from public.gift_cards where id = p_card_id and business_id = p_business_id for update;
  if v_card.id is null or v_card.owner_client_id is distinct from p_client_id then
    raise exception 'That gift card isn''t in this account' using errcode = '42501';
  end if;
  if v_card.kind <> 'purchased' or v_card.status <> 'active' or (v_card.expires_at is not null and v_card.expires_at <= now()) then
    raise exception 'That gift card can''t be reloaded' using errcode = '55000', hint = 'not_reloadable';
  end if;

  update public.businesses set next_sale_number = next_sale_number + 1 where id = p_business_id returning next_sale_number - 1 into v_number;
  insert into public.sales (business_id, location_id, number, client_id, subtotal_cents, tax_cents, total_cents, note)
  values (p_business_id, p_location_id, v_number, p_client_id, p_amount_cents, 0, p_amount_cents, 'Gift card reloaded online')
  returning id into v_sale_id;
  insert into public.sale_items (sale_id, business_id, position, kind, description, quantity, unit_price_cents, tax_cents, total_cents, gift_card_id)
  values (v_sale_id, p_business_id, 1, 'gift_card_reload', 'Gift card reload', 1, p_amount_cents, 0, p_amount_cents, v_card.id);
  insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, processor, processor_reference)
  values (v_sale_id, p_business_id, p_location_id, 'card', p_amount_cents, left(coalesce(nullif(trim(p_card_label), ''), 'Card online'), 40), p_provider, left(p_reference, 200));
  insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail) values (v_sale_id, p_business_id, 'completed', p_amount_cents, 'Gift card reloaded online');
  perform private.move_gift_card(v_card, 'reloaded', p_amount_cents, v_sale_id, 'Online');
  return v_sale_id;
end;
$$;

revoke all on function public.add_account_gift_card(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reload_gift_card_online(uuid, uuid, uuid, uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.add_account_gift_card(uuid, uuid, text) to service_role;
grant execute on function public.reload_gift_card_online(uuid, uuid, uuid, uuid, integer, text, text, text) to service_role;
