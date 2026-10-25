-- "Today" is the salon's day, not UTC's. current_date is UTC's, so in
-- Chicago it turns over at 7pm (6pm in winter): Denise's daily limit reset
-- in the evening and counted the evening's use toward tomorrow, an
-- evening inquiry from the booking site for an event that day was refused
-- as past, and a photo consent dated today was checked against UTC's date.

-- The salon's today, at its first location (as the booking site and
-- automations take it).
create function private.business_today(p_business_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select l.timezone from public.locations l where l.business_id = p_business_id order by l.created_at limit 1),
    'UTC'))::date;
$$;

revoke all on function private.business_today(uuid) from public;
grant execute on function private.business_today(uuid) to authenticated, service_role;

create or replace function public.record_ai_usage(p_business_id uuid, p_model text, p_feature text, p_input bigint, p_output bigint, p_cache_read bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage (business_id, day, model, feature, requests, input_tokens, output_tokens, cache_read_tokens)
  values (p_business_id, private.business_today(p_business_id), p_model, p_feature, 1, greatest(p_input, 0), greatest(p_output, 0), greatest(p_cache_read, 0))
  on conflict (business_id, day, model, feature) do update set
    requests = public.ai_usage.requests + 1,
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    cache_read_tokens = public.ai_usage.cache_read_tokens + excluded.cache_read_tokens;
$$;

create or replace function public.ai_usage_today(p_business_id uuid)
returns table (used bigint, daily_limit integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(u.input_tokens + u.output_tokens) from public.ai_usage u where u.business_id = p_business_id and u.day = private.business_today(p_business_id)), 0)::bigint,
         b.ai_daily_token_limit
  from public.businesses b where b.id = p_business_id;
$$;

CREATE OR REPLACE FUNCTION public.save_event_inquiry(p_business_id uuid, p_input jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_location uuid;
  v_client uuid;
  v_id uuid;
  v_first text := left(trim(coalesce(p_input ->> 'first_name', '')), 80);
  v_date date := (p_input ->> 'event_date')::date;
begin
  if not exists (select 1 from public.event_settings where business_id = p_business_id and inquiries_enabled) then
    raise exception 'This salon isn''t taking event inquiries online' using errcode = '55000';
  end if;
  if v_first = '' or v_date is null or v_date < private.business_today(p_business_id) then
    raise exception 'Add your name and a date that hasn''t passed' using errcode = '22023';
  end if;
  select id into v_location from public.locations where business_id = p_business_id order by created_at limit 1;
  v_client := public.find_online_client(p_business_id, p_input ->> 'phone', p_input ->> 'email', v_first, p_input ->> 'last_name', p_input ->> 'phone');
  insert into public.events (business_id, location_id, client_id, title, event_date, ready_by, venue_name, on_location, notes, source, inquiry_party_size, inquiry_services)
  values (p_business_id, v_location, v_client,
    left(concat(v_first, '''s ', coalesce(nullif(p_input ->> 'kind', ''), 'event')), 120), v_date,
    nullif(p_input ->> 'ready_by', '')::timestamptz,
    nullif(left(trim(coalesce(p_input ->> 'venue', '')), 200), ''),
    coalesce((p_input ->> 'on_location')::boolean, false),
    nullif(left(coalesce(p_input ->> 'notes', ''), 4000), ''), 'online',
    (p_input ->> 'party_size')::smallint, nullif(left(coalesce(p_input ->> 'services', ''), 500), ''))
  returning id into v_id;
  insert into public.event_history (business_id, event_id, kind, detail) values (p_business_id, v_id, 'inquiry', 'Sent from the booking site');
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_photo_consent(p_client_id uuid, p_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_business uuid;
begin
  select business_id into v_business from public.clients where id = p_client_id;
  if v_business is null or not private.is_business_member(v_business) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_on > private.business_today(v_business) then
    raise exception 'Consent can''t be dated in the future' using errcode = '22023';
  end if;
  update public.clients set photo_consent_on = p_on, photo_consent_by = case when p_on is null then null else private.current_staff_id(v_business) end where id = p_client_id;
  if p_on is null then
    update public.visit_photos set marketing_ok = false, marketing_marked_by = private.current_staff_id(v_business), marketing_marked_at = now()
    where client_id = p_client_id and marketing_ok;
  end if;
end;
$function$;
