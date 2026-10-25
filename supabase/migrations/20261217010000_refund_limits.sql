-- Refunds never give out more than the sale took in money:
-- * refund_sale: package uses and membership services can't come back in
--   any form, a purchased gift card counts as money (so credit can't be
--   turned into a spendable balance), and promotional credit can only go
--   back onto a promotional card.
-- * cancel_package: the refund for unused uses is capped by what's left
--   to refund on the sale that sold it, so a package whose sale was
--   already refunded (or voided) doesn't pay out a second time.

CREATE OR REPLACE FUNCTION public.refund_sale(p_sale_id uuid, p_input jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sale public.sales;
  v_me uuid;
  v_reason text := nullif(trim(p_input ->> 'reason'), '');
  v_pay jsonb;
  v_amount integer := 0;
  v_cash_like integer := 0;
  v_promo_paid integer;
  v_ret jsonb;
  v_item public.sale_items;
  v_card public.gift_cards;
  v_credit_paid integer;
  v_kind public.gift_card_kind;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if v_sale.id is null or not private.can(v_sale.business_id, 'void_refund') then
    raise exception 'Only managers and owners can refund' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v_sale.status not in ('completed', 'partly_refunded') then
    raise exception 'This sale was already refunded or voided' using errcode = '55000';
  end if;
  v_me := private.current_staff_id(v_sale.business_id);

  for v_pay in select * from jsonb_array_elements(coalesce(p_input -> 'payments', '[]')) loop
    if coalesce((v_pay ->> 'amount_cents')::int, 0) <= 0 or v_pay ->> 'method' not in ('cash', 'card', 'gift_card') then
      raise exception 'Enter each refund''s amount and how it was given' using errcode = '22023';
    end if;
    v_amount := v_amount + (v_pay ->> 'amount_cents')::int;
    -- Money is cash, card or a purchased gift card; only promotional
    -- credit can go back onto a promotional card.
    v_kind := null;
    if v_pay ->> 'method' = 'gift_card' then
      select kind into v_kind from public.gift_cards where business_id = v_sale.business_id and code = private.gift_code(v_pay ->> 'code');
    end if;
    if v_kind is distinct from 'promotional' then v_cash_like := v_cash_like + (v_pay ->> 'amount_cents')::int; end if;
  end loop;
  if v_amount = 0 then
    raise exception 'Enter how much to refund' using errcode = '22023';
  end if;
  if v_sale.refunded_cents + v_amount > v_sale.total_cents then
    raise exception 'That''s more than was paid' using errcode = '22023';
  end if;
  -- Promotional credit has no cash value, and package uses go back on the
  -- package (cancel it for a refund), not out as money.
  select coalesce(sum(p.amount_cents) filter (where g.kind = 'promotional'), 0), coalesce(sum(p.amount_cents) filter (where p.method::text in ('package', 'membership')), 0)
  into v_promo_paid, v_credit_paid
  from public.payments p left join public.gift_cards g on g.id = p.gift_card_id
  where p.sale_id = p_sale_id and p.amount_cents > 0;
  if v_sale.refunded_cents + v_amount > v_sale.total_cents - v_credit_paid
     or (v_cash_like > 0 and v_sale.refunded_cents + v_cash_like > v_sale.total_cents - v_promo_paid - v_credit_paid) then
    raise exception 'Promotional credit, package uses and membership services can''t be refunded as cash or card' using errcode = '22023';
  end if;

  for v_ret in select * from jsonb_array_elements(coalesce(p_input -> 'returns', '[]')) loop
    select * into v_item from public.sale_items where id = (v_ret ->> 'sale_item_id')::uuid and sale_id = p_sale_id and kind = 'product' for update;
    if v_item.id is null or coalesce((v_ret ->> 'quantity')::int, 0) < 1 or v_item.returned_quantity + (v_ret ->> 'quantity')::int > v_item.quantity then
      raise exception 'Those products weren''t on the sale' using errcode = '22023';
    end if;
    update public.sale_items set returned_quantity = returned_quantity + (v_ret ->> 'quantity')::int where id = v_item.id;
    if coalesce((p_input ->> 'restock')::boolean, true) then
      perform private.move_stock(v_sale.location_id, v_item.product_id, (v_ret ->> 'quantity')::int, 'sale', 'Return on sale #' || v_sale.number, v_sale.appointment_id);
    end if;
  end loop;

  for v_pay in select * from jsonb_array_elements(p_input -> 'payments') loop
    v_card := null;
    if v_pay ->> 'method' = 'gift_card' then
      select * into v_card from public.gift_cards where business_id = v_sale.business_id and code = private.gift_code(v_pay ->> 'code') for update;
      if v_card.id is null or v_card.status = 'voided' then
        raise exception 'No gift card has that code' using errcode = 'P0002';
      end if;
      perform private.move_gift_card(v_card, 'refunded', (v_pay ->> 'amount_cents')::int, p_sale_id, v_reason);
    end if;
    insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, gift_card_id, reason, created_by)
    values (p_sale_id, v_sale.business_id, v_sale.location_id, (v_pay ->> 'method')::public.payment_method, -(v_pay ->> 'amount_cents')::int,
            case when v_card.id is not null then '…' || right(v_card.code, 4) else nullif(trim(v_pay ->> 'reference'), '') end, v_card.id, v_reason, v_me);
  end loop;

  update public.sales set
    refunded_cents = refunded_cents + v_amount,
    status = case when refunded_cents + v_amount >= total_cents then 'refunded' else 'partly_refunded' end::public.sale_status
  where id = p_sale_id;
  insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id)
  values (p_sale_id, v_sale.business_id, 'refunded', v_amount, v_reason, v_me);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_package(p_client_package_id uuid, p_reason text, p_refund_method text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_package public.client_packages;
  v_me uuid;
  v_refund integer;
  v_sale public.sales;
begin
  select * into v_package from public.client_packages where id = p_client_package_id for update;
  if v_package.id is null or not private.has_business_role(v_package.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only managers and owners can cancel packages' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v_package.status <> 'active' then
    raise exception 'That package was already canceled' using errcode = '55000';
  end if;
  if p_refund_method not in ('cash', 'card', 'none') then
    raise exception 'Choose how the refund is given' using errcode = '22023';
  end if;
  v_me := private.current_staff_id(v_package.business_id);
  v_refund := least(
    (select coalesce(sum((total - used) * use_value_cents), 0) from public.client_package_items where client_package_id = v_package.id)::int,
    v_package.price_cents - v_package.refunded_cents);

  if p_refund_method <> 'none' and v_refund > 0 then
    select * into v_sale from public.sales where id = v_package.sale_id for update;
    if v_sale.id is null then
      raise exception 'There''s no sale to refund this against; cancel without a refund' using errcode = '22023';
    end if;
    -- Never more than is left to refund on that sale (a refunded or voided
    -- sale has given the money back already).
    v_refund := case when v_sale.status = 'voided' then 0 else least(v_refund, v_sale.total_cents - v_sale.refunded_cents) end;
  end if;
  if p_refund_method <> 'none' and v_refund > 0 then
    insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reason, created_by)
    values (v_sale.id, v_sale.business_id, v_sale.location_id, p_refund_method::public.payment_method, -v_refund, 'Package canceled: ' || trim(p_reason), v_me);
    update public.sales set
      refunded_cents = least(total_cents, refunded_cents + v_refund),
      status = case when least(total_cents, refunded_cents + v_refund) >= total_cents then 'refunded' else 'partly_refunded' end::public.sale_status
    where id = v_sale.id and status <> 'voided';
    insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id)
    values (v_sale.id, v_sale.business_id, 'refunded', v_refund, 'Package canceled: ' || trim(p_reason), v_me);
  else
    v_refund := 0;
  end if;

  update public.client_packages set
    status = case when v_refund > 0 then 'refunded' else 'canceled' end::public.client_package_status,
    refunded_cents = refunded_cents + v_refund, canceled_at = now(), canceled_by = v_me, cancel_reason = trim(p_reason)
  where id = v_package.id;
  insert into public.package_events (client_package_id, business_id, kind, amount_cents, reason, staff_id)
  values (v_package.id, v_package.business_id, case when v_refund > 0 then 'refunded' else 'canceled' end, v_refund, trim(p_reason), v_me);
  return v_refund;
end;
$function$;
