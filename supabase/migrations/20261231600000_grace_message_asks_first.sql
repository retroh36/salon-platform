-- The grace message is never sent by itself (migration …_no_show_grace.sql).
-- The waiver still applies on its own, but the client hears about it only
-- when staff send it: booking details and Denise's card ask "Let Ava know
-- their fee was waived?" with the salon's message as it would go, and Send
-- or Don't send, like a moved visit. Send goes through send_client_message
-- (template 'grace', or 'custom' when they changed it and their role may
-- write its own), logged with who sent it; Don't send is
-- skip_grace_message. Until one of them, the visit says "Grace message not
-- sent".

alter table public.policy_fees
  add column grace_message_skipped_at timestamptz,
  -- Who sent it, or said not to.
  add column grace_message_by uuid references public.staff (id) on delete set null;

alter table public.client_messages drop constraint client_messages_template_check;
alter table public.client_messages add constraint client_messages_template_check
  check (template in ('running_late', 'please_call', 'need_to_move', 'reminder', 'ready_early', 'visit_moved', 'visit_move_undone', 'stylist_out_covered', 'stylist_out_moved', 'custom', 'special', 'grace'));

-- The automatic send is gone.
drop function public.record_grace_message(uuid);

-- Grace messages the automatic send put in the outbox and that haven't gone
-- (nothing has: no salon was live) are taken back, and their visits ask again.
update public.outbox_messages o set status = 'expired', error = 'canceled', updated_at = now()
from public.policy_fees f
join public.clients c on c.id = f.client_id
where f.grace_message_at is not null
  and o.business_id = f.business_id
  and o.status in ('held', 'queued')
  and o.created_at between f.grace_message_at - interval '1 minute' and f.grace_message_at
  and o.to_address in (c.email, c.phone, c.phone_digits);
update public.policy_fees f set grace_message_at = null
where f.grace_message_at is not null
  and not exists (
    select 1 from public.outbox_messages o join public.clients c on c.id = f.client_id
    where o.business_id = f.business_id
      and o.status not in ('held', 'queued', 'expired')
      and o.created_at between f.grace_message_at - interval '1 minute' and f.grace_message_at
      and o.to_address in (c.email, c.phone, c.phone_digits)
  );

-- Whether a visit's fee is waiting for staff to send (or skip) its grace
-- message: forgiven, or held for a rebooking that can still happen.
create function private.grace_message_due(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.policy_fees f
    where f.appointment_id = p_appointment_id
      and f.grace_at is not null
      and f.grace_message_at is null
      and f.grace_message_skipped_at is null
      and (f.status = 'waived' or (f.status in ('pending', 'no_card') and f.grace_until > now()))
  );
$$;

-- A fee assessed again (a no-show taken back and marked again) asks again.
do $$
declare
  v_def text := pg_get_functiondef('private.assess_policy_fee()'::regprocedure);
  v_old text := 'grace_message_at = null';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'assess_policy_fee has changed';
  end if;
  execute replace(v_def, v_old, 'grace_message_at = null, grace_message_skipped_at = null, grace_message_by = null');
end;
$$;

-- send_client_message, as before, and on a visit whose grace message is due
-- (a no-show or a cancellation, so not an upcoming visit) it takes the grace
-- message, or the staff member's own words for it, and records it as sent.
do $$
declare
  v_def text := pg_get_functiondef('public.send_client_message(uuid,text,text,text,text,text,text)'::regprocedure);
  v_status text := 'if v_a.status not in (''booked'', ''confirmed'', ''checked_in'') or v_a.ends_at < now() - interval ''2 hours'' then';
  v_logged text := 'returning id into v_id;';
begin
  if position(v_status in v_def) = 0 or position(v_logged in v_def) = 0 then
    raise exception 'send_client_message has changed';
  end if;
  v_def := replace(v_def, v_status,
    'if p_template = ''grace'' and not private.grace_message_due(v_a.id) then
    raise exception ''There''''s no grace message waiting for this visit'' using errcode = ''55000'', hint = ''grace_done'';
  end if;
  if (v_a.status not in (''booked'', ''confirmed'', ''checked_in'') or v_a.ends_at < now() - interval ''2 hours'')
     and not (p_template in (''grace'', ''custom'') and p_purpose = ''appointment'' and private.grace_message_due(v_a.id)) then');
  v_def := replace(v_def, v_logged, v_logged || '
  if p_template in (''grace'', ''custom'') and p_purpose = ''appointment'' and private.grace_message_due(v_a.id) then
    update public.policy_fees set grace_message_at = now(), grace_message_by = v_staff where appointment_id = v_a.id;
  end if;');
  execute v_def;
end;
$$;

-- Don't send: the front of house decides the client isn't told.
create function public.skip_grace_message(p_fee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.policy_fees;
begin
  select * into v_fee from public.policy_fees where id = p_fee_id;
  if v_fee.id is null or not private.front_of_house(v_fee.business_id) then
    raise exception 'Only the front of house can decide about a grace message' using errcode = '42501';
  end if;
  if not private.grace_message_due(v_fee.appointment_id) then
    raise exception 'There''s no grace message waiting for this visit' using errcode = '55000', hint = 'grace_done';
  end if;
  update public.policy_fees set grace_message_skipped_at = now(), grace_message_by = private.current_staff_id(v_fee.business_id) where id = p_fee_id;
end;
$$;

revoke all on function private.grace_message_due(uuid) from public;
revoke all on function public.skip_grace_message(uuid) from public, anon;
grant execute on function public.skip_grace_message(uuid) to authenticated;
