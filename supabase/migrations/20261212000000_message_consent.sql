-- Message consent (lib/messaging/): two separate consents per client,
-- appointment messages (reminders, changes, confirmations) and marketing
-- (sms_opt_in / email_opt_in, as before), STOP honoured on every text,
-- staff messages to clients with an upcoming visit, and a log of every
-- consent and opt-out with when and where it came from.

-- Appointment messages: on unless the client turned them off (they gave
-- the number to book). A STOP turns off every text, appointment ones too,
-- until they text START; appointment messages then go by email.
alter table public.clients
  add column appointment_sms_ok boolean not null default true,
  add column appointment_email_ok boolean not null default true,
  add column sms_stopped_at timestamptz;

-- Numbers that replied STOP, across every salon (texts come from
-- Maestra's numbers, so a STOP stops them all). Service role only.
create table public.sms_suppressions (
  phone_digits  text primary key,
  stopped_at    timestamptz not null default now(),
  keyword       text not null
);
alter table public.sms_suppressions enable row level security;

-- Every consent given or taken back, and where it came from.
create table public.client_consent_events (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  client_id    uuid not null references public.clients (id) on delete cascade,
  purpose      text not null check (purpose in ('appointment', 'marketing')),
  channel      text not null check (channel in ('sms', 'email')),
  granted      boolean not null,
  source       text not null check (source in ('online_booking', 'client_account', 'staff', 'sms_keyword', 'unsubscribe_link', 'import', 'system')),
  detail       text,
  staff_id     uuid references public.staff (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index client_consent_events_client_idx on public.client_consent_events (client_id, created_at desc);
alter table public.client_consent_events enable row level security;

create policy "Front of house see consent history"
  on public.client_consent_events for select to authenticated
  using ((select private.front_of_house(business_id)));

-- Logs each consent that changed on a client. Where it came from is set
-- by the function making the change (maestra.consent_source), else staff
-- (signed in) or the system.
create function private.log_consent_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.current_staff_id(new.business_id);
  v_source text := coalesce(nullif(current_setting('maestra.consent_source', true), ''), case when v_staff is null then 'system' else 'staff' end);
  v_detail text := nullif(current_setting('maestra.consent_detail', true), '');
begin
  if tg_op = 'UPDATE' and new.sms_stopped_at is distinct from old.sms_stopped_at then
    insert into public.client_consent_events (business_id, client_id, purpose, channel, granted, source, detail, staff_id)
    values (new.business_id, new.id, 'appointment', 'sms', new.sms_stopped_at is null, v_source, v_detail, v_staff);
  end if;
  if tg_op = 'INSERT' or new.appointment_sms_ok is distinct from old.appointment_sms_ok then
    if tg_op = 'UPDATE' or not new.appointment_sms_ok then
      insert into public.client_consent_events (business_id, client_id, purpose, channel, granted, source, detail, staff_id)
      values (new.business_id, new.id, 'appointment', 'sms', new.appointment_sms_ok, v_source, v_detail, v_staff);
    end if;
  end if;
  if tg_op = 'UPDATE' and new.appointment_email_ok is distinct from old.appointment_email_ok then
    insert into public.client_consent_events (business_id, client_id, purpose, channel, granted, source, detail, staff_id)
    values (new.business_id, new.id, 'appointment', 'email', new.appointment_email_ok, v_source, v_detail, v_staff);
  end if;
  if (tg_op = 'INSERT' and new.sms_opt_in) or (tg_op = 'UPDATE' and new.sms_opt_in is distinct from old.sms_opt_in) then
    insert into public.client_consent_events (business_id, client_id, purpose, channel, granted, source, detail, staff_id)
    values (new.business_id, new.id, 'marketing', 'sms', new.sms_opt_in, v_source, v_detail, v_staff);
  end if;
  if (tg_op = 'INSERT' and new.email_opt_in) or (tg_op = 'UPDATE' and new.email_opt_in is distinct from old.email_opt_in) then
    insert into public.client_consent_events (business_id, client_id, purpose, channel, granted, source, detail, staff_id)
    values (new.business_id, new.id, 'marketing', 'email', new.email_opt_in, v_source, v_detail, v_staff);
  end if;
  return new;
end;
$$;

create trigger clients_log_consent after insert or update of sms_opt_in, email_opt_in, appointment_sms_ok, appointment_email_ok, sms_stopped_at on public.clients
  for each row execute function private.log_consent_changes();

-- A number that replied STOP stays stopped on any client who has it, even
-- one added later; and staff can't turn texts back on for it (only START).
create function private.keep_sms_stopped()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- phone_digits is generated after this runs, so work it out here.
  v_digits text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  v_stopped timestamptz := (select stopped_at from public.sms_suppressions where phone_digits = v_digits);
begin
  if v_stopped is not null then
    new.sms_stopped_at := coalesce(new.sms_stopped_at, v_stopped);
  elsif tg_op = 'UPDATE' and v_digits is distinct from regexp_replace(coalesce(old.phone, ''), '\D', '', 'g') then
    new.sms_stopped_at := null;
  elsif tg_op = 'UPDATE' and old.sms_stopped_at is not null and new.sms_stopped_at is null and coalesce(current_setting('maestra.consent_source', true), '') <> 'sms_keyword' then
    new.sms_stopped_at := old.sms_stopped_at;
  end if;
  return new;
end;
$$;

create trigger clients_keep_sms_stopped before insert or update of phone, sms_stopped_at on public.clients
  for each row execute function private.keep_sms_stopped();

-- A text from a client: STOP (and its synonyms) stops every text to the
-- number; START (or UNSTOP) lets appointment texts through again (offers
-- need a new yes); HELP says how. Returns what to reply.
create function public.sms_keyword(p_phone_digits text, p_body text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_word text := upper(regexp_replace(coalesce(p_body, ''), '[^A-Za-z]', '', 'g'));
begin
  if p_phone_digits !~ '^\d{10}$' then
    return null;
  end if;
  perform set_config('maestra.consent_source', 'sms_keyword', true);
  perform set_config('maestra.consent_detail', v_word, true);
  if v_word in ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT') then
    insert into public.sms_suppressions (phone_digits, keyword) values (p_phone_digits, v_word)
    on conflict (phone_digits) do update set stopped_at = now(), keyword = excluded.keyword;
    update public.clients set sms_stopped_at = now(), sms_opt_in = false where phone_digits = p_phone_digits and sms_stopped_at is null;
    update public.clients set sms_opt_in = false where phone_digits = p_phone_digits and sms_opt_in;
    return 'stop';
  elsif v_word in ('START', 'UNSTOP', 'YES', 'OPTIN') then
    delete from public.sms_suppressions where phone_digits = p_phone_digits;
    update public.clients set sms_stopped_at = null where phone_digits = p_phone_digits and sms_stopped_at is not null;
    return 'start';
  elsif v_word in ('HELP', 'INFO') then
    return 'help';
  end if;
  return null;
end;
$$;

-- Consent from a client themselves (online booking, their account) or
-- staff recording what a client said, with where it came from.
-- p_changes: any of appointment_sms_ok, appointment_email_ok, sms_opt_in,
-- email_opt_in (booleans).
create function public.set_client_consent(p_client_id uuid, p_changes jsonb, p_source text, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.clients where id = p_client_id);
  v_old public.clients;
begin
  if v_business is null then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  -- Staff (signed in) record what a client told them; the booking site and
  -- client accounts call this with the service role.
  if auth.role() <> 'service_role' then
    if not private.front_of_house(v_business) then
      raise exception 'Only the front of house can change a client''s messages' using errcode = '42501';
    end if;
    p_source := 'staff';
  elsif p_source not in ('online_booking', 'client_account', 'import', 'system') then
    raise exception 'Unknown consent source' using errcode = '22023';
  end if;
  perform set_config('maestra.consent_source', p_source, true);
  perform set_config('maestra.consent_detail', coalesce(left(p_detail, 500), ''), true);
  select * into v_old from public.clients where id = p_client_id;
  update public.clients set
    appointment_sms_ok = coalesce((p_changes->>'appointment_sms_ok')::boolean, appointment_sms_ok),
    appointment_email_ok = coalesce((p_changes->>'appointment_email_ok')::boolean, appointment_email_ok),
    sms_opt_in = coalesce((p_changes->>'sms_opt_in')::boolean, sms_opt_in),
    email_opt_in = coalesce((p_changes->>'email_opt_in')::boolean, email_opt_in)
  where id = p_client_id;
  -- A yes or no that didn't change anything is still what they said (the
  -- trigger logs the changes).
  insert into public.client_consent_events (business_id, client_id, purpose, channel, granted, source, detail, staff_id)
  select v_business, p_client_id, k.purpose, k.channel, (p_changes->>k.key)::boolean, p_source, nullif(left(p_detail, 500), ''), private.current_staff_id(v_business)
  from (values
    ('appointment_sms_ok', 'appointment', 'sms', v_old.appointment_sms_ok),
    ('appointment_email_ok', 'appointment', 'email', v_old.appointment_email_ok),
    ('sms_opt_in', 'marketing', 'sms', v_old.sms_opt_in),
    ('email_opt_in', 'marketing', 'email', v_old.email_opt_in)
  ) as k (key, purpose, channel, before)
  where p_changes ? k.key and (p_changes->>k.key)::boolean = k.before;
end;
$$;

-- The unsubscribe link (marketing only: appointment messages carry on),
-- now logged as the link.
create or replace function public.marketing_opt_out(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.marketing_messages;
begin
  select * into v_m from public.marketing_messages where opt_out_token_hash = p_token_hash for update;
  if v_m.id is null then
    return null;
  end if;
  perform set_config('maestra.consent_source', 'unsubscribe_link', true);
  perform set_config('maestra.consent_detail', v_m.kind, true);
  if v_m.channel = 'sms' then
    update public.clients set sms_opt_in = false where id = v_m.client_id;
  else
    update public.clients set email_opt_in = false where id = v_m.client_id;
  end if;
  update public.marketing_messages set opted_out_at = coalesce(opted_out_at, now()) where id = v_m.id;
  return jsonb_build_object('channel', v_m.channel, 'salon', (select name from public.businesses where id = v_m.business_id));
end;
$$;

-- Messages staff send a client: a quick-pick template filled in by our
-- code, or free text the staff member writes ('custom'). Never AI-written:
-- Denise doesn't write to or message clients. About the visit (appointment
-- consent) or an offer (marketing consent, with an unsubscribe link).
create table public.client_messages (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  client_id       uuid not null references public.clients (id) on delete cascade,
  appointment_id  uuid references public.appointments (id) on delete set null,
  purpose         text not null check (purpose in ('appointment', 'marketing')),
  template        text not null check (template in ('running_late', 'please_call', 'need_to_move', 'reminder', 'ready_early', 'custom')),
  channel         text not null check (channel in ('sms', 'email')),
  subject         text,
  body            text not null,
  sent_by         uuid references public.staff (id) on delete set null,
  outbox_id       uuid references public.outbox_messages (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index client_messages_client_idx on public.client_messages (client_id, created_at desc);
alter table public.client_messages enable row level security;

create policy "Front of house see messages; staff see their own"
  on public.client_messages for select to authenticated
  using ((select private.front_of_house(business_id)) or (select private.is_current_staff(business_id, sent_by)));

-- Which roles can write their own messages (owners always can). Owners
-- change it on Settings → Messages.
alter table public.businesses
  add column free_text_roles public.staff_role[] not null default array['manager', 'front_desk', 'stylist']::public.staff_role[];

create function public.set_free_text_roles(p_business_id uuid, p_roles text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners change who can write messages' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_roles, '{}')) r where r not in ('manager', 'front_desk', 'stylist')) then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  update public.businesses set free_text_roles = (select coalesce(array_agg(distinct r::public.staff_role), '{}') from unnest(coalesce(p_roles, '{}')) r)
  where id = p_business_id;
end;
$$;

-- Staff offers go in marketing_messages too, for their unsubscribe link.
alter table public.marketing_messages drop constraint marketing_messages_kind_check;
alter table public.marketing_messages add constraint marketing_messages_kind_check check (kind in ('rebook', 'win_back', 'birthday', 'review', 'staff'));

-- Whether a message of this kind can reach a client on a channel.
create function private.message_channel_ok(p_client public.clients, p_purpose text, p_channel text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_channel
    when 'sms' then coalesce(p_client.phone_digits, '') <> '' and p_client.sms_stopped_at is null
      and case p_purpose when 'appointment' then p_client.appointment_sms_ok else p_client.sms_opt_in end
    when 'email' then p_client.email is not null
      and case p_purpose when 'appointment' then p_client.appointment_email_ok else p_client.email_opt_in end
    else false
  end;
$$;

-- Sends a staff message to the client of an upcoming visit: the front of
-- house, or a stylist on the visit; free text only for the roles the owner
-- allows; only on a channel the client allows for that kind of message.
-- Texts always end with how to stop them; offers carry the unsubscribe
-- link our code made (p_opt_out_hash: its token's sha256).
create function public.send_client_message(
  p_appointment_id uuid, p_purpose text, p_template text, p_channel text, p_subject text, p_body text, p_opt_out_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments;
  v_client public.clients;
  v_staff uuid;
  v_role public.staff_role;
  v_free_text public.staff_role[];
  v_body text := btrim(coalesce(p_body, ''));
  v_outbox uuid;
  v_id uuid;
begin
  select * into v_a from public.appointments where id = p_appointment_id;
  if v_a.id is null then
    raise exception 'Visit not found' using errcode = 'P0002';
  end if;
  v_staff := private.current_staff_id(v_a.business_id);
  select role into v_role from public.staff where id = v_staff;
  select free_text_roles into v_free_text from public.businesses where id = v_a.business_id;
  if v_staff is null or not (
    private.front_of_house(v_a.business_id)
    or exists (select 1 from public.appointment_items i where i.appointment_id = v_a.id and i.staff_id = v_staff)
  ) then
    raise exception 'Only the front of house or a stylist on the visit can message the client' using errcode = '42501';
  end if;
  if p_template = 'custom' and v_role <> 'owner'
     and not v_role = any (v_free_text) then
    raise exception 'Writing your own messages is turned off for your role; choose a quick pick' using errcode = '42501', hint = 'free_text';
  end if;
  if p_purpose not in ('appointment', 'marketing') or (p_purpose = 'marketing' and p_template <> 'custom') then
    raise exception 'Choose what the message is about' using errcode = '22023';
  end if;
  if v_a.status not in ('booked', 'confirmed', 'checked_in') or v_a.ends_at < now() - interval '2 hours' then
    raise exception 'Messages are for upcoming visits' using errcode = '55000';
  end if;
  select * into v_client from public.clients where id = v_a.client_id;
  if v_client.id is null then
    raise exception 'This visit has no client' using errcode = '55000';
  end if;
  if not private.message_channel_ok(v_client, p_purpose, p_channel) then
    raise exception 'The client doesn''t get % %', case when p_purpose = 'marketing' then 'offers by' else 'visit' end,
      case when p_channel = 'sms' then 'texts' else 'emails' end using errcode = '55000', hint = 'channel';
  end if;
  if length(v_body) not between 1 and 1000 then
    raise exception 'Write a message (up to 1,000 characters)' using errcode = '22023';
  end if;
  if p_channel = 'sms' and v_body !~* 'reply stop' then
    v_body := v_body || ' Reply STOP to stop texts.';
  end if;
  if p_purpose = 'marketing' and coalesce(p_opt_out_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Offers need their unsubscribe link' using errcode = '22023';
  end if;
  insert into public.outbox_messages (business_id, channel, to_address, subject, body)
  values (v_a.business_id, p_channel, case when p_channel = 'sms' then v_client.phone_digits else v_client.email end,
    case when p_channel = 'email' then left(btrim(coalesce(p_subject, '')), 120) end, v_body)
  returning id into v_outbox;
  insert into public.client_messages (business_id, client_id, appointment_id, purpose, template, channel, subject, body, sent_by, outbox_id)
  values (v_a.business_id, v_client.id, v_a.id, p_purpose, p_template, p_channel,
    case when p_channel = 'email' then left(btrim(coalesce(p_subject, '')), 120) end, v_body, v_staff, v_outbox)
  returning id into v_id;
  if p_purpose = 'marketing' then
    insert into public.marketing_messages (business_id, kind, client_id, cycle_key, channel, to_address, subject, body, appointment_id, outbox_message_id, opt_out_token_hash)
    values (v_a.business_id, 'staff', v_client.id, 'staff:' || v_id, p_channel,
      case when p_channel = 'sms' then v_client.phone_digits else v_client.email end, p_subject, v_body, v_a.id, v_outbox, p_opt_out_hash);
  end if;
  return v_id;
end;
$$;

revoke all on function private.log_consent_changes() from public;
revoke all on function private.keep_sms_stopped() from public;
revoke all on function private.message_channel_ok(public.clients, text, text) from public;
revoke all on function public.sms_keyword(text, text) from public, anon, authenticated;
revoke all on function public.set_client_consent(uuid, jsonb, text, text) from public, anon;
revoke all on function public.set_free_text_roles(uuid, text[]) from public, anon;
revoke all on function public.send_client_message(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.sms_keyword(text, text) to service_role;
grant execute on function public.set_client_consent(uuid, jsonb, text, text) to authenticated, service_role;
grant execute on function public.set_free_text_roles(uuid, text[]) to authenticated;
grant execute on function public.send_client_message(uuid, text, text, text, text, text, text) to authenticated;
