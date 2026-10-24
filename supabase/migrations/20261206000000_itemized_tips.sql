-- Itemized tips (My day and Payroll): payroll_sales also says how each sale
-- was paid, so each tip shows its payment method. Otherwise as before: owners
-- and managers get everyone; anyone else only their own lines and tips.

create or replace function public.payroll_sales(p_business_id uuid, p_from timestamptz, p_to timestamptz, p_staff_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manager boolean := private.has_business_role(p_business_id, array['owner', 'manager']::public.staff_role[]);
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
        select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'staff_id', i.staff_id, 'description', i.description, 'quantity', i.quantity, 'net_cents', i.total_cents - i.tax_cents, 'commission_pct', coalesce(i.commission_pct, 0)) order by i.position), '[]')
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
        select coalesce(jsonb_agg(jsonb_build_object('amount_cents', e.amount_cents, 'at', e.created_at) order by e.created_at), '[]')
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
$$;
