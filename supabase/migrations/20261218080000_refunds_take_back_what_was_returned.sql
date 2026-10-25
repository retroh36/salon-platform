-- What a refund takes back (the owner's rules):
--   * a gift card sold on the sale: only its unused balance, and the card is
--     cancelled (what was spent stays spent);
--   * a package: only its unused sessions, and it's cancelled;
--   * a membership: it ends today, for the period's price less the
--     included services already used;
--   * a product: its share of the line.
-- Each refund records what went back and how much of the money was for it
-- (sale_events.returned), so payroll takes back only what was returned: a
-- product return reverses that product's retail commission and never
-- service commission or tips. Money given back that isn't for a returned
-- line is a refund on the sale as a whole, taken back from every line and
-- tip in proportion, as before. cancel_package's refund is recorded
-- against the package line too.

alter table public.sale_events add column returned jsonb not null default '[]';

-- What returning a gift card, package or membership line gives back now
-- (null when it's already been cancelled or refunded).
create function private.refund_line_value(p_sale_item_id uuid)
returns integer
language sql
stable
set search_path to ''
as $$
  select case i.kind
    when 'gift_card' then (
      select least(g.balance_cents, i.total_cents) from public.gift_cards g where g.id = i.gift_card_id and g.status <> 'voided')
    when 'package' then (
      select least(
        (select coalesce(sum((pi.total - pi.used) * pi.use_value_cents), 0) from public.client_package_items pi where pi.client_package_id = p.id)::int,
        p.price_cents - p.refunded_cents)
      from public.client_packages p where p.id = i.client_package_id and p.status = 'active')
    when 'membership' then (
      select greatest(0, i.total_cents - coalesce((
        select sum(u.total_cents)::int
        from public.sale_items u
        join public.sales us on us.id = u.sale_id and us.status <> 'voided'
        join public.membership_credits c on c.id = u.membership_credit_id
        where c.membership_id = m.id
          and c.period_start = (
            select max(c2.period_start) from public.membership_credits c2
            where c2.membership_id = m.id and c2.period_start <= (s.created_at at time zone l.timezone)::date)
      ), 0))
      from public.client_memberships m, public.sales s, public.locations l
      where m.id = i.membership_id and m.status <> 'canceled' and s.id = i.sale_id and l.id = s.location_id)
  end
  from public.sale_items i
  where i.id = p_sale_item_id;
$$;

-- The gift cards, packages and memberships a sale sold, and what returning
-- each gives back (null: already cancelled), for the refund form.
create function public.refundable_lines(p_sale_id uuid)
returns table (sale_item_id uuid, kind text, description text, value_cents integer)
language sql
stable
security definer
set search_path to ''
as $$
  select i.id, i.kind::text, i.description, private.refund_line_value(i.id)
  from public.sale_items i
  join public.sales s on s.id = i.sale_id
  where i.sale_id = p_sale_id and i.kind in ('gift_card', 'package', 'membership') and private.can(s.business_id, 'void_refund')
  order by i.position;
$$;

revoke all on function public.refundable_lines(uuid) from public, anon;
grant execute on function public.refundable_lines(uuid) to authenticated;

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
  v_value integer;
  v_quantity integer;
  v_returned jsonb := '[]';
  v_split jsonb;
  v_left integer;
  v_sold_credit integer;
  v_credit_back integer;
  v_part integer;
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
  -- Nothing back is fine only when something's returned (a membership
  -- whose services were all used, say).
  if v_amount = 0 and jsonb_array_length(coalesce(p_input -> 'returns', '[]')) = 0 then
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

  -- What's going back: products (some of a line), and a gift card,
  -- package or membership sold on the sale (each cancelled, for what's
  -- left of it: private.refund_line_value). Each line's money is recorded
  -- with the refund, so payroll takes back only what was returned.
  for v_ret in select * from jsonb_array_elements(coalesce(p_input -> 'returns', '[]')) loop
    select * into v_item from public.sale_items
    where id = (v_ret ->> 'sale_item_id')::uuid and sale_id = p_sale_id and kind in ('product', 'gift_card', 'package', 'membership') for update;
    if v_item.id is null then
      raise exception 'Those weren''t on the sale' using errcode = '22023';
    end if;
    if v_item.kind = 'product' then
      v_quantity := coalesce((v_ret ->> 'quantity')::int, 0);
      if v_quantity < 1 or v_item.returned_quantity + v_quantity > v_item.quantity then
        raise exception 'Those products weren''t on the sale' using errcode = '22023';
      end if;
      -- Its share of the line, rounded on the running share so returns in
      -- parts add up to the line.
      v_value := round(v_item.total_cents::numeric * (v_item.returned_quantity + v_quantity) / v_item.quantity)::int
               - round(v_item.total_cents::numeric * v_item.returned_quantity / v_item.quantity)::int;
      update public.sale_items set returned_quantity = returned_quantity + v_quantity where id = v_item.id;
      if coalesce((p_input ->> 'restock')::boolean, true) then
        perform private.move_stock(v_sale.location_id, v_item.product_id, v_quantity, 'sale', 'Return on sale #' || v_sale.number, v_sale.appointment_id);
      end if;
    else
      v_quantity := 1;
      v_value := private.refund_line_value(v_item.id);
      if v_value is null then
        raise exception 'That was already cancelled or refunded' using errcode = '55000';
      end if;
      if v_item.kind = 'gift_card' then
        -- Only the unused balance: what was spent stays spent.
        select * into v_card from public.gift_cards where id = v_item.gift_card_id for update;
        perform private.move_gift_card(v_card, 'voided', -v_card.balance_cents, p_sale_id, v_reason);
        update public.gift_cards set status = 'voided' where id = v_card.id;
      elsif v_item.kind = 'package' then
        -- Only the unused sessions.
        update public.client_packages set
          status = case when v_value > 0 then 'refunded' else 'canceled' end::public.client_package_status,
          refunded_cents = refunded_cents + v_value, canceled_at = now(), canceled_by = v_me, cancel_reason = v_reason
        where id = v_item.client_package_id;
        insert into public.package_events (client_package_id, business_id, kind, amount_cents, sale_id, reason, staff_id)
        values (v_item.client_package_id, v_sale.business_id, case when v_value > 0 then 'refunded' else 'canceled' end, v_value, p_sale_id, v_reason, v_me);
      else
        -- The membership ends today.
        update public.client_memberships set status = 'canceled', canceled_at = now(),
          cancels_on = private.membership_today(location_id), cancel_reason = v_reason, next_retry_at = null
        where id = v_item.membership_id;
        insert into public.membership_events (business_id, membership_id, kind, detail, staff_id)
        values (v_sale.business_id, v_item.membership_id, 'canceled', 'Refunded on sale #' || v_sale.number || ': ' || v_reason, v_me);
      end if;
    end if;
    v_returned := v_returned || jsonb_build_object('sale_item_id', v_item.id, 'kind', v_item.kind, 'quantity', v_quantity, 'value_cents', v_value);
  end loop;
  -- The money given back goes to the returned lines first (each up to its
  -- value), then the rest is a refund on the sale as a whole.
  v_left := v_amount;
  v_split := '[]';
  for v_ret in select * from jsonb_array_elements(v_returned) loop
    v_part := least(v_left, (v_ret ->> 'value_cents')::int);
    v_split := v_split || (v_ret || jsonb_build_object('amount_cents', v_part));
    v_left := v_left - v_part;
  end loop;
  v_returned := v_split;
  -- Money for a gift card, package or membership comes back only by
  -- returning it, for what's left of it: anything else given back comes
  -- from the rest of the sale.
  select coalesce(sum(i.total_cents), 0) into v_sold_credit
  from public.sale_items i where i.sale_id = p_sale_id and i.kind in ('gift_card', 'package', 'membership');
  select coalesce(sum((r ->> 'amount_cents')::int), 0) into v_credit_back
  from public.sale_events e, jsonb_array_elements(e.returned) r
  where e.sale_id = p_sale_id and e.kind = 'refunded' and r ->> 'kind' in ('gift_card', 'package', 'membership');
  select coalesce(sum((r ->> 'amount_cents')::int), 0) into v_part
  from jsonb_array_elements(v_returned) r where r ->> 'kind' in ('gift_card', 'package', 'membership');
  if v_amount - v_part > (v_sale.total_cents - v_sold_credit) - (v_sale.refunded_cents - v_credit_back) then
    raise exception 'A gift card, package or membership is refunded by returning it, for what''s left of it' using errcode = '22023';
  end if;

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
  insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id, returned)
  values (p_sale_id, v_sale.business_id, 'refunded', v_amount, v_reason, v_me, v_returned);
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
    insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail, staff_id, returned)
    values (v_sale.id, v_sale.business_id, 'refunded', v_refund, 'Package canceled: ' || trim(p_reason), v_me,
            coalesce((select jsonb_agg(jsonb_build_object('sale_item_id', i.id, 'kind', 'package', 'quantity', 1, 'value_cents', v_refund, 'amount_cents', v_refund))
                      from public.sale_items i where i.sale_id = v_sale.id and i.client_package_id = v_package.id and i.kind = 'package'), '[]'));
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

