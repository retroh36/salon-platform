-- Payroll and commission: the salon's pay period, hourly rates, and the
-- sales behind each staff member's pay (lib/payroll.ts works out the pay).

-- How often the salon runs payroll. Weekly and biweekly periods count from
-- pay_period_anchor (a period's first day); semi-monthly is the 1st-15th
-- and the 16th to the month's end; custom means picking dates each time.
alter table public.businesses
  add column pay_period text not null default 'biweekly' check (pay_period in ('weekly', 'biweekly', 'semi_monthly', 'custom')),
  add column pay_period_anchor date not null default '2026-01-05';

-- Hourly pay, on top of any commission. Null: not paid by the hour.
alter table public.staff_compensation
  add column hourly_rate_cents integer check (hourly_rate_cents between 0 and 100000);

create function public.set_payroll_settings(p_business_id uuid, p_pay_period text, p_anchor date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can change payroll settings' using errcode = '42501';
  end if;
  if p_pay_period not in ('weekly', 'biweekly', 'semi_monthly', 'custom') then
    raise exception 'Choose a pay period' using errcode = '22023';
  end if;
  update public.businesses set pay_period = p_pay_period, pay_period_anchor = coalesce(p_anchor, pay_period_anchor) where id = p_business_id;
end;
$$;

-- Every sale that touches pay between two instants: completed, refunded or
-- voided then. Each with its service and product lines that have a
-- stylist, its tips, its refunds and when it was voided. Owners and
-- managers see everyone (p_staff_id null) or one person; anyone else only
-- themselves, and only their own lines and tips (the sale's total stays,
-- so a refund's share works out the same).
create function public.payroll_sales(p_business_id uuid, p_from timestamptz, p_to timestamptz, p_staff_id uuid default null)
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
        select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'staff_id', i.staff_id, 'description', i.description, 'quantity', i.quantity, 'net_cents', i.total_cents - i.tax_cents) order by i.position), '[]')
        from public.sale_items i
        where i.sale_id = s.id and i.kind in ('service', 'product') and i.staff_id is not null
          and (p_staff_id is null or i.staff_id = p_staff_id)
      ),
      'tips', (
        select coalesce(jsonb_agg(jsonb_build_object('staff_id', t.staff_id, 'amount_cents', t.amount_cents)), '[]')
        from public.sale_tips t
        where t.sale_id = s.id and (p_staff_id is null or t.staff_id = p_staff_id)
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

revoke all on function public.set_payroll_settings(uuid, text, date) from public, anon;
revoke all on function public.payroll_sales(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.set_payroll_settings(uuid, text, date) to authenticated;
grant execute on function public.payroll_sales(uuid, timestamptz, timestamptz, uuid) to authenticated;
