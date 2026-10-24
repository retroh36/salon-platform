-- Marketing automations: rebook reminders, win-back, birthdays and review
-- requests. Template-based only (owners edit the wording; the AI never
-- writes to clients), only to clients who've said yes to texts or marketing
-- email, with an opt-out on every message, sent through the outbox until
-- texts and email are connected. lib/automations.ts decides who's due.

-- Birthdays (month and day; the year isn't needed).
alter table public.clients
  add column birth_month smallint check (birth_month between 1 and 12),
  add column birth_day smallint check (birth_day between 1 and 31),
  add constraint clients_birthday_check check ((birth_month is null) = (birth_day is null));

-- Where review requests send clients.
alter table public.businesses
  add column google_review_url text check (google_review_url ~ '^https://[^\s]{4,}$' and length(google_review_url) <= 500),
  add column yelp_url text check (yelp_url ~ '^https://[^\s]{4,}$' and length(yelp_url) <= 500);

create table public.marketing_automations (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  kind         text not null check (kind in ('rebook', 'win_back', 'birthday', 'review')),
  enabled      boolean not null default false,
  -- The email subject and the message ({first_name}, {salon}, … filled in
  -- by our code; see TEMPLATE_FIELDS in lib/automations.ts).
  subject      text not null check (length(subject) between 1 and 120),
  body         text not null check (length(body) between 1 and 1000),
  -- Timing and options: days_after_due, weeks, days_before and offer,
  -- hours_after; and prefer ('sms' or 'email').
  settings     jsonb not null default '{}',
  updated_by   uuid references public.staff (id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (business_id, kind)
);

create table public.marketing_messages (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  kind                text not null check (kind in ('rebook', 'win_back', 'birthday', 'review')),
  client_id           uuid not null references public.clients (id) on delete cascade,
  -- One per client per occasion ("rebook:2026-10-01", "birthday:2026",
  -- "review:<visit>"), so nobody hears about the same thing twice.
  cycle_key           text not null,
  channel             text not null check (channel in ('sms', 'email')),
  to_address          text not null,
  subject             text,
  body                text not null,
  appointment_id      uuid references public.appointments (id) on delete set null,
  outbox_message_id   uuid references public.outbox_messages (id) on delete set null,
  opt_out_token_hash  text not null unique check (opt_out_token_hash ~ '^[0-9a-f]{64}$'),
  opted_out_at        timestamptz,
  sent_at             timestamptz not null default now(),
  unique (client_id, kind, cycle_key)
);

create index marketing_messages_business_idx on public.marketing_messages (business_id, sent_at desc);
create index marketing_messages_client_idx on public.marketing_messages (client_id, sent_at desc);

alter table public.marketing_automations enable row level security;
alter table public.marketing_messages enable row level security;

-- Owners and managers see the automations and what was sent; owners change
-- them (save_automation). Messages are written by the nightly job only.
create policy "Owners and managers can view automations" on public.marketing_automations for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));
create policy "Owners and managers can view marketing messages" on public.marketing_messages for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create function public.save_automation(p_business_id uuid, p_kind text, p_input jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can change automations' using errcode = '42501';
  end if;
  insert into public.marketing_automations (business_id, kind, enabled, subject, body, settings, updated_by, updated_at)
  values (p_business_id, p_kind, coalesce((p_input ->> 'enabled')::boolean, false), p_input ->> 'subject', p_input ->> 'body',
          coalesce(p_input -> 'settings', '{}'), private.current_staff_id(p_business_id), now())
  on conflict (business_id, kind) do update set
    enabled = excluded.enabled, subject = excluded.subject, body = excluded.body, settings = excluded.settings,
    updated_by = excluded.updated_by, updated_at = now();
  if p_input ? 'google_review_url' or p_input ? 'yelp_url' then
    update public.businesses set
      google_review_url = case when p_input ? 'google_review_url' then nullif(trim(p_input ->> 'google_review_url'), '') else google_review_url end,
      yelp_url = case when p_input ? 'yelp_url' then nullif(trim(p_input ->> 'yelp_url'), '') else yelp_url end
    where id = p_business_id;
  end if;
end;
$$;

-- The link in a message: the client stops getting that kind of message
-- (texts, or marketing email) from the salon. Public, by the message's
-- token (only its hash is stored), with the service role.
create function public.marketing_opt_out(p_token_hash text)
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
  if v_m.channel = 'sms' then
    update public.clients set sms_opt_in = false where id = v_m.client_id;
  else
    update public.clients set email_opt_in = false where id = v_m.client_id;
  end if;
  update public.marketing_messages set opted_out_at = coalesce(opted_out_at, now()) where id = v_m.id;
  return jsonb_build_object('channel', v_m.channel, 'salon', (select name from public.businesses where id = v_m.business_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Denise's suggestions to turn an automation on (feature 'automation'):
-- proposal {"kind": "rebook"}. Applying turns it on (owners), undo turns
-- it back off.
-- ---------------------------------------------------------------------------

create function public.apply_automation_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
  v_was boolean;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null or not private.has_business_role(v_action.business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can turn automations on' using errcode = '42501';
  end if;
  if v_action.feature <> 'automation' or v_action.status <> 'proposed' then
    raise exception 'This suggestion was already decided' using errcode = '55000';
  end if;
  select enabled into v_was from public.marketing_automations where business_id = v_action.business_id and kind = v_action.proposal ->> 'kind' for update;
  if v_was is null then
    raise exception 'Set up the automation''s message first' using errcode = '55000';
  end if;
  update public.marketing_automations set enabled = true, updated_by = private.current_staff_id(business_id), updated_at = now()
  where business_id = v_action.business_id and kind = v_action.proposal ->> 'kind';
  update public.ai_actions set status = 'approved', decided_by = private.current_staff_id(business_id), decided_at = now(),
    previous_state = jsonb_build_object('kind', v_action.proposal ->> 'kind', 'enabled', v_was)
  where id = v_action.id;
end;
$$;

create function public.undo_automation_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  if v_action.id is null or not private.has_business_role(v_action.business_id, array['owner']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_action.feature <> 'automation' or v_action.status <> 'approved' then
    raise exception 'Only an applied suggestion can be undone' using errcode = '55000';
  end if;
  update public.marketing_automations set enabled = (v_action.previous_state ->> 'enabled')::boolean, updated_by = private.current_staff_id(business_id), updated_at = now()
  where business_id = v_action.business_id and kind = v_action.previous_state ->> 'kind';
  update public.ai_actions set status = 'undone', undone_by = private.current_staff_id(business_id), undone_at = now() where id = v_action.id;
end;
$$;

revoke all on function public.save_automation(uuid, text, jsonb) from public, anon;
revoke all on function public.marketing_opt_out(text) from public, anon, authenticated;
revoke all on function public.apply_automation_action(uuid) from public, anon;
revoke all on function public.undo_automation_action(uuid) from public, anon;
grant execute on function public.save_automation(uuid, text, jsonb) to authenticated;
grant execute on function public.marketing_opt_out(text) to service_role;
grant execute on function public.apply_automation_action(uuid) to authenticated;
grant execute on function public.undo_automation_action(uuid) to authenticated;
