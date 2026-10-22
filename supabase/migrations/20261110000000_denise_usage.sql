-- What Denise's use of the Claude API costs each salon, a daily limit, and
-- a cache for her morning brief.
--
-- The server records every call's tokens (record_ai_usage, service role
-- only) by salon, day, model and feature. When a salon reaches its daily
-- limit (businesses.ai_daily_token_limit, input plus output tokens), Denise
-- falls back to template wording until the next day. Owners and managers
-- can see the usage.

alter table public.businesses
  add column ai_daily_token_limit integer not null default 1500000 check (ai_daily_token_limit >= 0);

create table public.ai_usage (
  business_id        uuid not null references public.businesses (id) on delete cascade,
  day                date not null,
  model              text not null check (length(model) <= 60),
  feature            text not null check (feature ~ '^[a-z_]{1,40}$'),
  requests           integer not null default 0,
  input_tokens       bigint not null default 0,
  output_tokens      bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  primary key (business_id, day, model, feature)
);

alter table public.ai_usage enable row level security;

create policy "Owners and managers can view AI usage"
  on public.ai_usage for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

create function public.record_ai_usage(p_business_id uuid, p_model text, p_feature text, p_input bigint, p_output bigint, p_cache_read bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage (business_id, day, model, feature, requests, input_tokens, output_tokens, cache_read_tokens)
  values (p_business_id, current_date, p_model, p_feature, 1, greatest(p_input, 0), greatest(p_output, 0), greatest(p_cache_read, 0))
  on conflict (business_id, day, model, feature) do update set
    requests = public.ai_usage.requests + 1,
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    cache_read_tokens = public.ai_usage.cache_read_tokens + excluded.cache_read_tokens;
$$;

-- Tokens used today and the salon's limit.
create function public.ai_usage_today(p_business_id uuid)
returns table (used bigint, daily_limit integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(u.input_tokens + u.output_tokens) from public.ai_usage u where u.business_id = p_business_id and u.day = current_date), 0)::bigint,
         b.ai_daily_token_limit
  from public.businesses b where b.id = p_business_id;
$$;

revoke all on function public.record_ai_usage(uuid, text, text, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.ai_usage_today(uuid) from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, text, text, bigint, bigint, bigint) to service_role;
grant execute on function public.ai_usage_today(uuid) to service_role;

-- The morning brief as Claude wrote it, for one location and day, kept
-- while the facts it was written from (their hash) stay the same.
create table public.denise_briefs (
  location_id  uuid not null references public.locations (id) on delete cascade,
  day          date not null,
  facts_hash   text not null check (facts_hash ~ '^[0-9a-f]{64}$'),
  text         text not null check (length(text) <= 2000),
  model        text not null,
  created_at   timestamptz not null default now(),
  primary key (location_id, day)
);

alter table public.denise_briefs enable row level security;
