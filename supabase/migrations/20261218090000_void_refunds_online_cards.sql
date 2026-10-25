-- Voiding a sale paid online (a payment link, a deposit taken when it was
-- booked, a membership renewal) gives the money back to the card through
-- the payment provider, since the desk's terminal never took it. void_sale
-- marks each such reversal as due; the app refunds it with the provider
-- (after staff confirm) and records how it went (record_provider_refund). A
-- deposit refunded this way isn't applied again at the next checkout.

alter table public.payments add column provider_refund text check (provider_refund in ('due', 'refunded', 'failed'));
alter table public.sale_events drop constraint sale_events_kind_check;
alter table public.sale_events add constraint sale_events_kind_check
  check (kind in ('completed', 'voided', 'refunded', 'receipt_emailed', 'card_refunded', 'card_refund_failed'));

CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sale public.sales;
  v_me uuid;
  v_item public.sale_items;
  v_card public.gift_cards;
  v_pay public.payments;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if v_sale.id is null or not private.can(v_sale.business_id, 'void_refund') then
    raise exception 'Only managers and owners can void a sale' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v_sale.status <> 'completed' then
    raise exception 'This sale was already refunded or voided' using errcode = '55000';
  end if;
  v_me := private.current_staff_id(v_sale.business_id);

  -- Gift cards sold or reloaded on the sale.
  for v_item in select * from public.sale_items where sale_id = p_sale_id and kind in ('gift_card', 'gift_card_reload') loop
    select * into v_card from public.gift_cards where id = v_item.gift_card_id for update;
    if v_item.kind = 'gift_card' then
      if v_card.balance_cents < v_card.initial_cents or exists (select 1 from public.gift_card_events where card_id = v_card.id and kind = 'redeemed') then
        raise exception 'A gift card from this sale has been used, so it can''t be voided. Refund instead.' using errcode = '55000';
      end if;
      perform private.move_gift_card(v_card, 'voided', -v_card.balance_cents, p_sale_id, 'Void: ' || trim(p_reason));
      update public.gift_cards set status = 'voided' where id = v_card.id;
    else
      if v_card.balance_cents < v_item.unit_price_cents then
        raise exception 'The reloaded card has been used, so this can''t be voided. Refund instead.' using errcode = '55000';
      end if;
      perform private.move_gift_card(v_card, 'refunded', -v_item.unit_price_cents, p_sale_id, 'Void: ' || trim(p_reason));
    end if;
  end loop;

  -- Packages sold on the sale (if not used), and uses of packages back.
  for v_item in select * from public.sale_items where sale_id = p_sale_id and kind = 'package' loop
    if exists (select 1 from public.client_package_items where client_package_id = v_item.client_package_id and used > 0) then
      raise exception 'A package from this sale has been used, so it can''t be voided. Cancel the package instead.' using errcode = '55000';
    end if;
    update public.client_packages set status = 'canceled', canceled_at = now(), canceled_by = v_me, cancel_reason = 'Void: ' || trim(p_reason) where id = v_item.client_package_id;
    insert into public.package_events (client_package_id, business_id, kind, sale_id, reason, staff_id)
    values (v_item.client_package_id, v_sale.business_id, 'canceled', p_sale_id, 'Void: ' || trim(p_reason), v_me);
  end loop;
  for v_item in select * from public.sale_items where sale_id = p_sale_id and package_item_id is not null loop
    perform private.restore_package_use(v_item.package_item_id, p_sale_id, 'Void: ' || trim(p_reason));
  end loop;

  -- Gift card payments back on their cards.
  for v_pay in select * from public.payments where sale_id = p_sale_id and method = 'gift_card' and amount_cents > 0 loop
    select * into v_card from public.gift_cards where id = v_pay.gift_card_id for update;
    perform private.move_gift_card(v_card, 'refunded', v_pay.amount_cents, p_sale_id, 'Void: ' || trim(p_reason));
  end loop;

  -- A card taken online (a payment link, a deposit, a renewal) goes back
  -- through the payment provider: its reversal is due until the app has
  -- refunded it (record_provider_refund).
  insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, gift_card_id, reason, created_by, processor, processor_reference, provider_refund)
  select p.sale_id, p.business_id, p.location_id, p.method, -p.amount_cents, p.reference, p.gift_card_id, 'Void: ' || trim(p_reason), v_me,
         p.processor, p.processor_reference, case when p.processor is not null then 'due' end
  from public.payments p where p.sale_id = p_sale_id and p.amount_cents > 0;
  -- A deposit refunded with it isn't there to take at the next checkout.
  update public.appointments a set deposit_outcome = 'refund_due'
  where a.id = v_sale.appointment_id and a.deposit_outcome is null
    and a.deposit_reference in (select p.processor_reference from public.payments p where p.sale_id = p_sale_id and p.amount_cents > 0 and p.processor is not null);

  for v_item in select * from public.sale_items where sale_id = p_sale_id and kind = 'product' and quantity > returned_quantity loop
    perform private.move_stock(v_sale.location_id, v_item.product_id, v_item.quantity - v_item.returned_quantity, 'sale', 'Void of sale #' || v_sale.number, v_sale.appointment_id);
  end loop;

  update public.sales set status = 'voided', voided_by = v_me, voided_at = now(), void_reason = trim(p_reason) where id = p_sale_id;
  if v_sale.appointment_id is not null then
    update public.appointments set status = 'checked_in', checked_out_at = null, updated_by = v_me
    where id = v_sale.appointment_id and status = 'completed';
  end if;
  insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id)
  values (p_sale_id, v_sale.business_id, 'voided', v_sale.total_cents, trim(p_reason), v_me);
end;
$function$;

-- How a provider refund went: refunded, or failed (to try again).
create function public.record_provider_refund(p_payment_id uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_pay public.payments;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if v_pay.id is null or not private.can(v_pay.business_id, 'void_refund') then
    raise exception 'Only managers and owners can refund' using errcode = '42501';
  end if;
  if v_pay.provider_refund not in ('due', 'failed') then
    raise exception 'That card refund was already made' using errcode = '55000';
  end if;
  update public.payments set provider_refund = case when p_ok then 'refunded' else 'failed' end where id = v_pay.id;
  insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id)
  values (v_pay.sale_id, v_pay.business_id, case when p_ok then 'card_refunded' else 'card_refund_failed' end, -v_pay.amount_cents,
          coalesce(v_pay.reference, 'Card') || ' (online)', private.current_staff_id(v_pay.business_id));
  if p_ok then
    update public.appointments set deposit_outcome = 'refunded'
    where business_id = v_pay.business_id and deposit_reference = v_pay.processor_reference and deposit_outcome = 'refund_due';
  end if;
end;
$$;

revoke all on function public.record_provider_refund(uuid, boolean) from public, anon;
grant execute on function public.record_provider_refund(uuid, boolean) to authenticated;
