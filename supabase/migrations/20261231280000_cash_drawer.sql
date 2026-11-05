-- The cash drawer through the day (Coterie's 2a): the front of house counts
-- it when the salon opens and whenever they like during the day, against
-- what the drawer should hold (worked out here, never taken from the app),
-- and the close-out (Reports) records the bank deposit, so what's left in
-- the drawer is what the next opening count is checked against. A count
-- that's off sends an alert to everyone with `audit` (like a void). A
-- missing opening count only warns: nothing stops a cash sale.
--
-- Expected:
-- - opening: what the last close-out left in the drawer (counted less the
--   deposit), else the salon's usual float;
-- - during the day: the opening count (else what it should have been) plus
--   the day's cash so far (refunds and voids taken off);
-- - the close-out: as before, starting from the opening count when there is
--   one.

create table public.drawer_counts (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null references public.locations (id) on delete cascade,
  day             date not null,
  kind            text not null check (kind in ('open', 'mid')),
  expected_cents  integer not null,
  counted_cents   integer not null check (counted_cents between 0 and 10000000),
  note            text check (length(note) <= 300),
  counted_by      uuid,
  counted_at      timestamptz not null default now(),
  foreign key (counted_by, business_id) references public.staff (id, business_id) on delete set null (counted_by)
);

-- One opening count a day (counting again replaces it); any number during
-- the day.
create unique index drawer_counts_one_open on public.drawer_counts (location_id, day) where kind = 'open';
create index drawer_counts_location_day_idx on public.drawer_counts (location_id, day, counted_at);
create index drawer_counts_business_id_idx on public.drawer_counts (business_id);

alter table public.drawer_counts enable row level security;

create policy "Front of house and auditors read drawer counts" on public.drawer_counts for select to authenticated
  using (business_id in (select private.front_of_house_businesses()) or business_id in (select private.audit_businesses()));

alter table public.cash_closeouts
  add column deposit_cents integer not null default 0 check (deposit_cents between 0 and 10000000),
  add constraint cash_closeouts_deposit_within check (deposit_cents <= counted_cents);

-- What the drawer should hold at the opening of p_day.
create function private.drawer_opening_expected(p_location_id uuid, p_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.counted_cents - c.deposit_cents from public.cash_closeouts c
     where c.location_id = p_location_id and c.day < p_day order by c.day desc limit 1),
    (select b.cash_float_cents from public.locations l join public.businesses b on b.id = l.business_id where l.id = p_location_id),
    0);
$$;

-- The day's cash at the location up to p_until (refunds and voids are
-- negative payments).
create function private.drawer_cash(p_location_id uuid, p_day date, p_until timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.amount_cents), 0)::int
  from public.payments p, public.locations l
  where l.id = p_location_id and p.location_id = p_location_id and p.method = 'cash'
    and p.created_at >= (p_day::timestamp at time zone l.timezone)
    and p.created_at < least(p_until, ((p_day + 1)::timestamp at time zone l.timezone));
$$;

revoke all on function private.drawer_opening_expected(uuid, date) from public;
revoke all on function private.drawer_cash(uuid, date, timestamptz) from public;

