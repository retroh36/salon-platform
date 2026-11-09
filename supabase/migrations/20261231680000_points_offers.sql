-- Points offers, set up by owners and off until they turn one on: a
-- multiplier for a date range (services and/or retail, an optional minimum
-- spend; the best one wins, in the sale's own earn row, so a partial
-- refund takes back its share) and a one-off bonus on gift card purchases
-- (a date range and a minimum amount). Points are still never earned on
-- buying a gift card otherwise.

create table public.points_offers (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses (id) on delete cascade,
  name               text not null check (length(btrim(name)) between 1 and 60),
  kind               text not null check (kind in ('multiplier', 'gift_card_bonus')),
  enabled            boolean not null default false,
  starts_on          date not null,
  ends_on            date not null,
  -- Halves only, so the sums are exact here and in lib/rewards.ts.
  multiplier         numeric(3, 1) check (multiplier between 1.5 and 5 and multiplier * 2 = floor(multiplier * 2)),
  applies_services   boolean not null default true,
  applies_retail     boolean not null default true,
  min_spend_cents    integer check (min_spend_cents > 0),
  bonus_points       integer check (bonus_points between 1 and 100000),
  min_gift_card_cents integer check (min_gift_card_cents > 0),
  created_by         uuid references public.staff (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ends_on >= starts_on),
  check ((kind = 'multiplier') = (multiplier is not null)),
  check (kind <> 'multiplier' or applies_services or applies_retail),
  check ((kind = 'gift_card_bonus') = (bonus_points is not null and min_gift_card_cents is not null))
);
create index points_offers_business on public.points_offers (business_id, ends_on);

alter table public.points_offers enable row level security;
create policy points_offers_read on public.points_offers for select to authenticated
  using (business_id in (select private.businesses_with('settings')));

