-- Commission history: the rates in effect when a sale was made are kept on
-- its lines, and every change to someone's pay is kept with when it took
-- effect, so changing a rate never changes past pay (lib/payroll.ts pays
-- commission from the lines' rates and hourly pay from the rate each day).

-- Every change to a staff member's pay. Their first rates cover everything
-- before them (-infinity); later changes take effect when they're made.
create table public.staff_compensation_history (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses (id) on delete cascade,
  staff_id                uuid not null references public.staff (id) on delete cascade,
  effective_from          timestamptz not null,
  service_commission_pct  numeric(5, 2) not null,
  retail_commission_pct   numeric(5, 2) not null,
  hourly_rate_cents       integer,
  changed_by              uuid references public.staff (id) on delete set null,
  created_at              timestamptz not null default now()
);

create index staff_compensation_history_staff_idx on public.staff_compensation_history (staff_id, effective_from);

alter table public.staff_compensation_history enable row level security;

-- As for staff_compensation: managers, and the staff member themselves.
-- Written only by the trigger below.
create policy "Managers and the staff member can view pay history"
  on public.staff_compensation_history for select to authenticated
  using (
    (select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[]))
    or (select private.is_current_staff(business_id, staff_id))
  );

create function private.record_compensation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.service_commission_pct is not distinct from old.service_commission_pct
     and new.retail_commission_pct is not distinct from old.retail_commission_pct
     and new.hourly_rate_cents is not distinct from old.hourly_rate_cents then
    return new;
  end if;
  insert into public.staff_compensation_history (business_id, staff_id, effective_from, service_commission_pct, retail_commission_pct, hourly_rate_cents, changed_by)
  values (
    new.business_id, new.staff_id,
    case when exists (select 1 from public.staff_compensation_history h where h.staff_id = new.staff_id) then now() else '-infinity'::timestamptz end,
    new.service_commission_pct, new.retail_commission_pct, new.hourly_rate_cents,
    private.current_staff_id(new.business_id)
  );
  return new;
end;
$$;

create trigger staff_compensation_history after insert or update on public.staff_compensation
  for each row execute function private.record_compensation_history();

-- The commission rate in effect on each service and product line with a
-- stylist, recorded when the sale is made (renewals and other lines
-- without a stylist have none).
alter table public.sale_items add column commission_pct numeric(5, 2) check (commission_pct between 0 and 100);

create function private.record_line_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.commission_pct is null and new.staff_id is not null and new.kind::text in ('service', 'product') then
    select case when new.kind::text = 'service' then c.service_commission_pct else c.retail_commission_pct end
      into new.commission_pct
    from public.staff_compensation c where c.staff_id = new.staff_id;
    new.commission_pct := coalesce(new.commission_pct, 0);
  end if;
  return new;
end;
$$;

create trigger sale_items_record_commission before insert on public.sale_items
  for each row execute function private.record_line_commission();

revoke all on function private.record_compensation_history() from public;
revoke all on function private.record_line_commission() from public;

-- Backfill: today's rates, as everyone's first, and on every past line.
insert into public.staff_compensation_history (business_id, staff_id, effective_from, service_commission_pct, retail_commission_pct, hourly_rate_cents)
select business_id, staff_id, '-infinity', service_commission_pct, retail_commission_pct, hourly_rate_cents from public.staff_compensation;

update public.sale_items i set commission_pct = coalesce(
  (select case when i.kind::text = 'service' then c.service_commission_pct else c.retail_commission_pct end from public.staff_compensation c where c.staff_id = i.staff_id), 0)
where i.commission_pct is null and i.staff_id is not null and i.kind::text in ('service', 'product');

-- payroll_sales, as before, with each line's recorded rate.
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
