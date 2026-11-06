-- When an order is expected. Sending it sets the date to the salon's today
-- plus the supplier's usual lead time (unless one was already set); owners
-- and managers change or clear it until it's all received
-- (set_order_expected). An order past its date and not all in is late.

alter table public.purchase_orders add column expected_on date;

create or replace function public.send_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  perform private.require_inventory_manager(v_order.business_id);
  if v_order.status <> 'draft' then
    raise exception 'Already sent' using errcode = '55000';
  end if;
  if not exists (select 1 from public.purchase_order_lines where purchase_order_id = p_order_id) then
    raise exception 'Add something to order first' using errcode = '22023';
  end if;
  update public.purchase_orders o
  set status = 'sent',
      sent_at = now(),
      sent_by = private.current_staff_id(o.business_id),
      expected_on = coalesce(o.expected_on, (
        select (now() at time zone l.timezone)::date + s.lead_time_days
        from public.locations l, public.suppliers s
        where l.id = o.location_id and s.id = o.supplier_id
      ))
  where o.id = p_order_id;
end;
$$;

create function public.set_order_expected(p_order_id uuid, p_expected_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  perform private.require_inventory_manager(v_order.business_id);
  if v_order.status = 'received' then
    raise exception 'It''s all been received' using errcode = '55000';
  end if;
  if p_expected_on is not null and p_expected_on < (v_order.created_at at time zone 'UTC')::date - 1 then
    raise exception 'Expected before the order was started' using errcode = '22023', hint = 'expected';
  end if;
  update public.purchase_orders set expected_on = p_expected_on where id = p_order_id;
end;
$$;

revoke all on function public.set_order_expected(uuid, date) from public, anon;
grant execute on function public.set_order_expected(uuid, date) to authenticated;
