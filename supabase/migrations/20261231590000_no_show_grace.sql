-- No-show grace (Settings → Policies → Grace): a client's first no-show
-- (or late cancellation, if the salon chooses) in a window of months is
-- forgiven. Either at once, or held for some days and waived if they
-- rebook with the same stylist in that time, else charged as usual. A
-- message in the salon's own words (a fixed template it edits, never
-- Denise's) tells them, through the outbox on their channel for visit
-- messages, once the fee's 10 minutes to undo have passed.

alter table public.policy_settings
  add column grace_on boolean not null default false,
  add column grace_kinds text[] not null default '{no_show}'
    check (grace_kinds <@ array['no_show', 'late_cancel'] and cardinality(grace_kinds) >= 1),
  add column grace_months smallint not null default 12 check (grace_months between 1 and 36),
  -- Null: waived at once; else held this many days for a rebooking.
  add column grace_rebook_days smallint check (grace_rebook_days between 1 and 90),
  add column grace_message text not null
    default 'Hi {first_name}, we missed you today at {salon}. No charge this time. We''d love to see you again: {booking_link}'
    check (length(grace_message) between 1 and 600);

alter table public.policy_fees
  add column grace_at timestamptz,
  -- While it's waiting for a rebooking.
  add column grace_until timestamptz,
  -- The stylist to rebook with: the visit's first.
  add column grace_staff_id uuid references public.staff (id) on delete set null,
  add column grace_message_at timestamptz;
create index policy_fees_grace_idx on public.policy_fees (client_id, grace_at) where grace_at is not null;

alter table public.policy_fee_events drop constraint policy_fee_events_kind_check;
alter table public.policy_fee_events add constraint policy_fee_events_kind_check
  check (kind in ('assessed', 'charged', 'failed', 'retried', 'waived', 'refunded', 'refund_failed', 'voided', 'receipt', 'grace'));

create or replace function private.assess_policy_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms jsonb;
  v_kind text;
  v_fee integer;
  v_from_deposit integer;
  v_status text;
  v_card public.client_cards;
  v_id uuid;
  v_existing public.policy_fees;
  v_settings public.policy_settings;
  v_grace boolean := false;
  v_grace_until timestamptz;
  v_grace_staff uuid;
  v_waive_reason text;
begin
  -- A no-show taken back: its fee goes too (unless it was already charged:
  -- then staff waive it, which refunds it).
  if old.status = 'no_show' and new.status in ('booked', 'confirmed') then
    select * into v_existing from public.policy_fees where appointment_id = new.id and kind = 'no_show';
    if v_existing.id is not null and (v_existing.status in ('none', 'no_card', 'pending', 'failed')
                                      or (v_existing.status = 'waived' and v_existing.grace_at is not null)) then
      update public.policy_fees set status = 'voided', charge_after = null, grace_until = null where id = v_existing.id;
      insert into public.policy_fee_events (business_id, fee_id, kind, detail, staff_id)
      values (new.business_id, v_existing.id, 'voided', 'No-show taken back', private.current_staff_id(new.business_id));
      if new.deposit_outcome = 'kept' then
        new.deposit_outcome := null;
      end if;
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status or old.status not in ('booked', 'confirmed') or new.status not in ('no_show', 'canceled') then
    return new;
  end if;
  v_terms := private.visit_terms(new.id);

  if new.status = 'canceled' then
    if not private.is_client_cancel(new.cancel_reason)
       or new.canceled_at <= new.starts_at - make_interval(hours => (v_terms ->> 'window_hours')::int) then
      -- In good time, or the salon canceled: nothing to pay, and a deposit
      -- goes back.
      if new.deposit_paid_cents > 0 and new.deposit_outcome is null then
        new.deposit_outcome := 'refund_due';
      end if;
      return new;
    end if;
    v_kind := 'late_cancel';
    v_fee := (v_terms ->> 'late_cents')::int;
    if v_terms ->> 'long_hold_days' is not null
       and new.starts_at - new.created_at < make_interval(days => (v_terms ->> 'long_hold_days')::int) then
      v_fee := new.deposit_paid_cents;
    end if;
  else
    v_kind := 'no_show';
    v_fee := (v_terms ->> 'no_show_cents')::int;
  end if;

  if new.client_id is null then
    return new;
  end if;
  v_from_deposit := least(new.deposit_paid_cents, v_fee);
  if new.deposit_paid_cents > 0 then
    new.deposit_outcome := 'kept';
  end if;
  select * into v_card from public.client_cards where client_id = new.client_id and removed_at is null;
  v_status := case
    when v_fee = 0 then 'none'
    when v_fee = v_from_deposit then 'charged'
    when v_card.id is null then 'no_card'
    else 'pending' end;

  -- Grace: the client's first fee of a kind the salon chose in its window
  -- is waived, at once or once they rebook with the same stylist in time
  -- (until then it waits, and it's charged if they don't).
  select * into v_settings from public.policy_settings where business_id = new.business_id;
  if v_settings.grace_on and v_kind = any (v_settings.grace_kinds) and v_status in ('pending', 'no_card')
     and not exists (
       select 1 from public.policy_fees f
       where f.client_id = new.client_id and f.appointment_id <> new.id and f.status <> 'voided'
         and f.grace_at > now() - make_interval(months => v_settings.grace_months)
     ) then
    v_grace := true;
    select i.staff_id into v_grace_staff from public.appointment_items i where i.appointment_id = new.id order by i.starts_at, i.id limit 1;
    if v_settings.grace_rebook_days is null then
      v_status := 'waived';
      v_waive_reason := 'Grace: their first ' || case when v_kind = 'no_show' then 'no-show' else 'late cancellation' end
                        || ' in ' || v_settings.grace_months || ' months';
    else
      v_grace_until := now() + make_interval(days => v_settings.grace_rebook_days);
    end if;
  end if;

  insert into public.policy_fees (business_id, location_id, appointment_id, client_id, kind, fee_cents, from_deposit_cents, status, charge_after, card_label, charged_at, attempts,
                                  grace_at, grace_until, grace_staff_id, waived_at, waive_reason)
  values (new.business_id, new.location_id, new.id, new.client_id, v_kind, v_fee, v_from_deposit, v_status,
          case when v_status = 'pending' then greatest(now() + interval '10 minutes', v_grace_until) end, v_card.label,
          case when v_status = 'charged' then now() end, 0,
          case when v_grace then now() end, v_grace_until, v_grace_staff,
          case when v_status = 'waived' then now() end, v_waive_reason)
  on conflict (appointment_id) do update set
    kind = excluded.kind, fee_cents = excluded.fee_cents, from_deposit_cents = excluded.from_deposit_cents, status = excluded.status,
    charge_after = excluded.charge_after, card_label = excluded.card_label, charged_at = excluded.charged_at,
    attempts = 0, failure_reason = null, provider = null, provider_reference = null, created_at = now(),
    grace_at = excluded.grace_at, grace_until = excluded.grace_until, grace_staff_id = excluded.grace_staff_id,
    waived_at = excluded.waived_at, waive_reason = excluded.waive_reason, grace_message_at = null
  where public.policy_fees.status = 'voided'
  returning id into v_id;

  if v_id is not null then
    insert into public.policy_fee_events (business_id, fee_id, kind, amount_cents, detail, staff_id)
    values (new.business_id, v_id, 'assessed', v_fee,
            case when v_from_deposit > 0 then 'Deposit kept: ' || to_char(v_from_deposit / 100.0, 'FM$999,990.00') end,
            private.current_staff_id(new.business_id));
    if v_grace then
      insert into public.policy_fee_events (business_id, fee_id, kind, detail)
      values (new.business_id, v_id, 'grace',
              coalesce(v_waive_reason, 'Grace: waived if they rebook with the same stylist by ' || to_char(v_grace_until at time zone (select l.timezone from public.locations l where l.id = new.location_id), 'FMMon FMDD')));
    end if;
  end if;
  return new;
