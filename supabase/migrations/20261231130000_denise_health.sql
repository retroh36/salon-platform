-- Whether Denise's thinking is working, not just set up. Settings said
-- "Connected: Yes" whenever the server had a key, and counted only the
-- calls that worked, so on the demo every owner's question failed (the
-- API refused the request) while Settings showed Connected and 0 requests.
--
-- Every call's outcome is now kept: record_ai_usage (a call that worked)
-- also stamps ai_health.last_ok_at, and record_ai_failure (one the API
-- refused or couldn't answer) counts it in ai_usage.failed_requests and
-- keeps when and why (a short reason code, worded by lib/denise/health.ts;
-- never the error's text). Both are service role only. Owners and managers
-- read them, like the usage.

alter table public.ai_usage add column failed_requests integer not null default 0;

create table public.ai_health (
  business_id     uuid primary key references public.businesses (id) on delete cascade,
  last_ok_at      timestamptz,
  last_failed_at  timestamptz,
  last_failure    text check (last_failure ~ '^[a-z_]{1,40}$')
);

alter table public.ai_health enable row level security;

create policy "Owners and managers can view Denise's health"
  on public.ai_health for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

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
  insert into public.ai_health (business_id, last_ok_at) values (p_business_id, now())
  on conflict (business_id) do update set last_ok_at = now();
$$;

create function public.record_ai_failure(p_business_id uuid, p_model text, p_feature text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage (business_id, day, model, feature, failed_requests)
  values (p_business_id, private.business_today(p_business_id), p_model, p_feature, 1)
  on conflict (business_id, day, model, feature) do update set failed_requests = public.ai_usage.failed_requests + 1;
  insert into public.ai_health (business_id, last_failed_at, last_failure) values (p_business_id, now(), p_reason)
  on conflict (business_id) do update set last_failed_at = now(), last_failure = excluded.last_failure;
$$;

revoke all on function public.record_ai_failure(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_ai_failure(uuid, text, text, text) to service_role;
