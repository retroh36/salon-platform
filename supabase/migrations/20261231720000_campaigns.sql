-- Campaigns: one message, written by staff, to a list of clients from a
-- client report. Never written by Denise. Only clients who said yes to
-- offers on that channel get it, with an unsubscribe link, and each is
-- logged with who sent it. Into the outbox like every message.

create table public.campaigns (
  id          uuid primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  report      jsonb not null,
  description text not null,
  subject     text not null,
  body        text not null,
  sent_count  integer not null,
  left_out    integer not null,
  sent_by     uuid references public.staff (id) on delete set null,
  sent_at     timestamptz not null default now()
);
create index campaigns_business on public.campaigns (business_id, sent_at desc);

alter table public.campaigns enable row level security;
create policy campaigns_read on public.campaigns for select to authenticated
  using (business_id in (select private.businesses_with('settings')));

alter table public.marketing_messages
  add column campaign_id uuid references public.campaigns (id) on delete set null,
  drop constraint marketing_messages_kind_check,
  add constraint marketing_messages_kind_check check (kind in ('rebook', 'win_back', 'birthday', 'review', 'staff', 'promotion', 'campaign'));
create index marketing_messages_campaign on public.marketing_messages (campaign_id) where campaign_id is not null;

alter table public.client_messages
  add column campaign_id uuid references public.campaigns (id) on delete set null;

-- p_campaign_id is made when the form opens, so sending twice sends once.
-- p_recipients: [{client_id, channel, body, opt_out_hash}]; anyone who
-- can't be sent it now is skipped and counted.
create function public.send_campaign(
  p_business_id uuid, p_campaign_id uuid, p_name text, p_report jsonb, p_description text,
  p_subject text, p_body text, p_left_out integer, p_recipients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_role public.staff_role;
  v_free_text public.staff_role[];
  v_tz text;
  v_minute integer;
  v_subject text := left(btrim(coalesce(p_subject, '')), 120);
  v_row jsonb;
  v_client public.clients;
  v_channel text;
  v_body text;
  v_to text;
  v_message uuid;
  v_outbox uuid;
  v_sent integer := 0;
  v_skipped integer := 0;
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers send campaigns' using errcode = '42501';
  end if;
  v_staff := private.current_staff_id(p_business_id);
  select role into v_role from public.staff where id = v_staff;
  select free_text_roles into v_free_text from public.businesses where id = p_business_id;
  if v_role <> 'owner' and not v_role = any (v_free_text) then
    raise exception 'Writing your own messages is turned off for your role' using errcode = '42501', hint = 'free_text';
  end if;
  select l.timezone into v_tz from public.locations l where l.business_id = p_business_id order by l.created_at limit 1;
  v_minute := extract(hour from now() at time zone v_tz)::int * 60 + extract(minute from now() at time zone v_tz)::int;
  if v_minute < 9 * 60 or v_minute >= 20 * 60 then
    raise exception 'Campaigns go out between 9am and 8pm' using errcode = '55000', hint = 'hours';
  end if;
  if length(v_subject) = 0 or length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'Write a subject and a message (up to 1,000 characters)' using errcode = '22023';
  end if;

  begin
    insert into public.campaigns (id, business_id, name, report, description, subject, body, sent_count, left_out, sent_by)
    values (p_campaign_id, p_business_id, btrim(p_name), p_report, p_description, v_subject, p_body, 0, 0, v_staff);
  exception when unique_violation then
    raise exception 'This campaign has already been sent' using errcode = '55000', hint = 'sent';
  end;

  for v_row in select * from jsonb_array_elements(p_recipients) loop
    v_channel := v_row ->> 'channel';
    v_body := btrim(coalesce(v_row ->> 'body', ''));
    select * into v_client from public.clients where id = (v_row ->> 'client_id')::uuid and business_id = p_business_id;
    if v_client.id is null
       or v_channel not in ('sms', 'email')
       or not private.message_channel_ok(v_client, 'marketing', v_channel)
       or coalesce(v_row ->> 'opt_out_hash', '') !~ '^[0-9a-f]{64}$'
       or v_body = ''
       or exists (select 1 from public.marketing_messages m where m.client_id = v_client.id and m.kind <> 'review' and m.sent_at > now() - interval '7 days') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_to := case when v_channel = 'sms' then v_client.phone_digits else v_client.email end;
    insert into public.marketing_messages (business_id, kind, client_id, cycle_key, channel, to_address, subject, body, opt_out_token_hash, campaign_id)
    values (p_business_id, 'campaign', v_client.id, 'campaign:' || p_campaign_id, v_channel, v_to, case when v_channel = 'email' then v_subject end, v_body, v_row ->> 'opt_out_hash', p_campaign_id)
    returning id into v_message;
    insert into public.outbox_messages (business_id, channel, to_address, subject, body)
    values (p_business_id, v_channel, v_to, case when v_channel = 'email' then v_subject end, v_body)
    returning id into v_outbox;
    update public.marketing_messages set outbox_message_id = v_outbox where id = v_message;
    insert into public.client_messages (business_id, client_id, purpose, template, channel, subject, body, sent_by, outbox_id, campaign_id)
    values (p_business_id, v_client.id, 'marketing', 'custom', v_channel, case when v_channel = 'email' then v_subject end, v_body, v_staff, v_outbox, p_campaign_id);
    v_sent := v_sent + 1;
  end loop;

  if v_sent = 0 then
    raise exception 'Nobody on this list can get it right now' using errcode = '55000', hint = 'nobody';
  end if;
  update public.campaigns set sent_count = v_sent, left_out = coalesce(p_left_out, 0) + v_skipped where id = p_campaign_id;
  return jsonb_build_object('sent', v_sent, 'skipped', v_skipped);
end;
$$;
revoke all on function public.send_campaign(uuid, uuid, text, jsonb, text, text, text, integer, jsonb) from public, anon;
grant execute on function public.send_campaign(uuid, uuid, text, jsonb, text, text, text, integer, jsonb) to authenticated;