end;
$$;

-- A fee held for a rebooking is never charged before its window ends,
-- whatever makes it due (a card added, a retry).
create function private.policy_fee_hold_grace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pending' and new.grace_until > now() and (new.charge_after is null or new.charge_after < new.grace_until) then
    new.charge_after := new.grace_until;
  end if;
  return new;
end;
$$;

create trigger policy_fees_hold_grace before insert or update on public.policy_fees
  for each row execute function private.policy_fee_hold_grace();

-- Rebooking with the same stylist in time waives a held fee.
create function private.waive_fee_on_rebook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee record;
begin
  for v_fee in
    update public.policy_fees f
    set status = 'waived', waived_at = now(), charge_after = null, grace_until = null,
        waive_reason = 'Grace: rebooked with ' || (select s.first_name from public.staff s where s.id = new.staff_id)
    from public.appointments a
    where a.id = new.appointment_id and a.status in ('booked', 'confirmed') and a.client_id = f.client_id
      and f.appointment_id <> a.id and f.grace_staff_id = new.staff_id
      and f.grace_until > now() and f.status in ('pending', 'no_card', 'failed')
    returning f.id, f.business_id, f.waive_reason
  loop
    insert into public.policy_fee_events (business_id, fee_id, kind, detail, staff_id)
    values (v_fee.business_id, v_fee.id, 'grace', v_fee.waive_reason, private.current_staff_id(v_fee.business_id));
  end loop;
  return new;
end;
$$;

create trigger appointment_items_rebook_grace after insert on public.appointment_items
  for each row execute function private.waive_fee_on_rebook();

-- The grace settings, apart from the rest of the policy. The `settings`
-- permission.
create function public.save_grace_settings(
  p_business_id uuid, p_on boolean, p_kinds text[], p_months integer, p_rebook_days integer, p_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only those who change settings can set grace' using errcode = '42501';
  end if;
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'Write the message clients get' using errcode = '22023', hint = 'message';
  end if;
  insert into public.policy_settings as ps (business_id, grace_on, grace_kinds, grace_months, grace_rebook_days, grace_message, updated_by, updated_at)
  values (p_business_id, p_on, p_kinds, p_months, p_rebook_days, trim(p_message), private.current_staff_id(p_business_id), now())
  on conflict (business_id) do update set
    grace_on = excluded.grace_on, grace_kinds = excluded.grace_kinds, grace_months = excluded.grace_months,
    grace_rebook_days = excluded.grace_rebook_days, grace_message = excluded.grace_message,
    updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- The grace message recorded as sent (or with nobody to send it to). The
-- service role.
create function public.record_grace_message(p_fee_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.policy_fees set grace_message_at = now() where id = p_fee_id and grace_message_at is null;
$$;

revoke all on function private.policy_fee_hold_grace() from public;
revoke all on function private.waive_fee_on_rebook() from public;
revoke all on function public.save_grace_settings(uuid, boolean, text[], integer, integer, text) from public, anon;
grant execute on function public.save_grace_settings(uuid, boolean, text[], integer, integer, text) to authenticated;
revoke all on function public.record_grace_message(uuid) from public, anon, authenticated;
grant execute on function public.record_grace_message(uuid) to service_role;
