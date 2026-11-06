-- Paying by "Other" (the method is …_paid_by_other.sql): complete_sale
-- takes it only with a note saying what it was (kept as the payment's
-- reference, 3 to 200 characters), and every one sends an alert to whoever
-- has the audit trail (owners and managers by default), like voids and
-- refunds. It's money in, so the close-out, Reconcile and the audit trail
-- show it on its own. Refunds still go back as cash, a card or a gift card;
-- a void reverses it as "Other".

do $$
declare
  v_def text := pg_get_functiondef('public.complete_sale(uuid,jsonb)'::regprocedure);
  v_old text := $o$    if v_pay ->> 'method' not in ('cash', 'card', 'gift_card') then
      raise exception 'That way to pay isn''t available' using errcode = '22023';
    end if;$o$;
  v_new text := $n$    if v_pay ->> 'method' not in ('cash', 'card', 'gift_card', 'other') then
      raise exception 'That way to pay isn''t available' using errcode = '22023';
    end if;
    if v_pay ->> 'method' = 'other' and length(trim(coalesce(v_pay ->> 'reference', ''))) not between 3 and 200 then
      raise exception 'Say what the other payment was' using errcode = '22023', hint = 'other_note';
    end if;$n$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'complete_sale changed: update this migration';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;

create function private.alert_on_other_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
begin
  select s.number into v_number from public.sales s where s.id = new.sale_id;
  perform private.send_alert(new.business_id, new.location_id, new.created_by, 'alert_paid_other',
    private.alert_who(new.created_by) || ' took ' || private.money_text(new.amount_cents) || ' as "Other" on sale #' || v_number
    || ': ' || coalesce(nullif(trim(new.reference), ''), 'no note') || '.');
  return null;
end;
$$;

revoke all on function private.alert_on_other_payment() from public;

create trigger payments_alert_other after insert on public.payments
  for each row when (new.method = 'other' and new.amount_cents > 0)
  execute function private.alert_on_other_payment();

-- Tips say how the sale was paid: "Other" too.
do $$
declare
  v_def text := pg_get_functiondef('public.payroll_sales(uuid,timestamptz,timestamptz,uuid)'::regprocedure);
  v_old text := $o$p.method in ('card', 'cash', 'gift_card')$o$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'payroll_sales changed: update this migration';
  end if;
  execute replace(v_def, v_old, $n$p.method in ('card', 'cash', 'other', 'gift_card')$n$);
end;
$$;
