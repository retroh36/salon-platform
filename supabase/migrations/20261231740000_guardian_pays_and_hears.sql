-- A dependent's guardian hears and pays: messages staff send about the
-- dependent's visit go to the guardian (the dependent's own contact only if
-- the guardian can't be reached), and fees for the dependent's visits charge
-- the guardian's card (the dependent's own card only if the guardian has none).

-- Who a message about this client's visit goes to.
create function private.message_recipient(p_client public.clients)
returns public.clients
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_guardian public.clients;
begin
  if p_client.guardian_client_id is not null then
    select * into v_guardian from public.clients where id = p_client.guardian_client_id;
    if v_guardian.id is not null and (private.message_channel_ok(v_guardian, 'appointment', 'sms') or private.message_channel_ok(v_guardian, 'appointment', 'email')) then
      return v_guardian;
    end if;
  end if;
  return p_client;
end;
$$;
revoke all on function private.message_recipient(public.clients) from public;

-- The card that pays for this client's fees.
create function private.card_on_file(p_client_id uuid)
returns public.client_cards
language sql
stable
security definer
set search_path = ''
as $$
  select cc.* from public.client_cards cc
  join public.clients c on c.id = p_client_id
  where cc.removed_at is null and cc.client_id in (c.id, c.guardian_client_id)
  order by (cc.client_id = c.id)
  limit 1;
$$;
revoke all on function private.card_on_file(uuid) from public;

-- For staff screens: the visits whose messages go to a guardian.
create function public.visit_message_recipients(p_appointment_ids uuid[])
returns table (appointment_id uuid, guardian_first_name text, dependent_first_name text, channels text[])
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, r.first_name, c.first_name,
    array_remove(array[
      case when private.message_channel_ok(r, 'appointment', 'sms') then 'sms' end,
      case when private.message_channel_ok(r, 'appointment', 'email') then 'email' end
    ], null)
  from public.appointments a
  join public.clients c on c.id = a.client_id
  cross join lateral private.message_recipient(c) r
  where a.id = any (p_appointment_ids) and r.id <> c.id
    and (private.front_of_house(a.business_id) or exists (
      select 1 from public.appointment_items i where i.appointment_id = a.id and i.staff_id = private.current_staff_id(a.business_id)));
$$;
revoke all on function public.visit_message_recipients(uuid[]) from public, anon;
grant execute on function public.visit_message_recipients(uuid[]) to authenticated;

-- A card a guardian enters while booking for their dependent is the
-- guardian's, with the guardian's agreement to the policy.
drop function public.record_online_card(uuid, jsonb, jsonb, jsonb);
create function public.record_online_card(p_appointment_id uuid, p_card jsonb, p_consent jsonb, p_deposit jsonb, p_card_client_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments;
begin
  select * into v_a from public.appointments where id = p_appointment_id;
  if v_a.id is null or v_a.client_id is null then
    raise exception 'Visit not found' using errcode = 'P0002';
  end if;
  if p_card_client_id is not null and not exists (select 1 from public.clients where id = v_a.client_id and guardian_client_id = p_card_client_id) then
    raise exception 'Only the client''s guardian can hold their card' using errcode = '42501';
  end if;
  perform private.save_card(v_a.business_id, coalesce(p_card_client_id, v_a.client_id), v_a.id, p_card, p_consent, 'online');
  perform private.record_deposit(v_a.id, p_deposit);
end;
$$;
revoke all on function public.record_online_card(uuid, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_online_card(uuid, jsonb, jsonb, jsonb, uuid) to service_role;

do $$
declare
  v_jobs text[][] := array[
    array['private.assess_policy_fee()',
      $o$select * into v_card from public.client_cards where client_id = new.client_id and removed_at is null;$o$,
      $n$v_card := private.card_on_file(new.client_id);$n$],
    array['public.retry_policy_fee(uuid)',
      $o$select * into v_card from public.client_cards where client_id = v_fee.client_id and removed_at is null;$o$,
      $n$v_card := private.card_on_file(v_fee.client_id);$n$],
    array['public.claim_policy_fees(uuid,uuid,integer)',
      $o$join public.client_cards cc on cc.client_id = c.client_id and cc.removed_at is null;$o$,
      $n$cross join lateral private.card_on_file(c.client_id) cc where cc.id is not null;$n$],
    array['private.save_card(uuid,uuid,uuid,jsonb,jsonb,text)',
      $o$where client_id = p_client_id and status = 'no_card';$o$,
      $n$where client_id in (select id from public.clients where id = p_client_id or guardian_client_id = p_client_id) and status = 'no_card';$n$],
    array['private.card_removed()',
      $o$    where authorization_id in (select id from public.card_authorizations where card_id = new.id) and removed_at is null;
  end if;$o$,
      $n$    where authorization_id in (select id from public.card_authorizations where card_id = new.id) and removed_at is null;
  end if;
  -- Dependents' fees waiting on this card, with no other card to go to.
  update public.policy_fees f set status = 'no_card', charge_after = null
  where f.status = 'pending' and (private.card_on_file(f.client_id)).id is null
    and f.client_id in (select id from public.clients where guardian_client_id = new.client_id);$n$],
    array['public.client_policy_standing(uuid)',
      $o$exists (select 1 from public.client_cards c where c.client_id = p_client_id and c.removed_at is null)$o$,
      $n$(private.card_on_file(p_client_id)).id is not null$n$],
    array['public.send_client_message(uuid,text,text,text,text,text,text)',
      $o$  v_client public.clients;
$o$,
      $n$  v_client public.clients;
  v_to public.clients;
$n$],
    array['public.send_client_message(uuid,text,text,text,text,text,text)',
      $o$  if not private.message_channel_ok(v_client, p_purpose, p_channel) then$o$,
      $n$  v_to := v_client;
  if p_purpose = 'appointment' then
    v_to := private.message_recipient(v_client);
  end if;
  if not private.message_channel_ok(v_to, p_purpose, p_channel) then$n$],
    array['public.send_client_message(uuid,text,text,text,text,text,text)',
      $o$  if p_channel = 'sms' and v_body !~* 'reply stop' then$o$,
      $n$  -- To a guardian, it always says whose visit it is.
  if v_to.id <> v_client.id and position(lower(v_client.first_name || '''s visit') in lower(v_body)) = 0 then
    v_body := 'About ' || v_client.first_name || '''s visit: ' || v_body;
  end if;
  if p_channel = 'sms' and v_body !~* 'reply stop' then$n$],
    array['public.send_client_message(uuid,text,text,text,text,text,text)',
      $o$values (v_a.business_id, p_channel, case when p_channel = 'sms' then v_client.phone_digits else v_client.email end,$o$,
      $n$values (v_a.business_id, p_channel, case when p_channel = 'sms' then v_to.phone_digits else v_to.email end,$n$]
  ];
  v_def text;
  i integer;
begin
  for i in 1 .. array_length(v_jobs, 1) loop
    v_def := pg_get_functiondef(v_jobs[i][1]::regprocedure);
    if (length(v_def) - length(replace(v_def, v_jobs[i][2], ''))) / length(v_jobs[i][2]) <> 1 then
      raise exception '% changed: update this migration (%)', v_jobs[i][1], i;
    end if;
    execute replace(v_def, v_jobs[i][2], v_jobs[i][3]);
  end loop;
end;
$$;
