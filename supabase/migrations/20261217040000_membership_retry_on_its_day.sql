-- A failed membership payment said "we'll try again on <day>", but the
-- retry was due only from the exact moment of the failure plus 1, 3 or 4
-- days. The nightly run starts at the same time each night, so the next
-- run was usually a few seconds early and the retry slipped a whole day.
-- Now a retry is due any time on its day, at the salon.

create function private.membership_retry_due(p_location_id uuid, p_at timestamptz, p_today date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone l.timezone)::date <= p_today from public.locations l where l.id = p_location_id
$$;

CREATE OR REPLACE FUNCTION public.advance_membership(p_membership_id uuid, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_m public.client_memberships;
begin
  select * into v_m from public.client_memberships where id = p_membership_id for update;
  if v_m.id is null then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;
  if v_m.status = 'active' and v_m.cancels_on is not null and v_m.cancels_on <= p_today then
    update public.client_memberships set status = 'canceled', canceled_at = now() where id = v_m.id returning * into v_m;
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_m.business_id, v_m.id, 'canceled', coalesce(v_m.cancel_reason, 'As asked'));
  elsif v_m.status = 'active' and v_m.pause_from is not null and v_m.pause_from <= p_today then
    update public.client_memberships set status = 'paused' where id = v_m.id returning * into v_m;
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_m.business_id, v_m.id, 'paused', 'Until ' || v_m.resume_on);
  elsif v_m.status = 'paused' and v_m.resume_on is not null and v_m.resume_on <= p_today then
    -- Back from a pause: a new period starts today, paid now.
    update public.client_memberships set status = 'active', anchor_on = p_today, periods_paid = 0, current_period_start = p_today, current_period_end = p_today,
      pause_from = null, resume_on = null
    where id = v_m.id returning * into v_m;
    insert into public.membership_events (business_id, membership_id, kind) values (v_m.business_id, v_m.id, 'resumed');
  end if;
  return jsonb_build_object(
    'status', v_m.status,
    'due', (v_m.status = 'active' and v_m.current_period_end <= p_today) or (v_m.status = 'past_due' and coalesce(private.membership_retry_due(v_m.location_id, v_m.next_retry_at, p_today), true)),
    'amount_cents', v_m.price_cents + round(v_m.price_cents::numeric * (select b.tax_rate_services_bp from public.businesses b where b.id = v_m.business_id) / 10000)::int,
    'attempt', v_m.failed_attempts + 1
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_membership_charge(p_membership_id uuid, p_today date, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_m public.client_memberships;
  v_b public.businesses;
  v_client public.clients;
  v_retry integer[] := '{1, 3, 4}';
  v_attempt integer;
  v_priced jsonb;
  v_tax integer;
  v_total integer;
  v_number integer;
  v_sale_id uuid;
  v_ok boolean := coalesce((p_result ->> 'ok')::boolean, false);
  v_reason text := left(coalesce(nullif(trim(p_result ->> 'reason'), ''), 'The payment didn''t go through'), 300);
  v_staff record;
begin
  select * into v_m from public.client_memberships where id = p_membership_id for update;
  if v_m.id is null then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;
  -- Only once per due payment, however many times the job runs.
  if not ((v_m.status = 'active' and v_m.current_period_end <= p_today) or (v_m.status = 'past_due' and coalesce(private.membership_retry_due(v_m.location_id, v_m.next_retry_at, p_today), true))) then
    raise exception 'No payment is due on this membership' using errcode = '55000';
  end if;
  select * into v_b from public.businesses where id = v_m.business_id;
  select * into v_client from public.clients where id = v_m.client_id;
  v_attempt := v_m.failed_attempts + 1;

  if v_ok then
    v_priced := private.price_sale(jsonb_build_array(jsonb_build_object('gross', v_m.price_cents, 'taxable_bp', v_b.tax_rate_services_bp, 'discountable', false)), 0);
    v_tax := (v_priced -> 0 ->> 'tax')::int;
    v_total := (v_priced -> 0 ->> 'total')::int;
    update public.businesses set next_sale_number = next_sale_number + 1 where id = v_b.id returning next_sale_number - 1 into v_number;
    insert into public.sales (business_id, location_id, number, client_id, subtotal_cents, tax_cents, total_cents, note)
    values (v_b.id, v_m.location_id, v_number, v_m.client_id, v_m.price_cents, v_tax, v_total, v_m.name || ' renewal')
    returning id into v_sale_id;
    insert into public.sale_items (sale_id, business_id, position, kind, description, quantity, unit_price_cents, tax_cents, total_cents, membership_id)
    values (v_sale_id, v_b.id, 1, 'membership', v_m.name || ' renewal', 1, v_m.price_cents, v_tax, v_total, v_m.id);
    insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, processor, processor_reference)
    values (v_sale_id, v_b.id, v_m.location_id, 'card', v_total, left(coalesce(v_m.card_label, 'Card on file'), 40), v_m.provider, left(p_result ->> 'reference', 200));
    insert into public.sale_events (sale_id, business_id, kind, amount_cents, detail) values (v_sale_id, v_b.id, 'completed', v_total, 'Membership renewal');
    insert into public.membership_charges (business_id, membership_id, period_start, amount_cents, status, attempt, provider, provider_reference, sale_id)
    values (v_b.id, v_m.id, v_m.current_period_end, v_total, 'succeeded', v_attempt, v_m.provider, left(p_result ->> 'reference', 200), v_sale_id);
    update public.client_memberships set
      status = 'active', failed_attempts = 0, next_retry_at = null,
      periods_paid = periods_paid + 1,
      current_period_start = current_period_end,
      current_period_end = private.add_interval(anchor_on, interval_unit, interval_count * (periods_paid + 1))
    where id = v_m.id;
    perform private.grant_membership_credits(v_m.id);
    insert into public.membership_events (business_id, membership_id, kind, sale_id) values (v_b.id, v_m.id, 'renewed', v_sale_id);
    return jsonb_build_object('status', 'active', 'sale_id', v_sale_id);
  end if;

  insert into public.membership_charges (business_id, membership_id, period_start, amount_cents, status, attempt, provider, failure_reason)
  values (v_b.id, v_m.id, v_m.current_period_end, v_m.price_cents, 'failed', v_attempt, v_m.provider, v_reason);
  if v_attempt > array_length(v_retry, 1) then
    update public.client_memberships set status = 'canceled', canceled_at = now(), failed_attempts = v_attempt, next_retry_at = null,
      cancel_reason = 'Payment failed ' || v_attempt || ' times'
    where id = v_m.id;
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_b.id, v_m.id, 'payment_failed', v_reason);
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_b.id, v_m.id, 'canceled', 'Payment failed ' || v_attempt || ' times');
  else
    update public.client_memberships set status = 'past_due', failed_attempts = v_attempt, next_retry_at = now() + make_interval(days => v_retry[v_attempt])
    where id = v_m.id;
    insert into public.membership_events (business_id, membership_id, kind, detail) values (v_b.id, v_m.id, 'payment_failed', v_reason);
  end if;
  -- A notice to the owners and managers (an email, recorded until email
  -- is connected; the Dashboard shows it too).
  for v_staff in select s.id from public.staff s where s.business_id = v_b.id and s.is_active and s.role in ('owner', 'manager') loop
    insert into public.notifications (business_id, location_id, staff_id, channel, template, body)
    values (v_b.id, v_m.location_id, v_staff.id, 'email', 'membership_payment_failed',
      left(concat(v_client.first_name, ' ', v_client.last_name, '''s ', v_m.name, ' payment of ', to_char(v_m.price_cents / 100.0, 'FM$999,990.00'),
        ' didn''t go through (', v_reason, '). ',
        case when v_attempt > array_length(v_retry, 1) then 'The membership has been canceled.'
             else 'Maestra will try again on ' || to_char((now() + make_interval(days => v_retry[v_attempt])) at time zone (select timezone from public.locations where id = v_m.location_id), 'FMMonth FMDD') || '. You can update their card from their profile.' end), 1000));
  end loop;
  return jsonb_build_object('status', case when v_attempt > array_length(v_retry, 1) then 'canceled' else 'past_due' end);
end;
$function$;