-- Owners only (the billing permission, as going live is); nothing else writes.
create function public.save_points_offer(p_business_id uuid, p_offer_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(p_offer_id, gen_random_uuid());
  v_multiplier boolean := p_input ->> 'kind' = 'multiplier';
begin
  if not private.can(p_business_id, 'billing') then
    raise exception 'Only owners set up points offers' using errcode = '42501';
  end if;
  if p_offer_id is not null and not exists (select 1 from public.points_offers where id = p_offer_id and business_id = p_business_id) then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;
  insert into public.points_offers as o (
    id, business_id, name, kind, enabled, starts_on, ends_on, multiplier, applies_services, applies_retail, min_spend_cents, bonus_points, min_gift_card_cents, created_by
  ) values (
    v_id, p_business_id, btrim(p_input ->> 'name'), p_input ->> 'kind', coalesce((p_input ->> 'enabled')::boolean, false),
    (p_input ->> 'starts_on')::date, (p_input ->> 'ends_on')::date,
    case when v_multiplier then (p_input ->> 'multiplier')::numeric end,
    coalesce((p_input ->> 'applies_services')::boolean, true), coalesce((p_input ->> 'applies_retail')::boolean, true),
    case when v_multiplier then (p_input ->> 'min_spend_cents')::int end,
    case when not v_multiplier then (p_input ->> 'bonus_points')::int end,
    case when not v_multiplier then (p_input ->> 'min_gift_card_cents')::int end,
    private.current_staff_id(p_business_id)
  )
  on conflict (id) do update set
    name = excluded.name, kind = excluded.kind, enabled = excluded.enabled, starts_on = excluded.starts_on, ends_on = excluded.ends_on,
    multiplier = excluded.multiplier, applies_services = excluded.applies_services, applies_retail = excluded.applies_retail,
    min_spend_cents = excluded.min_spend_cents, bonus_points = excluded.bonus_points, min_gift_card_cents = excluded.min_gift_card_cents, updated_at = now();
  return v_id;
end;
$$;
revoke all on function public.save_points_offer(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_points_offer(uuid, uuid, jsonb) to authenticated;

alter table public.reward_points drop constraint reward_points_bonus_check;
alter table public.reward_points add constraint reward_points_bonus_check check (bonus in ('birthday', 'referral', 'rebook', 'first_visit', 'gift_card'));

-- The sale's day at its salon.
create function private.sale_local_date(p_sale public.sales)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (p_sale.created_at at time zone l.timezone)::date from public.locations l where l.id = p_sale.location_id;
$$;
revoke all on function private.sale_local_date(public.sales) from public;

-- A sale's points and the offer behind them, if one added any (the same
-- sums as pointsFor in lib/rewards.ts).
create function private.sale_points_detail(p_sale public.sales, p_program public.reward_programs, p_bonus_pct integer)
returns table (points integer, offer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select i.kind, greatest(i.total_cents - i.tax_cents, 0) as net,
           case when i.package_item_id is not null then 'package' when i.membership_credit_id is not null then 'membership' end as covered
    from public.sale_items i where i.sale_id = p_sale.id
  ), sums as (
    select
      coalesce(sum(net) filter (where kind = 'service' and (covered is null or (covered = 'package' and p_program.earn_on_packages) or (covered = 'membership' and p_program.earn_on_memberships))), 0)
        + coalesce(sum(net) filter (where kind = 'package' and p_program.earn_on_packages), 0)
        + coalesce(sum(net) filter (where kind = 'membership' and p_program.earn_on_memberships), 0) as services,
      coalesce(sum(net) filter (where kind = 'product'), 0) as retail
    from lines
  ), plain as (
    select (floor(services * p_program.service_points_per_dollar / 100.0) + floor(retail * p_program.retail_points_per_dollar / 100.0))::int as b, services, retail from sums
  ), best as (
    select o.name, x.b
    from public.points_offers o, plain p,
      lateral (select (floor(p.services * p_program.service_points_per_dollar * case when o.applies_services then o.multiplier else 1 end / 100.0)
                     + floor(p.retail * p_program.retail_points_per_dollar * case when o.applies_retail then o.multiplier else 1 end / 100.0))::int as b) x
    where o.business_id = p_sale.business_id and o.kind = 'multiplier' and o.enabled
      and private.sale_local_date(p_sale) between o.starts_on and o.ends_on
      and (o.min_spend_cents is null or p.services + p.retail >= o.min_spend_cents)
      and x.b > p.b
    order by x.b desc, o.created_at
    limit 1
  )
  select (t.b + floor(t.b * p_bonus_pct / 100.0))::int, (select name from best)
  from (select coalesce((select b from best), (select b from plain)) as b) t;
$$;
revoke all on function private.sale_points_detail(public.sales, public.reward_programs, integer) from public;

create or replace function private.sale_points(p_sale public.sales, p_program public.reward_programs, p_bonus_pct integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select points from private.sale_points_detail(p_sale, p_program, p_bonus_pct);
$$;

do $$
declare
  v_def text;
  v_pairs text[][];
  i integer;
begin
  v_def := pg_get_functiondef('private.earn_sale_points(uuid)'::regprocedure);
  v_pairs := array[
    array[
      $o$  v_earner uuid;
begin$o$,
      $n$  v_earner uuid;
  v_offer text;
  v_gift_cents integer;
  v_gift public.points_offers;
begin$n$],
    array[
      $o$  v_points := private.sale_points(v_sale, v_program, coalesce(v_tier.bonus_pct, 0));$o$,
      $n$  select d.points, d.offer_name into v_points, v_offer from private.sale_points_detail(v_sale, v_program, coalesce(v_tier.bonus_pct, 0)) d;$n$],
    array[
      $o$    insert into public.reward_points (business_id, client_id, delta, kind, sale_id, created_at)
    values (v_sale.business_id, v_earner, v_points, 'earn', v_sale.id, v_sale.created_at);
  end if;$o$,
      $n$    insert into public.reward_points (business_id, client_id, delta, kind, sale_id, reason, created_at)
    values (v_sale.business_id, v_earner, v_points, 'earn', v_sale.id, v_offer, v_sale.created_at);
  end if;

  -- An owner's offer: a one-off bonus for buying gift cards in its dates.
  select coalesce(sum(greatest(total_cents - tax_cents, 0)), 0) into v_gift_cents
  from public.sale_items where sale_id = v_sale.id and kind in ('gift_card', 'gift_card_reload');
  if v_gift_cents > 0 then
    select * into v_gift from public.points_offers o
    where o.business_id = v_sale.business_id and o.kind = 'gift_card_bonus' and o.enabled
      and private.sale_local_date(v_sale) between o.starts_on and o.ends_on
      and v_gift_cents >= o.min_gift_card_cents
    order by o.bonus_points desc, o.created_at limit 1;
    if v_gift.id is not null then
      insert into public.reward_points (business_id, client_id, delta, kind, bonus, cycle, sale_id, reason, created_at)
      values (v_sale.business_id, v_earner, v_gift.bonus_points, 'bonus', 'gift_card', 'gift_card:' || v_sale.id, v_sale.id, v_gift.name, v_sale.created_at)
      on conflict do nothing;
    end if;
  end if;$n$]
  ];
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'earn_sale_points changed: update this migration (%)', i;
    end if;
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;

  -- A returned gift card takes its bonus back, even on a partial refund.
  v_def := pg_get_functiondef('private.on_sale_refunded_points()'::regprocedure);
  v_pairs := array[array[
    $o$  v_earner := coalesce((select client_id from public.reward_points where sale_id = v_sale.id and kind = 'earn' limit 1), v_sale.client_id);$o$,
    $n$  if exists (select 1 from jsonb_array_elements(new.returned) r where r ->> 'kind' = 'gift_card') then
    insert into public.reward_points (business_id, client_id, delta, kind, sale_id, reason)
    select v_sale.business_id, b.client_id, -b.delta, 'reverse', v_sale.id, 'Gift card returned on sale #' || v_sale.number
    from public.reward_points b
    where b.sale_id = v_sale.id and b.bonus = 'gift_card'
      and not exists (select 1 from public.reward_points r where r.sale_id = v_sale.id and r.kind = 'reverse' and r.reason = 'Gift card returned on sale #' || v_sale.number);
  end if;
  v_earner := coalesce((select client_id from public.reward_points where sale_id = v_sale.id and kind = 'earn' limit 1), v_sale.client_id);$n$]];
  if (length(v_def) - length(replace(v_def, v_pairs[1][1], ''))) / length(v_pairs[1][1]) <> 1 then
    raise exception 'on_sale_refunded_points changed: update this migration';
  end if;
  execute replace(v_def, v_pairs[1][1], v_pairs[1][2]);
end;
$$;