CREATE OR REPLACE FUNCTION public.payroll_sales(p_business_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_manager boolean := private.can(p_business_id, 'payroll');
begin
  if not v_manager and (p_staff_id is null or not private.is_current_staff(p_business_id, p_staff_id)) then
    raise exception 'Only owners and managers can see payroll' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Choose a period of up to a year' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'number', s.number,
      'created_at', s.created_at,
      'total_cents', s.total_cents,
      'voided_at', s.voided_at,
      'client', case when c.id is null then null else c.first_name || ' ' || c.last_name end,
      'lines', (
        select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'staff_id', i.staff_id, 'description', i.description, 'quantity', i.quantity, 'net_cents', i.total_cents - i.tax_cents, 'commission_pct', coalesce(i.commission_pct, 0), 'commission_version_id', i.commission_version_id) order by i.position), '[]')
        from public.sale_items i
        where i.sale_id = s.id and i.kind in ('service', 'product') and i.staff_id is not null
          and (p_staff_id is null or i.staff_id = p_staff_id)
      ),
      'tips', (
        select coalesce(jsonb_agg(jsonb_build_object('staff_id', t.staff_id, 'amount_cents', t.amount_cents)), '[]')
        from public.sale_tips t
        where t.sale_id = s.id and (p_staff_id is null or t.staff_id = p_staff_id)
      ),
      -- How it was paid (for itemized tips): each tender that took money, a
      -- card taken online apart from the desk's.
      'payments', (
        select coalesce(jsonb_agg(distinct jsonb_build_object('method', p.method, 'online', p.processor is not null)), '[]')
        from public.payments p
        where p.sale_id = s.id and p.amount_cents > 0 and p.method in ('card', 'cash', 'gift_card')
      ),
      'refunds', (
        select coalesce(jsonb_agg(jsonb_build_object('amount_cents', e.amount_cents, 'at', e.created_at, 'returned', e.returned) order by e.created_at), '[]')
        from public.sale_events e
        where e.sale_id = s.id and e.kind = 'refunded'
      )
    ) order by s.created_at)
    from public.sales s
    left join public.clients c on c.id = s.client_id
    where s.business_id = p_business_id
      and (
        (s.created_at >= p_from and s.created_at < p_to)
        or (s.voided_at >= p_from and s.voided_at < p_to)
        or exists (select 1 from public.sale_events e where e.sale_id = s.id and e.kind = 'refunded' and e.created_at >= p_from and e.created_at < p_to)
      )
      and (
        p_staff_id is null
        or exists (select 1 from public.sale_items i where i.sale_id = s.id and i.staff_id = p_staff_id and i.kind in ('service', 'product'))
        or exists (select 1 from public.sale_tips t where t.sale_id = s.id and t.staff_id = p_staff_id)
      )
  ), '[]');
end;
$function$;
