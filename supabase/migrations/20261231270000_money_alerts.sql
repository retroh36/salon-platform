-- Alerts to owners and managers (Coterie's 2c): whenever someone voids or
-- refunds a sale, completes a $0 sale, adjusts or voids a gift card, or
-- waives a cancellation fee, everyone with the `audit` permission (apart
-- from whoever did it) gets an app notice saying who, what and why, in our
-- own fixed wording. The database writes them (triggers on the logs), so no
-- path can skip one. They show on the Dashboard's "For you" card.
--
-- Alerts are for their recipient only: the front of house no longer reads
-- notices sent to someone else when they're alerts (the money in them is
-- for whoever has `audit`).

create function private.send_alert(p_business uuid, p_location uuid, p_actor uuid, p_template text, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (business_id, location_id, staff_id, channel, status, template, body)
  select p_business,
         coalesce(p_location, s.location_id),
         s.id, 'app', 'sent', p_template, left(p_body, 1000)
  from public.staff s
  where s.business_id = p_business and s.is_active and s.location_id is not null
    and s.id is distinct from p_actor
    and private.staff_can(s.id, 'audit')
    -- The seeds' made-up history raises no alerts.
    and coalesce(current_setting('maestra.seeding', true), '') <> 'on';
$$;

revoke all on function private.send_alert(uuid, uuid, uuid, text, text) from public;

-- "Sam Rivera", or "Someone" for a former team member, or "Maestra".
create function private.alert_who(p_staff uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_staff is null then 'Maestra'
              else coalesce((select trim(s.first_name || ' ' || coalesce(s.last_name, '')) from public.staff s where s.id = p_staff), 'A former team member') end;
$$;

revoke all on function private.alert_who(uuid) from public;

create function private.alert_on_sale_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_body text;
  v_template text;
begin
  select * into v_sale from public.sales where id = new.sale_id;
  if v_sale.id is null then
    return null;
  end if;
  if new.kind = 'voided' then
    v_template := 'alert_sale_voided';
    v_body := private.alert_who(new.staff_id) || ' voided sale #' || v_sale.number || ' (' || private.money_text(v_sale.total_cents) || ')'
              || coalesce(': ' || nullif(trim(v_sale.void_reason), ''), '') || '.';
  elsif new.kind = 'refunded' then
    v_template := 'alert_sale_refunded';
    v_body := private.alert_who(new.staff_id) || ' refunded ' || private.money_text(abs(coalesce(new.amount_cents, 0))) || ' on sale #' || v_sale.number
              || coalesce(': ' || nullif(trim(new.detail), ''), '') || '.';
  elsif new.kind = 'completed' and v_sale.total_cents = 0 then
    v_template := 'alert_zero_sale';
    v_body := private.alert_who(new.staff_id) || ' completed sale #' || v_sale.number || ' for $0'
              || coalesce(' (' || nullif(trim(v_sale.discount_reason), '') || ')', '') || '.';
  else
    return null;
  end if;
  perform private.send_alert(new.business_id, v_sale.location_id, new.staff_id, v_template, v_body);
  return null;
end;
$$;

create trigger sale_events_alert
  after insert on public.sale_events
  for each row execute function private.alert_on_sale_event();

create function private.alert_on_gift_card_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if new.kind not in ('adjusted', 'voided') then
    return null;
  end if;
  select right(c.code, 4) into v_code from public.gift_cards c where c.id = new.card_id;
  perform private.send_alert(
    new.business_id, null, new.staff_id,
    case new.kind when 'voided' then 'alert_gift_card_voided' else 'alert_gift_card_adjusted' end,
    private.alert_who(new.staff_id)
      || case new.kind
           when 'voided' then ' voided gift card …' || coalesce(v_code, '')
           else ' adjusted gift card …' || coalesce(v_code, '') || ' by ' || case when new.amount_cents < 0 then '−' else '+' end || private.money_text(abs(new.amount_cents))
         end
      || coalesce(': ' || nullif(trim(new.reason), ''), '') || '.');
  return null;
end;
$$;

create trigger gift_card_events_alert
  after insert on public.gift_card_events
  for each row execute function private.alert_on_gift_card_event();

create function private.alert_on_fee_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.policy_fees;
  v_client text;
begin
  if new.kind <> 'waived' then
    return null;
  end if;
  select * into v_fee from public.policy_fees where id = new.fee_id;
  select c.first_name into v_client from public.clients c where c.id = v_fee.client_id;
  perform private.send_alert(
    new.business_id, v_fee.location_id, new.staff_id, 'alert_fee_waived',
    private.alert_who(new.staff_id) || ' waived ' || coalesce(v_client || '''s ', 'a ')
      || case v_fee.kind when 'no_show' then 'no-show' else 'late-cancel' end || ' fee (' || private.money_text(v_fee.fee_cents) || ')'
      || coalesce(': ' || nullif(trim(new.detail), ''), '') || '.');
  return null;
end;
$$;

create trigger policy_fee_events_alert
  after insert on public.policy_fee_events
  for each row execute function private.alert_on_fee_event();

revoke all on function private.alert_on_sale_event() from public;
revoke all on function private.alert_on_gift_card_event() from public;
revoke all on function private.alert_on_fee_event() from public;

-- Alerts are read by their recipient only.
drop policy "Front of house can view notifications" on public.notifications;
create policy "Front of house can view notifications" on public.notifications for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])) and template not like 'alert\_%');
