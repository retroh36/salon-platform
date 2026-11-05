-- Going live: real texts (Twilio), email (Resend) and card payments
-- (Stripe) plug in behind what's there, switched on per salon.
--
-- Everything that messages a client still writes to outbox_messages, as
-- before. Each message now carries a delivery status: 'held' (the outbox
-- only, as before: the salon isn't live) or 'queued' (to be sent for real),
-- decided when it's written, from the salon's own "Go live" switch. The app
-- sends queued messages (/api/cron/messages) only on the production site
-- (lib/live.ts), whatever this table says, so the demo and staging can
-- never send one. A message written while a salon wasn't live is never
-- sent later, and one still queued after an hour expires rather than go
-- out late (an old sign-in code, a reminder for a visit that's passed).

-- 1. The switches, and the salon's Stripe account (Stripe Connect).
alter table public.businesses
  add column messages_live boolean not null default false,
  add column messages_live_at timestamptz,
  add column payments_live boolean not null default false,
  add column payments_live_at timestamptz,
  add column stripe_account_id text check (stripe_account_id ~ '^acct_[A-Za-z0-9]{1,60}$'),
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_details_submitted boolean not null default false,
  add column stripe_checked_at timestamptz;

create unique index businesses_stripe_account_idx on public.businesses (stripe_account_id) where stripe_account_id is not null;

-- Nobody signed in changes these directly: the switches only through
-- set_go_live (owners, the billing permission), the Stripe account only
-- from the server (the service role, after Stripe says so).
create function private.guard_live_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (new.messages_live, new.messages_live_at, new.payments_live, new.payments_live_at)
       is distinct from (old.messages_live, old.messages_live_at, old.payments_live, old.payments_live_at)
     and coalesce(current_setting('maestra.go_live', true), '') <> 'on' then
    raise exception 'Going live is changed on Settings' using errcode = '42501';
  end if;
  if (new.stripe_account_id, new.stripe_charges_enabled, new.stripe_details_submitted, new.stripe_checked_at)
       is distinct from (old.stripe_account_id, old.stripe_charges_enabled, old.stripe_details_submitted, old.stripe_checked_at) then
    raise exception 'The Stripe account is set by connecting it' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger businesses_guard_live before update on public.businesses
  for each row execute function private.guard_live_columns();

-- Every change to going live, with who (owners read it).
create table public.go_live_events (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  kind         text not null check (kind in ('messages', 'payments', 'stripe_connected', 'stripe_disconnected')),
  turned_on    boolean not null,
  staff_id     uuid,
  created_at   timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete set null (staff_id)
);

create index go_live_events_business_idx on public.go_live_events (business_id, created_at desc);

alter table public.go_live_events enable row level security;

create policy go_live_events_read on public.go_live_events for select to authenticated
  using (business_id in (select private.businesses_with('billing')));

-- Turns real texts and email ('messages') or real card payments
-- ('payments') on or off for the salon. The app checks first that this is
-- the production site and the keys are set (lib/live.ts); this checks who.
create function public.set_go_live(p_kind text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff s where s.user_id = (select auth.uid()) and s.is_active limit 1;
  if v_staff.id is null or not private.can(v_staff.business_id, 'billing') then
    raise exception 'Only owners turn this on or off' using errcode = '42501';
  end if;
  if p_kind not in ('messages', 'payments') or p_on is null then
    raise exception 'Messages or payments, on or off' using errcode = '22023';
  end if;
  perform set_config('maestra.go_live', 'on', true);
  if p_kind = 'messages' then
    update public.businesses set messages_live = p_on, messages_live_at = case when p_on then now() end
     where id = v_staff.business_id and messages_live is distinct from p_on;
  else
    update public.businesses set payments_live = p_on, payments_live_at = case when p_on then now() end
     where id = v_staff.business_id and payments_live is distinct from p_on;
  end if;
  if found then
    insert into public.go_live_events (business_id, kind, turned_on, staff_id) values (v_staff.business_id, p_kind, p_on, v_staff.id);
  end if;
end;
$$;

revoke all on function public.set_go_live(text, boolean) from public, anon;
grant execute on function public.set_go_live(text, boolean) to authenticated;

-- The salon's Stripe account, from the server once Stripe has answered
-- (connecting, the return from Stripe's onboarding, and account.updated).
-- p_staff is who connected it (null from a webhook).
create function public.set_stripe_account(p_business_id uuid, p_account_id text, p_charges_enabled boolean, p_details_submitted boolean, p_staff_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  select stripe_account_id into v_old from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'Salon not found' using errcode = 'P0002';
  end if;
  update public.businesses
     set stripe_account_id = p_account_id,
         stripe_charges_enabled = coalesce(p_charges_enabled, false) and p_account_id is not null,
         stripe_details_submitted = coalesce(p_details_submitted, false) and p_account_id is not null,
         stripe_checked_at = now(),
         -- Disconnecting turns live payments off with it.
         payments_live = payments_live and p_account_id is not null
   where id = p_business_id;
  if v_old is distinct from p_account_id then
    insert into public.go_live_events (business_id, kind, turned_on, staff_id)
    values (p_business_id, case when p_account_id is null then 'stripe_disconnected' else 'stripe_connected' end, p_account_id is not null, p_staff_id);
  end if;
end;
$$;

-- account.updated from Stripe: the account's status, by its id.
create function public.stripe_account_updated(p_account_id text, p_charges_enabled boolean, p_details_submitted boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.businesses
     set stripe_charges_enabled = coalesce(p_charges_enabled, false),
         stripe_details_submitted = coalesce(p_details_submitted, false),
         stripe_checked_at = now()
   where stripe_account_id = p_account_id;
$$;

revoke all on function public.set_stripe_account(uuid, text, boolean, boolean, uuid) from public, anon, authenticated;
revoke all on function public.stripe_account_updated(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.set_stripe_account(uuid, text, boolean, boolean, uuid) to service_role;
grant execute on function public.stripe_account_updated(text, boolean, boolean) to service_role;

-- 2. Delivery: each outbox message's status at the text or email provider.
alter table public.outbox_messages
  add column status text not null default 'held'
    check (status in ('held', 'queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'suppressed', 'expired')),
  add column provider text check (provider in ('twilio', 'resend')),
  add column provider_id text check (length(provider_id) <= 100),
  add column attempts smallint not null default 0,
  add column sent_at timestamptz,
  -- A short code (the provider's error code, "not_connected"…), never the
  -- message or the address.
  add column error text check (length(error) <= 60),
  add column updated_at timestamptz;

create index outbox_messages_queued_idx on public.outbox_messages (created_at) where status in ('queued', 'sending');
create unique index outbox_messages_provider_idx on public.outbox_messages (provider, provider_id) where provider_id is not null;

-- Queued for real only when the salon is live (a message with no salon,
-- like a reply in the dev outbox, never is).
create function private.outbox_status_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.status := case
    when new.business_id is not null and exists (select 1 from public.businesses b where b.id = new.business_id and b.messages_live) then 'queued'
    else 'held'
  end;
  new.attempts := 0;
  new.provider := null;
  new.provider_id := null;
  new.sent_at := null;
  new.error := null;
  return new;
end;
$$;

create trigger outbox_messages_status before insert on public.outbox_messages
  for each row execute function private.outbox_status_on_insert();

-- Sends queued messages straight away (the minute job is the fallback):
-- one call per statement, when jobs are configured.
create function private.outbox_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from new_rows where status = 'queued') then
    perform private.run_scheduled_job('/api/cron/messages');
  end if;
  return null;
end;
$$;

create trigger outbox_messages_kick after insert on public.outbox_messages
  referencing new table as new_rows
  for each statement execute function private.outbox_kick();

-- Addresses that bounced or marked the salon's email as spam: never
-- emailed again (like sms_suppressions for texts). Service role only.
create table public.email_suppressions (
  email       text primary key check (email = lower(email)),
  reason      text not null check (reason in ('bounce', 'complaint')),
  created_at  timestamptz not null default now()
);

alter table public.email_suppressions enable row level security;

-- Takes up to p_limit queued messages to send (service role, the sender):
-- first expires those queued over an hour, and fails any left 'sending'
-- for 10 minutes (it may have gone, so it's never sent twice).
create function public.claim_outbox_messages(p_limit integer)
returns table (id uuid, business_id uuid, salon text, channel text, to_address text, subject text, body text, html text, attempts smallint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.outbox_messages o set status = 'expired', error = 'too_late', updated_at = now()
   where o.status = 'queued' and o.created_at < now() - interval '1 hour';
  update public.outbox_messages o set status = 'failed', error = 'interrupted', updated_at = now()
   where o.status = 'sending' and o.updated_at < now() - interval '10 minutes';
  return query
  with picked as (
    select o.id from public.outbox_messages o
     where o.status = 'queued'
     order by o.created_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update public.outbox_messages o
     set status = 'sending', attempts = o.attempts + 1, updated_at = now()
    from picked
   where o.id = picked.id
  returning o.id, o.business_id, (select b.name from public.businesses b where b.id = o.business_id), o.channel, o.to_address, o.subject, o.body, o.html, o.attempts;
end;
$$;

-- What happened when it was sent: 'sent' with the provider's id, 'queued'
-- to try again (a busy provider), 'held' (that channel isn't connected, so
-- it stays in the outbox), or 'failed' / 'suppressed' with a code.
create function public.record_outbox_result(p_id uuid, p_status text, p_provider text, p_provider_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'queued', 'held', 'failed', 'suppressed') then
    raise exception 'Not a sending result' using errcode = '22023';
  end if;
  update public.outbox_messages
     set status = p_status,
         provider = coalesce(p_provider, provider),
         provider_id = coalesce(p_provider_id, provider_id),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         error = left(p_error, 60),
         updated_at = now()
   where id = p_id and status = 'sending';
end;
$$;

-- What the provider said later (Twilio's status callback, Resend's
-- webhook): delivered, failed or bounced. A bounce or a spam complaint
-- stops email to that address; a text the carrier refused because the
-- number replied STOP (Twilio's 21610) is recorded as a STOP.
create function public.outbox_delivery_update(p_provider text, p_provider_id text, p_status text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.outbox_messages;
  v_email text;
begin
  if p_status not in ('delivered', 'failed', 'bounced', 'complained') then
    raise exception 'Not a delivery status' using errcode = '22023';
  end if;
  select * into v_msg from public.outbox_messages where provider = p_provider and provider_id = p_provider_id for update;
  if v_msg.id is null then
    return;
  end if;
  -- A complaint keeps its delivered status; the address is suppressed.
  if p_status <> 'complained' and v_msg.status in ('sent', 'delivered') then
    update public.outbox_messages
       set status = p_status, error = left(p_error, 60), updated_at = now()
     where id = v_msg.id;
  end if;
  if v_msg.channel = 'email' and p_status in ('bounced', 'complained') then
    v_email := lower(trim(v_msg.to_address));
    insert into public.email_suppressions (email, reason) values (v_email, case when p_status = 'bounced' then 'bounce' else 'complaint' end)
    on conflict (email) do nothing;
    if p_status = 'complained' then
      perform set_config('maestra.consent_source', 'system', true);
      perform set_config('maestra.consent_detail', 'Marked as spam', true);
      update public.clients set email_opt_in = false where lower(email) = v_email and email_opt_in;
    end if;
  end if;
  if v_msg.channel = 'sms' and p_error = '21610' then
    perform public.sms_keyword(right(regexp_replace(v_msg.to_address, '\D', '', 'g'), 10), 'STOP');
  end if;
end;
$$;

revoke all on function public.claim_outbox_messages(integer) from public, anon, authenticated;
revoke all on function public.record_outbox_result(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.outbox_delivery_update(text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_outbox_messages(integer) to service_role;
grant execute on function public.record_outbox_result(uuid, text, text, text, text) to service_role;
grant execute on function public.outbox_delivery_update(text, text, text, text) to service_role;

-- The sender, every minute (it sends nothing unless a salon is live and
-- this is the production site).
select cron.schedule('maestra-messages', '* * * * *', $$select private.run_scheduled_job('/api/cron/messages')$$);
