-- Scheduled jobs run by the database (pg_cron), so they work on any
-- hosting plan: each one calls one of our secured endpoints
-- (/api/cron/…, which check CRON_SECRET) through pg_net. Where the app is
-- and the secret are kept in Supabase Vault, set once per environment with
-- `npm run jobs:configure`; until then the jobs do nothing. The schedule
-- (UTC) is documented in docs/operations.md.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- The app's address and the cron secret, in Vault (service role only).
-- Null for both turns the jobs off.
create function public.configure_scheduled_jobs(p_app_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_app_url is null and p_secret is null then
    delete from vault.secrets where name in ('scheduled_jobs_app_url', 'scheduled_jobs_secret');
    return;
  end if;
  if p_app_url !~ '^https?://[^\s/]+(:\d+)?$' then
    raise exception 'The app''s address, like https://app.example.com (no path)' using errcode = '22023';
  end if;
  if length(coalesce(p_secret, '')) < 16 then
    raise exception 'The cron secret is at least 16 characters' using errcode = '22023';
  end if;
  select id into v_id from vault.secrets where name = 'scheduled_jobs_app_url';
  if v_id is null then perform vault.create_secret(p_app_url, 'scheduled_jobs_app_url'); else perform vault.update_secret(v_id, p_app_url); end if;
  v_id := null;
  select id into v_id from vault.secrets where name = 'scheduled_jobs_secret';
  if v_id is null then perform vault.create_secret(p_secret, 'scheduled_jobs_secret'); else perform vault.update_secret(v_id, p_secret); end if;
end;
$$;

-- Calls one job's endpoint (the request goes out when this transaction
-- commits; responses are kept a while in net._http_response). Returns the
-- request id, or null when jobs aren't configured.
create function private.run_scheduled_job(p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_path !~ '^/api/cron/[a-z-]+$' then
    raise exception 'Not a scheduled job' using errcode = '22023';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'scheduled_jobs_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'scheduled_jobs_secret';
  if v_url is null or v_secret is null then
    raise notice 'Scheduled jobs aren''t configured (npm run jobs:configure)';
    return null;
  end if;
  return net.http_get(
    url := v_url || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 300000
  );
end;
$$;

-- Run a job now (operations and tests), service role only.
create function public.run_scheduled_job_now(p_path text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.run_scheduled_job(p_path);
$$;

-- What's scheduled, and each job's last few runs (service role only).
create function public.scheduled_jobs_status()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
    'configured', exists (select 1 from vault.secrets s where s.name = 'scheduled_jobs_app_url'),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('at', r.start_time, 'status', r.status, 'message', r.return_message) order by r.start_time desc), '[]')
             from (select * from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 3) r)
  ) order by j.jobname), '[]')
  from cron.job j where j.jobname like 'maestra-%';
$$;

revoke all on function public.configure_scheduled_jobs(text, text) from public, anon, authenticated;
revoke all on function private.run_scheduled_job(text) from public;
revoke all on function public.run_scheduled_job_now(text) from public, anon, authenticated;
revoke all on function public.scheduled_jobs_status() from public, anon, authenticated;
grant execute on function public.configure_scheduled_jobs(text, text) to service_role;
grant execute on function public.run_scheduled_job_now(text) to service_role;
grant execute on function public.scheduled_jobs_status() to service_role;

-- The schedule (UTC; a salon in Chicago is 5 or 6 hours behind).
select cron.schedule('maestra-photo-backup', '0 7 * * *', $$select private.run_scheduled_job('/api/cron/photo-backup')$$);
select cron.schedule('maestra-insights', '0 8 * * *', $$select private.run_scheduled_job('/api/cron/insights')$$);
select cron.schedule('maestra-risk-check', '0 9 * * *', $$select private.run_scheduled_job('/api/cron/risk')$$);
select cron.schedule('maestra-risk-check-morning', '0 12 * * *', $$select private.run_scheduled_job('/api/cron/risk')$$);
select cron.schedule('maestra-memberships', '0 10 * * *', $$select private.run_scheduled_job('/api/cron/memberships')$$);
select cron.schedule('maestra-automations', '15 * * * *', $$select private.run_scheduled_job('/api/cron/automations')$$);