-- The front of house counts the drawer: 'open' (today's opening, once,
-- counting again replaces it) or 'mid'. Returns counted less expected.
create function public.count_drawer(p_location_id uuid, p_kind text, p_counted_cents integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_tz text;
  v_day date;
  v_expected integer;
  v_me uuid;
  v_diff integer;
begin
  select l.business_id, l.timezone into v_business, v_tz from public.locations l where l.id = p_location_id;
  if v_business is null or not private.front_of_house(v_business) then
    raise exception 'Only the front desk, managers and owners count the drawer' using errcode = '42501';
  end if;
  if p_kind not in ('open', 'mid') then
    raise exception 'Choose the opening count or a count during the day' using errcode = '22023';
  end if;
  if p_counted_cents is null or p_counted_cents < 0 or p_counted_cents > 10000000 then
    raise exception 'Enter the cash counted' using errcode = '22023';
  end if;
  v_day := (now() at time zone v_tz)::date;
  v_me := private.current_staff_id(v_business);
  if p_kind = 'open' then
    v_expected := private.drawer_opening_expected(p_location_id, v_day);
    insert into public.drawer_counts (business_id, location_id, day, kind, expected_cents, counted_cents, note, counted_by)
    values (v_business, p_location_id, v_day, 'open', v_expected, p_counted_cents, nullif(trim(p_note), ''), v_me)
    on conflict (location_id, day) where kind = 'open' do update set
      expected_cents = excluded.expected_cents, counted_cents = excluded.counted_cents, note = excluded.note,
      counted_by = excluded.counted_by, counted_at = now();
  else
    v_expected := coalesce(
      (select d.counted_cents from public.drawer_counts d where d.location_id = p_location_id and d.day = v_day and d.kind = 'open'),
      private.drawer_opening_expected(p_location_id, v_day)
    ) + private.drawer_cash(p_location_id, v_day, now());
    insert into public.drawer_counts (business_id, location_id, day, kind, expected_cents, counted_cents, note, counted_by)
    values (v_business, p_location_id, v_day, 'mid', v_expected, p_counted_cents, nullif(trim(p_note), ''), v_me);
  end if;
  v_diff := p_counted_cents - v_expected;
  if v_diff <> 0 then
    perform private.send_alert(v_business, p_location_id, v_me, 'alert_drawer_off',
      private.alert_who(v_me) || '''s ' || case p_kind when 'open' then 'opening' else 'midday' end || ' drawer count was '
        || private.money_text(abs(v_diff)) || case when v_diff > 0 then ' over' else ' short' end
        || coalesce(': ' || nullif(trim(p_note), ''), '') || '.');
  end if;
  return v_diff;
end;
$$;

revoke all on function public.count_drawer(uuid, text, integer, text) from public, anon;
grant execute on function public.count_drawer(uuid, text, integer, text) to authenticated;

-- The close-out, as before, starting from the day's opening count when
-- there is one, with the deposit (what goes to the bank; the rest stays
-- for tomorrow), and an alert when it's off.
drop function public.save_closeout(uuid, date, integer, text, integer);

create function public.save_closeout(p_location_id uuid, p_day date, p_counted_cents integer, p_note text, p_float_cents integer default null, p_deposit_cents integer default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_tz text;
  v_float integer;
  v_expected integer;
  v_deposit integer;
  v_me uuid;
begin
  select l.business_id, l.timezone into v_business_id, v_tz from public.locations l where l.id = p_location_id;
  if v_business_id is null or not private.can(v_business_id, 'reports') then
    raise exception 'Only owners can close out the day' using errcode = '42501';
  end if;
  if p_counted_cents is null or p_counted_cents < 0 then
    raise exception 'Enter the cash counted' using errcode = '22023';
  end if;
  if p_float_cents is not null and (p_float_cents < 0 or p_float_cents > 1000000) then
    raise exception 'Enter the starting float' using errcode = '22023';
  end if;
  v_deposit := coalesce(p_deposit_cents, (select c.deposit_cents from public.cash_closeouts c where c.location_id = p_location_id and c.day = p_day), 0);
  if v_deposit < 0 or v_deposit > p_counted_cents then
    raise exception 'The deposit can''t be more than the cash counted' using errcode = '22023';
  end if;
  v_float := coalesce(
    p_float_cents,
    (select c.float_cents from public.cash_closeouts c where c.location_id = p_location_id and c.day = p_day),
    (select d.counted_cents from public.drawer_counts d where d.location_id = p_location_id and d.day = p_day and d.kind = 'open'),
    (select b.cash_float_cents from public.businesses b where b.id = v_business_id)
  );
  select v_float + coalesce(sum(p.amount_cents), 0)::int into v_expected
  from public.payments p
  where p.location_id = p_location_id and p.method = 'cash'
    and p.created_at >= (p_day::timestamp at time zone v_tz) and p.created_at < ((p_day + 1)::timestamp at time zone v_tz);

  v_me := private.current_staff_id(v_business_id);
  insert into public.cash_closeouts (business_id, location_id, day, expected_cents, counted_cents, float_cents, deposit_cents, note, closed_by)
  values (v_business_id, p_location_id, p_day, v_expected, p_counted_cents, v_float, v_deposit, nullif(trim(p_note), ''), v_me)
  on conflict (location_id, day) do update set
    expected_cents = excluded.expected_cents, counted_cents = excluded.counted_cents, float_cents = excluded.float_cents,
    deposit_cents = excluded.deposit_cents, note = excluded.note, closed_by = excluded.closed_by, closed_at = now();
  if p_counted_cents <> v_expected then
    perform private.send_alert(v_business_id, p_location_id, v_me, 'alert_drawer_off',
      private.alert_who(v_me) || '''s close-out count was ' || private.money_text(abs(p_counted_cents - v_expected))
        || case when p_counted_cents > v_expected then ' over' else ' short' end
        || coalesce(': ' || nullif(trim(p_note), ''), '') || '.');
  end if;
  return p_counted_cents - v_expected;
end;
$$;

revoke all on function public.save_closeout(uuid, date, integer, text, integer, integer) from public, anon;
grant execute on function public.save_closeout(uuid, date, integer, text, integer, integer) to authenticated;
