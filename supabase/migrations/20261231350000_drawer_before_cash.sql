-- The opening count before the first cash of the day (Coterie's 2a, made
-- firm): complete_sale refuses cash at a location that hasn't counted its
-- drawer today (hint drawer_not_counted). Cards, gift cards, "Other" and
-- refunds are never held up, and a count that's off still only warns.
-- A manager or owner can let the day's cash go ahead without a count, with
-- a reason (skip_drawer_count): kept in drawer_skips, in the audit trail,
-- and sent as an alert to everyone with `audit` but them. The seeds
-- (maestra.seeding) are exempt.

create table public.drawer_skips (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  location_id  uuid not null references public.locations (id) on delete cascade,
  day          date not null,
  reason       text not null check (length(trim(reason)) between 3 and 300),
  -- The manager or owner who allowed it, and who asked (the front desk at
  -- the checkout, when it isn't the manager themselves).
  skipped_by   uuid,
  asked_by     uuid,
  created_at   timestamptz not null default now(),
  foreign key (skipped_by, business_id) references public.staff (id, business_id) on delete set null (skipped_by),
  foreign key (asked_by, business_id) references public.staff (id, business_id) on delete set null (asked_by),
  unique (location_id, day)
);

create index drawer_skips_business_id_idx on public.drawer_skips (business_id);

alter table public.drawer_skips enable row level security;

create policy "Front of house and auditors read drawer skips" on public.drawer_skips for select to authenticated
  using (business_id in (select private.front_of_house_businesses()) or business_id in (select private.audit_businesses()));

-- Whether the location's drawer is ready for cash today: counted, or a
-- manager let the day go ahead without it.
create function private.drawer_ready(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with d as (select (now() at time zone l.timezone)::date as day from public.locations l where l.id = p_location_id)
  select exists (select 1 from public.drawer_counts c, d where c.location_id = p_location_id and c.day = d.day and c.kind = 'open')
      or exists (select 1 from public.drawer_skips s, d where s.location_id = p_location_id and s.day = d.day);
$$;

revoke all on function private.drawer_ready(uuid) from public;

-- A manager or owner lets today's cash go ahead without the opening count.
create function public.skip_drawer_count(p_location_id uuid, p_reason text, p_asked_by uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_tz text;
  v_me uuid;
  v_day date;
begin
  select l.business_id, l.timezone into v_business, v_tz from public.locations l where l.id = p_location_id;
  if v_business is null or not private.has_business_role(v_business, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only a manager or owner can skip the drawer count' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception 'Say why the drawer isn''t being counted' using errcode = '22023', hint = 'reason';
  end if;
  if p_asked_by is not null and not exists (select 1 from public.staff where id = p_asked_by and business_id = v_business) then
    p_asked_by := null;
  end if;
  v_me := private.current_staff_id(v_business);
  v_day := (now() at time zone v_tz)::date;
  if private.drawer_ready(p_location_id) then
    return;
  end if;
  insert into public.drawer_skips (business_id, location_id, day, reason, skipped_by, asked_by)
  values (v_business, p_location_id, v_day, trim(p_reason), v_me, nullif(p_asked_by, v_me));
  perform private.send_alert(v_business, p_location_id, v_me, 'alert_drawer_skipped',
    private.alert_who(v_me) || ' let cash be taken today without the opening drawer count'
      || case when nullif(p_asked_by, v_me) is not null then ' (asked by ' || private.alert_who(p_asked_by) || ')' else '' end || ': ' || trim(p_reason) || '.');
end;
$$;

revoke all on function public.skip_drawer_count(uuid, text, uuid) from public, anon;
grant execute on function public.skip_drawer_count(uuid, text, uuid) to authenticated;

do $$
declare
  v_def text := pg_get_functiondef('public.complete_sale(uuid,jsonb)'::regprocedure);
  v_old text := $o$    if v_pay ->> 'method' = 'other' and length(trim(coalesce(v_pay ->> 'reference', ''))) not between 3 and 200 then$o$;
  v_new text := $n$    if v_pay ->> 'method' = 'cash' and coalesce((v_pay ->> 'amount_cents')::int, 0) > 0
       and coalesce(current_setting('maestra.seeding', true), '') <> 'on' and not private.drawer_ready(p_location_id) then
      raise exception 'Count the cash drawer before taking cash today' using errcode = '55000', hint = 'drawer_not_counted';
    end if;
    if v_pay ->> 'method' = 'other' and length(trim(coalesce(v_pay ->> 'reference', ''))) not between 3 and 200 then$n$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'complete_sale changed: update this migration';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
