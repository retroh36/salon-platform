-- The salon's rewards program (lib/rewards.ts mirrors the maths): points
-- per dollar on services and retail, bonuses, optional tiers with perks,
-- a catalog of rewards taken at checkout, expiry, referrals, manual
-- adjustments with a reason, and points taken back on refunds and voids.
--
-- Every change to a client's points is a row in reward_points (the
-- ledger); a balance is their sum. Points are earned by the database when
-- a sale completes (any sale: the checkout, a payment link, an event,
-- a renewal), so nothing is missed and nothing earns twice.

-- ---------------------------------------------------------------------------
-- The program, tiers and catalog (whoever has the settings permission).
-- ---------------------------------------------------------------------------

create table public.reward_programs (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  enabled boolean not null default false,
  service_points_per_dollar integer not null default 1 check (service_points_per_dollar between 0 and 100),
  retail_points_per_dollar integer not null default 1 check (retail_points_per_dollar between 0 and 100),
  earn_on_packages boolean not null default false,
  earn_on_memberships boolean not null default false,
  birthday_points integer not null default 0 check (birthday_points between 0 and 100000),
  referral_points integer not null default 0 check (referral_points between 0 and 100000),
  rebook_points integer not null default 0 check (rebook_points between 0 and 100000),
  first_visit_points integer not null default 0 check (first_visit_points between 0 and 100000),
  expiry_months integer check (expiry_months between 1 and 120),
  min_redeem_points integer not null default 0 check (min_redeem_points between 0 and 1000000),
  stack_with_promotions boolean not null default false,
  tier_basis text not null default 'spend' check (tier_basis in ('spend', 'visits')),
  updated_by uuid references public.staff (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.reward_programs enable row level security;

create table public.reward_tiers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  -- Cents spent, or visits, in the last 12 months.
  threshold integer not null check (threshold >= 0),
  bonus_pct integer not null default 0 check (bonus_pct between 0 and 500),
  free_addon_service_id uuid references public.services (id) on delete set null,
  priority_booking boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, threshold)
);
create index reward_tiers_business on public.reward_tiers (business_id);
alter table public.reward_tiers enable row level security;

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  points integer not null check (points between 1 and 1000000),
  kind text not null check (kind in ('amount', 'percent', 'free_service')),
  amount_cents integer check (amount_cents between 1 and 100000),
  percent integer check (percent between 1 and 100),
  applies_services boolean not null default true,
  applies_retail boolean not null default true,
  service_ids uuid[],
  max_per_year integer check (max_per_year between 1 and 365),
  min_tier_id uuid references public.reward_tiers (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind <> 'amount' or amount_cents is not null),
  check (kind <> 'percent' or percent is not null),
  check (kind <> 'free_service' or cardinality(service_ids) = 1),
  check (kind = 'free_service' or applies_services or applies_retail)
);
create index rewards_business on public.rewards (business_id);
alter table public.rewards enable row level security;

create policy "Staff see their salon's rewards program" on public.reward_programs
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy "Staff see their salon's tiers" on public.reward_tiers
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy "Staff see their salon's rewards" on public.rewards
  for select to authenticated using ((select private.is_business_member(business_id)));

-- ---------------------------------------------------------------------------
-- Clients: referral codes and who referred them.
-- ---------------------------------------------------------------------------

alter table public.clients add column referral_code text, add column referred_by uuid references public.clients (id) on delete set null;
create unique index clients_referral_code on public.clients (business_id, referral_code) where referral_code is not null;

-- ---------------------------------------------------------------------------
-- The ledger.
-- ---------------------------------------------------------------------------

create table public.reward_points (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  delta integer not null check (delta <> 0),
  kind text not null check (kind in ('earn', 'bonus', 'redeem', 'adjust', 'expire', 'reverse', 'restore')),
  -- Bonuses: birthday, referral, rebook, first_visit.
  bonus text check (bonus in ('birthday', 'referral', 'rebook', 'first_visit')),
  -- Each bonus once per occasion ("birthday:2026", "first_visit",
  -- "referral:<client>").
  cycle text,
  sale_id uuid references public.sales (id) on delete set null,
  reward_id uuid references public.rewards (id) on delete set null,
  -- What a redeemed reward took off the sale.
  discount_cents integer,
  reason text check (length(reason) <= 200),
  staff_id uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'bonus') = (bonus is not null)),
  check (kind <> 'adjust' or length(trim(reason)) > 0)
);
create index reward_points_client on public.reward_points (client_id, created_at);
create index reward_points_sale on public.reward_points (sale_id) where sale_id is not null;
create index reward_points_business on public.reward_points (business_id, created_at);
create unique index reward_points_once on public.reward_points (client_id, cycle) where cycle is not null;
alter table public.reward_points enable row level security;

create policy "Front of house see points" on public.reward_points
  for select to authenticated using ((select private.front_of_house(business_id)));

-- ---------------------------------------------------------------------------
-- Tiers and balances.
-- ---------------------------------------------------------------------------

-- What a client spent on services, retail, packages and memberships (after
-- discounts, before tax and tips, less refunds; never gift cards) and how
-- many visits they checked out in the 12 months to p_at, leaving out one
-- sale (the one being earned on).
create function private.reward_activity(p_client_id uuid, p_at timestamptz, p_except_sale uuid default null)
returns table (spend_cents integer, visits integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(greatest(x.net - x.refunded_cents, 0)) from (
                select s.refunded_cents,
                       (select coalesce(sum(i.total_cents - i.tax_cents), 0) from public.sale_items i
                        where i.sale_id = s.id and i.kind not in ('gift_card', 'gift_card_reload')) as net
                from public.sales s
                where s.client_id = p_client_id and s.status <> 'voided' and s.created_at > p_at - interval '12 months' and s.created_at <= p_at
                  and s.id is distinct from p_except_sale) x), 0)::int,
    (select count(*) from public.appointments a
     where a.client_id = p_client_id and a.status = 'completed' and a.checked_out_at > p_at - interval '12 months' and a.checked_out_at <= p_at
       and a.id is distinct from (select s.appointment_id from public.sales s where s.id = p_except_sale))::int;
$$;

-- The tier a client is in at a moment: the highest threshold reached.
create function private.reward_tier(p_client_id uuid, p_at timestamptz default now(), p_except_sale uuid default null)
returns public.reward_tiers
language sql
stable
security definer
set search_path = ''
as $$
  select t.* from public.clients c
  join public.reward_programs p on p.business_id = c.business_id
  cross join lateral private.reward_activity(c.id, p_at, p_except_sale) a
  join public.reward_tiers t on t.business_id = c.business_id
  where c.id = p_client_id
    and t.threshold <= case when p.tier_basis = 'visits' then a.visits else a.spend_cents end
  order by t.threshold desc
  limit 1;
$$;

create function private.points_balance(p_client_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(delta), 0)::int from public.reward_points where client_id = p_client_id;
$$;

-- ---------------------------------------------------------------------------
-- Earning, when a sale completes (at commit, once its lines are in).
-- ---------------------------------------------------------------------------

create function private.sale_points(p_sale public.sales, p_program public.reward_programs, p_bonus_pct integer)
returns integer
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
  )
  select (b + floor(b * p_bonus_pct / 100.0))::int
  from (select (floor(services * p_program.service_points_per_dollar / 100.0) + floor(retail * p_program.retail_points_per_dollar / 100.0))::int as b from sums) x;
$$;

create function private.earn_sale_points(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_program public.reward_programs;
  v_tier public.reward_tiers;
  v_points integer;
  v_client public.clients;
  v_first boolean;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null or v_sale.client_id is null or v_sale.status = 'voided' then
    return;
  end if;
  select * into v_program from public.reward_programs where business_id = v_sale.business_id;
  if v_program.business_id is null or not v_program.enabled then
    return;
  end if;
  -- Already earned (a backfill run twice).
  if exists (select 1 from public.reward_points where sale_id = v_sale.id and kind = 'earn') then
    return;
  end if;
  v_tier := private.reward_tier(v_sale.client_id, v_sale.created_at, v_sale.id);
  v_points := private.sale_points(v_sale, v_program, coalesce(v_tier.bonus_pct, 0));
  if v_points > 0 then
    insert into public.reward_points (business_id, client_id, delta, kind, sale_id, created_at)
    values (v_sale.business_id, v_sale.client_id, v_points, 'earn', v_sale.id, v_sale.created_at);
  end if;

  -- Booking their next visit before leaving.
  if v_sale.rebook_appointment_id is not null and v_program.rebook_points > 0 then
    insert into public.reward_points (business_id, client_id, delta, kind, bonus, cycle, sale_id, created_at)
    values (v_sale.business_id, v_sale.client_id, v_program.rebook_points, 'bonus', 'rebook', 'rebook:' || v_sale.id, v_sale.id, v_sale.created_at)
    on conflict do nothing;
  end if;

  -- Their first visit: a bonus, and the referral bonus for both clients.
  v_first := v_sale.appointment_id is not null and not private.visited_before(v_sale.client_id, v_sale.appointment_id);
  if v_first then
    if v_program.first_visit_points > 0 then
      insert into public.reward_points (business_id, client_id, delta, kind, bonus, cycle, sale_id, created_at)
      values (v_sale.business_id, v_sale.client_id, v_program.first_visit_points, 'bonus', 'first_visit', 'first_visit', v_sale.id, v_sale.created_at)
      on conflict do nothing;
    end if;
    select * into v_client from public.clients where id = v_sale.client_id;
    if v_client.referred_by is not null and v_program.referral_points > 0 then
      insert into public.reward_points (business_id, client_id, delta, kind, bonus, cycle, sale_id, reason, created_at)
      values (v_sale.business_id, v_client.id, v_program.referral_points, 'bonus', 'referral', 'referred', v_sale.id, null, v_sale.created_at),
             (v_sale.business_id, v_client.referred_by, v_program.referral_points, 'bonus', 'referral', 'referral:' || v_client.id, v_sale.id, null, v_sale.created_at)
      on conflict do nothing;
    end if;
  end if;
end;
$$;

create function private.on_sale_earn_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.earn_sale_points(new.id);
  return null;
end;
$$;

create constraint trigger sales_earn_points after insert on public.sales
  deferrable initially deferred
  for each row execute function private.on_sale_earn_points();

-- A void takes back everything the sale earned and gives back every
-- reward it used.
create function private.on_sale_voided_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reward_points (business_id, client_id, delta, kind, sale_id, reason)
  select new.business_id, client_id, -sum(delta), 'reverse', new.id, 'Sale #' || new.number || ' voided'
  from public.reward_points where sale_id = new.id and kind in ('earn', 'bonus', 'reverse')
  group by client_id having sum(delta) > 0;
  insert into public.reward_points (business_id, client_id, delta, kind, sale_id, reward_id, reason)
  select new.business_id, client_id, -sum(delta), 'restore', new.id, reward_id, 'Sale #' || new.number || ' voided'
  from public.reward_points where sale_id = new.id and kind in ('redeem', 'restore')
  group by client_id, reward_id having sum(delta) < 0;
  return new;
end;
$$;

create trigger sales_points_void after update of status on public.sales
  for each row when (old.status is distinct from 'voided' and new.status = 'voided')
  execute function private.on_sale_voided_points();

-- A refund takes back the same share of the points the sale earned as the
-- share of its money given back (all of it, bonuses too, and the rewards
-- it used given back, once the whole sale is refunded).
create function private.on_sale_refunded_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_earned integer;
  v_left integer;
  v_back integer;
begin
  select * into v_sale from public.sales where id = new.sale_id;
  if v_sale.client_id is null or new.amount_cents is null or new.amount_cents <= 0 then
    return new;
  end if;
  if v_sale.refunded_cents >= v_sale.total_cents then
    insert into public.reward_points (business_id, client_id, delta, kind, sale_id, reason)
    select v_sale.business_id, client_id, -sum(delta), 'reverse', v_sale.id, 'Sale #' || v_sale.number || ' refunded'
    from public.reward_points where sale_id = v_sale.id and kind in ('earn', 'bonus', 'reverse')
    group by client_id having sum(delta) > 0;
    insert into public.reward_points (business_id, client_id, delta, kind, sale_id, reward_id, reason)
    select v_sale.business_id, client_id, -sum(delta), 'restore', v_sale.id, reward_id, 'Sale #' || v_sale.number || ' refunded'
    from public.reward_points where sale_id = v_sale.id and kind in ('redeem', 'restore')
    group by client_id, reward_id having sum(delta) < 0;
    return new;
  end if;
  select coalesce(sum(delta) filter (where kind = 'earn'), 0), coalesce(sum(delta) filter (where kind in ('earn', 'reverse')), 0)
    into v_earned, v_left
  from public.reward_points where sale_id = v_sale.id and client_id = v_sale.client_id and kind in ('earn', 'reverse');
  -- As pointsBack in lib/rewards.ts: rounded up, never more than is left.
  v_back := least(v_left, ceil(v_earned::numeric * new.amount_cents / nullif(v_sale.total_cents, 0))::int);
  if v_back > 0 then
    insert into public.reward_points (business_id, client_id, delta, kind, sale_id, reason)
    values (v_sale.business_id, v_sale.client_id, -v_back, 'reverse', v_sale.id, 'Sale #' || v_sale.number || ' partly refunded');
  end if;
  return new;
end;
$$;

create trigger sale_events_refund_points after insert on public.sale_events
  for each row when (new.kind = 'refunded')
  execute function private.on_sale_refunded_points();

-- ---------------------------------------------------------------------------
-- Redeeming at checkout: complete_sale takes reward_ids and prices each
-- reward like a promotion (after promotions; a free service is the first
-- line for it, in full), then records the points it took.
-- ---------------------------------------------------------------------------

-- Why a client can't take these rewards on one sale (raised), as
-- rewardsProblem in lib/rewards.ts. Locks the client's points first.
create function private.check_rewards(p_business_id uuid, p_client_id uuid, p_reward_ids uuid[], p_promotions integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs;
  v_tier public.reward_tiers;
  v_need public.reward_tiers;
  v_reward public.rewards;
  v_balance integer;
  v_first boolean := true;
  v_used integer;
begin
  select * into v_program from public.reward_programs where business_id = p_business_id;
  if v_program.business_id is null or not v_program.enabled then
    raise exception 'The rewards program is off' using errcode = '22023', hint = 'reward';
  end if;
  if p_client_id is null then
    raise exception 'Choose the client taking the reward' using errcode = '22023', hint = 'reward';
  end if;
  if p_promotions > 0 and not v_program.stack_with_promotions then
    raise exception 'Rewards can''t be used with a promotion' using errcode = '22023', hint = 'reward';
  end if;
  -- One checkout at a time spends a client's points.
  perform 1 from public.clients where id = p_client_id for update;
  v_balance := private.points_balance(p_client_id);
  v_tier := private.reward_tier(p_client_id);
  foreach v_reward.id in array p_reward_ids loop
    select * into v_reward from public.rewards where id = v_reward.id;
    if v_first and v_balance < v_program.min_redeem_points then
      raise exception 'Rewards start at % points', v_program.min_redeem_points using errcode = '22023', hint = 'reward';
    end if;
    if v_balance < v_reward.points then
      raise exception '%: % more points needed', v_reward.name, v_reward.points - v_balance using errcode = '22023', hint = 'reward';
    end if;
    if v_reward.max_per_year is not null then
      select count(*) filter (where kind = 'redeem') - count(*) filter (where kind = 'restore') into v_used
      from public.reward_points where client_id = p_client_id and reward_id = v_reward.id and created_at > now() - interval '12 months';
      if v_used >= v_reward.max_per_year then
        raise exception '%: already used this year', v_reward.name using errcode = '22023', hint = 'reward';
      end if;
    end if;
    if v_reward.min_tier_id is not null then
      select * into v_need from public.reward_tiers where id = v_reward.min_tier_id;
      if v_need.id is not null and (v_tier.id is null or v_tier.threshold < v_need.threshold) then
        raise exception '%: for % and up', v_reward.name, v_need.name using errcode = '22023', hint = 'reward';
      end if;
    end if;
    v_balance := v_balance - v_reward.points;
    v_first := false;
  end loop;
end;
$$;

do $do$
declare
  v_def text := pg_get_functiondef('public.complete_sale(uuid,jsonb)'::regprocedure);
  v_old text;
  v_count integer;
begin
  -- 1. Declarations.
  v_old := $e$  v_first_visit boolean;
  j integer;
begin$e$;
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'complete_sale isn''t as expected (edit 1, found % times)', v_count;
  end if;
  v_def := replace(v_def, v_old, $e$  v_first_visit boolean;
  j integer;
  -- Rewards on the sale (priced as promotions, after them).
  v_reward_ids uuid[] := '{}';
  v_reward public.rewards;
  -- Rewards and the tier's free add-on: priced like promotions, not promotions.
  v_not_promo uuid[] := '{}';
  v_tier public.reward_tiers;
begin$e$);
  -- 2. Read them after the promotions.
  v_old := $e$    v_promo_take := v_promo_take || 0;
  end loop;
$e$;
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'complete_sale isn''t as expected (edit 2, found % times)', v_count;
  end if;
  v_def := replace(v_def, v_old, $e$    v_promo_take := v_promo_take || 0;
  end loop;
  -- Rewards the client takes with their points.
  for v_line in select * from jsonb_array_elements(coalesce(p_input -> 'reward_ids', '[]')) loop
    select * into v_reward from public.rewards where id = (v_line #>> '{}')::uuid and business_id = v_business.id and is_active;
    if v_reward.id is null then
      raise exception 'That reward isn''t available' using errcode = '22023', hint = 'reward';
    end if;
    if v_reward.id = any (v_reward_ids) then
      raise exception 'That reward is already on the sale' using errcode = '22023', hint = 'reward';
    end if;
    v_promo := null;
    v_promo.id := v_reward.id;
    v_promo.business_id := v_business.id;
    v_promo.name := v_reward.name;
    v_promo.kind := 'code';
    v_promo.discount_kind := case when v_reward.kind = 'percent' then 'percent' else 'amount' end;
    v_promo.percent := v_reward.percent;
    -- A free service: no amount, so it takes the first line it covers in full.
    v_promo.amount_cents := case when v_reward.kind = 'amount' then v_reward.amount_cents end;
    v_promo.applies_services := v_reward.kind = 'free_service' or v_reward.applies_services;
    v_promo.applies_retail := v_reward.kind <> 'free_service' and v_reward.applies_retail;
    v_promo.service_ids := v_reward.service_ids;
    v_promo.exclusions := '[]';
    v_promo.stackable := true;
    v_promos := v_promos || v_promo;
    v_pool := v_pool || v_promo.amount_cents;
    v_promo_take := v_promo_take || 0;
    v_reward_ids := v_reward_ids || v_reward.id;
  end loop;
  v_not_promo := v_reward_ids;
  -- The client's tier's free add-on (once a sale): the first line for that
  -- service, in full.
  if coalesce((p_input ->> 'tier_perk')::boolean, false) then
    if v_client_id is not null and exists (select 1 from public.reward_programs where business_id = v_business.id and enabled) then
      v_tier := private.reward_tier(v_client_id);
    end if;
    if v_tier.free_addon_service_id is null then
      raise exception 'This client''s tier has no free add-on' using errcode = '22023', hint = 'reward';
    end if;
    v_promo := null;
    v_promo.id := v_tier.id;
    v_promo.business_id := v_business.id;
    v_promo.name := v_tier.name || ' free add-on';
    v_promo.kind := 'code';
    v_promo.discount_kind := 'amount';
    v_promo.applies_services := true;
    v_promo.applies_retail := false;
    v_promo.service_ids := array[v_tier.free_addon_service_id];
    v_promo.exclusions := '[]';
    v_promo.stackable := true;
    v_promos := v_promos || v_promo;
    v_pool := v_pool || null::integer;
    v_promo_take := v_promo_take || 0;
    v_not_promo := v_not_promo || v_tier.id;
  end if;
$e$);
  -- 3. Promotion checks leave rewards out.
  v_old := $e$  for j in 1 .. coalesce(array_length(v_promos, 1), 0) loop
    v_problem := private.promotion_problem($e$;
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'complete_sale isn''t as expected (edit 3, found % times)', v_count;
  end if;
  v_def := replace(v_def, v_old, $e$  for j in 1 .. coalesce(array_length(v_promos, 1), 0) loop
    if (v_promos[j]).id = any (v_not_promo) then
      continue;
    end if;
    v_problem := private.promotion_problem($e$);
  -- 4. A promotion that doesn't stack counts promotions, not rewards.
  v_old := $e$if not (v_promos[j]).stackable and array_length(v_promos, 1) > 1 then$e$;
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'complete_sale isn''t as expected (edit 4, found % times)', v_count;
  end if;
  v_def := replace(v_def, v_old, $e$if not (v_promos[j]).stackable and array_length(v_promos, 1) - coalesce(array_length(v_not_promo, 1), 0) > 1 then$e$);
  -- 5. Then the rewards' own checks.
  v_old := $e$  -- Discounts staff give (on lines or the sale; member prices and
$e$;
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'complete_sale isn''t as expected (edit 5, found % times)', v_count;
  end if;
  v_def := replace(v_def, v_old, $e$  if coalesce(array_length(v_reward_ids, 1), 0) > 0 then
    perform private.check_rewards(v_business.id, v_client_id, v_reward_ids, array_length(v_promos, 1) - array_length(v_not_promo, 1));
  end if;
  if coalesce(array_length(v_not_promo, 1), 0) > 0 then
    for j in 1 .. array_length(v_promos, 1) loop
      if (v_promos[j]).id = any (v_not_promo) and v_promo_take[j] = 0 then
        raise exception '% doesn''t cover anything on this sale', (v_promos[j]).name using errcode = '22023', hint = 'reward';
      end if;
    end loop;
  end if;
  -- Discounts staff give (on lines or the sale; member prices and
$e$);
  -- 6. Promotion uses leave rewards out.
  v_old := $e$    for j in 1 .. array_length(v_promos, 1) loop
      insert into public.promotion_redemptions$e$;
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'complete_sale isn''t as expected (edit 6, found % times)', v_count;
  end if;
  v_def := replace(v_def, v_old, $e$    for j in 1 .. array_length(v_promos, 1) loop
      continue when (v_promos[j]).id = any (v_not_promo);
      insert into public.promotion_redemptions$e$);
  -- 7. Rewards take their points.
  v_old := $e$        v_promo_take[j], v_first_visit, (v_promos[j]).kind = 'last_minute', v_me);
    end loop;
  end if;
$e$;
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'complete_sale isn''t as expected (edit 7, found % times)', v_count;
  end if;
  v_def := replace(v_def, v_old, $e$        v_promo_take[j], v_first_visit, (v_promos[j]).kind = 'last_minute', v_me);
    end loop;
  end if;
  for j in 1 .. coalesce(array_length(v_promos, 1), 0) loop
    if (v_promos[j]).id = any (v_reward_ids) then
      insert into public.reward_points (business_id, client_id, delta, kind, sale_id, reward_id, discount_cents, staff_id)
      select v_business.id, v_client_id, -r.points, 'redeem', v_sale_id, r.id, v_promo_take[j], v_me from public.rewards r where r.id = (v_promos[j]).id;
    end if;
  end loop;
$e$);
  -- An amount's pool: a free service's (no amount) is used up by its first line.
  v_old := 'v_pool[j] := v_pool[j] - v_take;';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 2 then
    raise exception 'complete_sale''s amount pools aren''t as expected';
  end if;
  v_def := replace(v_def, v_old, 'v_pool[j] := coalesce(v_pool[j] - v_take, 0);');
  execute v_def;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Settings (the settings permission).
-- ---------------------------------------------------------------------------

create function public.save_reward_program(p_business_id uuid, p_program jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers change the rewards program' using errcode = '42501';
  end if;
  insert into public.reward_programs (
    business_id, enabled, service_points_per_dollar, retail_points_per_dollar, earn_on_packages, earn_on_memberships,
    birthday_points, referral_points, rebook_points, first_visit_points, expiry_months, min_redeem_points, stack_with_promotions, tier_basis, updated_by, updated_at
  ) values (
    p_business_id, coalesce((p_program ->> 'enabled')::boolean, false),
    coalesce((p_program ->> 'service_points_per_dollar')::int, 1), coalesce((p_program ->> 'retail_points_per_dollar')::int, 1),
    coalesce((p_program ->> 'earn_on_packages')::boolean, false), coalesce((p_program ->> 'earn_on_memberships')::boolean, false),
    coalesce((p_program ->> 'birthday_points')::int, 0), coalesce((p_program ->> 'referral_points')::int, 0),
    coalesce((p_program ->> 'rebook_points')::int, 0), coalesce((p_program ->> 'first_visit_points')::int, 0),
    (p_program ->> 'expiry_months')::int, coalesce((p_program ->> 'min_redeem_points')::int, 0),
    coalesce((p_program ->> 'stack_with_promotions')::boolean, false), coalesce(p_program ->> 'tier_basis', 'spend'),
    private.current_staff_id(p_business_id), now()
  )
  on conflict (business_id) do update set
    enabled = excluded.enabled, service_points_per_dollar = excluded.service_points_per_dollar, retail_points_per_dollar = excluded.retail_points_per_dollar,
    earn_on_packages = excluded.earn_on_packages, earn_on_memberships = excluded.earn_on_memberships, birthday_points = excluded.birthday_points,
    referral_points = excluded.referral_points, rebook_points = excluded.rebook_points, first_visit_points = excluded.first_visit_points,
    expiry_months = excluded.expiry_months, min_redeem_points = excluded.min_redeem_points, stack_with_promotions = excluded.stack_with_promotions,
    tier_basis = excluded.tier_basis, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- Tiers: the whole list at once (id kept for those that stay, so
-- rewards keep pointing at them; ones left out are removed).
create function public.save_reward_tiers(p_business_id uuid, p_tiers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier jsonb;
  v_keep uuid[] := '{}';
  v_id uuid;
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers change the rewards program' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_tiers, '[]')) > 6 then
    raise exception 'Up to 6 tiers' using errcode = '22023';
  end if;
  for v_tier in select * from jsonb_array_elements(coalesce(p_tiers, '[]')) loop
    if nullif(v_tier ->> 'free_addon_service_id', '') is not null
       and not exists (select 1 from public.services where id = (v_tier ->> 'free_addon_service_id')::uuid and business_id = p_business_id) then
      raise exception 'Choose one of the salon''s services' using errcode = '22023';
    end if;
    v_keep := v_keep || nullif(v_tier ->> 'id', '')::uuid;
  end loop;
  delete from public.reward_tiers where business_id = p_business_id and not (id = any (v_keep));
  -- Out of the way first, so thresholds can swap.
  update public.reward_tiers set threshold = threshold + 1000000000 where business_id = p_business_id;
  for v_tier in select * from jsonb_array_elements(coalesce(p_tiers, '[]')) loop
    v_id := nullif(v_tier ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.reward_tiers where id = v_id and business_id = p_business_id) then
      update public.reward_tiers set
        name = trim(v_tier ->> 'name'), threshold = (v_tier ->> 'threshold')::int, bonus_pct = coalesce((v_tier ->> 'bonus_pct')::int, 0),
        free_addon_service_id = nullif(v_tier ->> 'free_addon_service_id', '')::uuid, priority_booking = coalesce((v_tier ->> 'priority_booking')::boolean, false)
      where id = v_id;
    else
      insert into public.reward_tiers (business_id, name, threshold, bonus_pct, free_addon_service_id, priority_booking)
      values (p_business_id, trim(v_tier ->> 'name'), (v_tier ->> 'threshold')::int, coalesce((v_tier ->> 'bonus_pct')::int, 0),
              nullif(v_tier ->> 'free_addon_service_id', '')::uuid, coalesce((v_tier ->> 'priority_booking')::boolean, false));
    end if;
  end loop;
end;
$$;

create function public.save_reward(p_business_id uuid, p_reward jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_reward ->> 'id', '')::uuid;
  v_services uuid[] := (select array_agg((s #>> '{}')::uuid) from jsonb_array_elements(case when jsonb_typeof(p_reward -> 'service_ids') = 'array' then p_reward -> 'service_ids' end) s);
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers change the rewards program' using errcode = '42501';
  end if;
  if v_services is not null and exists (select 1 from unnest(v_services) x where not exists (select 1 from public.services s where s.id = x and s.business_id = p_business_id)) then
    raise exception 'Choose the salon''s services' using errcode = '22023';
  end if;
  if nullif(p_reward ->> 'min_tier_id', '') is not null
     and not exists (select 1 from public.reward_tiers where id = (p_reward ->> 'min_tier_id')::uuid and business_id = p_business_id) then
    raise exception 'Choose one of the salon''s tiers' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.rewards (business_id, name, points, kind, amount_cents, percent, applies_services, applies_retail, service_ids, max_per_year, min_tier_id)
    values (p_business_id, trim(p_reward ->> 'name'), (p_reward ->> 'points')::int, p_reward ->> 'kind', (p_reward ->> 'amount_cents')::int, (p_reward ->> 'percent')::int,
            coalesce((p_reward ->> 'applies_services')::boolean, true), coalesce((p_reward ->> 'applies_retail')::boolean, true), v_services,
            (p_reward ->> 'max_per_year')::int, nullif(p_reward ->> 'min_tier_id', '')::uuid)
    returning id into v_id;
  else
    update public.rewards set
      name = trim(p_reward ->> 'name'), points = (p_reward ->> 'points')::int, kind = p_reward ->> 'kind',
      amount_cents = (p_reward ->> 'amount_cents')::int, percent = (p_reward ->> 'percent')::int,
      applies_services = coalesce((p_reward ->> 'applies_services')::boolean, true), applies_retail = coalesce((p_reward ->> 'applies_retail')::boolean, true),
      service_ids = v_services, max_per_year = (p_reward ->> 'max_per_year')::int, min_tier_id = nullif(p_reward ->> 'min_tier_id', '')::uuid,
      is_active = coalesce((p_reward ->> 'is_active')::boolean, true)
    where id = v_id and business_id = p_business_id;
    if not found then
      raise exception 'Reward not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual adjustments: a new permission (managers by default; an owner can
-- give it to the front desk), always with a reason, logged with who.
-- ---------------------------------------------------------------------------

create or replace function private.role_default(p_role public.staff_role, p_permission text, p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_role = 'owner' then true
    when p_permission in ('billing', 'delete_business') then false
    when p_permission in ('settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'big_discounts', 'see_team_numbers', 'adjust_points')
      then p_role = 'manager'
    when p_permission = 'waive_fees'
      then p_role = any (coalesce((select ps.waive_roles from public.policy_settings ps where ps.business_id = p_business),
                                  array['owner', 'manager']::public.staff_role[]))
    else false
  end;
$$;

create or replace function private.toggleable(p_role public.staff_role, p_permission text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'manager' then p_permission in ('settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts', 'see_team_numbers', 'adjust_points')
    when 'front_desk' then p_permission in ('reports', 'void_refund', 'waive_fees', 'big_discounts', 'adjust_points')
    when 'stylist' then p_permission = 'see_team_numbers'
    else false
  end;
$$;

create or replace function public.my_permissions(p_business_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p order by p), '{}')
  from unnest(array['settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts',
                    'see_team_numbers', 'adjust_points', 'billing', 'delete_business']) p
  where private.can(p_business_id, p);
$$;

create or replace function public.staff_permission_list(p_staff_id uuid)
returns table (permission text, allowed boolean, role_default boolean, toggleable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p, private.staff_can(s.id, p), private.role_default(s.role, p, s.business_id), private.toggleable(s.role, p)
  from public.staff s,
       unnest(array['settings', 'team', 'payroll', 'reports', 'export_data', 'void_refund', 'waive_fees', 'big_discounts', 'see_team_numbers', 'adjust_points']) p
  where s.id = p_staff_id and private.can(s.business_id, 'team');
$$;

create function public.adjust_reward_points(p_client_id uuid, p_delta integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
begin
  select * into v_client from public.clients where id = p_client_id for update;
  if v_client.id is null or not private.can(v_client.business_id, 'adjust_points') then
    raise exception 'You can''t adjust points' using errcode = '42501';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'Enter the points to add or take off' using errcode = '22023';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  insert into public.reward_points (business_id, client_id, delta, kind, reason, staff_id)
  values (v_client.business_id, v_client.id, p_delta, 'adjust', left(trim(p_reason), 200), private.current_staff_id(v_client.business_id));
  return private.points_balance(v_client.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- A client's rewards at a glance: for staff (front of house) and for the
-- client's own account (service role, filtered by our code).
-- ---------------------------------------------------------------------------

-- Their referral code, made the first time it's asked for.
create function private.referral_code(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_business uuid;
  v_alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  i integer;
begin
  select referral_code, business_id into v_code, v_business from public.clients where id = p_client_id;
  if v_code is not null or v_business is null then
    return v_code;
  end if;
  loop
    v_code := '';
    for i in 1 .. 8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      update public.clients set referral_code = v_code where id = p_client_id;
      return v_code;
    exception when unique_violation then
      -- Taken: try another.
    end;
  end loop;
end;
$$;

create function private.reward_summary(p_client_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'balance', private.points_balance(c.id),
    'tier_id', (private.reward_tier(c.id)).id,
    'spend_cents', a.spend_cents,
    'visits', a.visits,
    'used_this_year', coalesce((
      select jsonb_object_agg(reward_id, n) from (
        select reward_id, count(*) filter (where kind = 'redeem') - count(*) filter (where kind = 'restore') as n
        from public.reward_points where client_id = c.id and reward_id is not null and created_at > now() - interval '12 months'
        group by reward_id
      ) u where n > 0), '{}'),
    'referral_code', private.referral_code(c.id),
    'last_earned_at', (select max(created_at) from public.reward_points where client_id = c.id and kind in ('earn', 'bonus'))
  )
  from public.clients c
  cross join lateral private.reward_activity(c.id, now()) a
  where c.id = p_client_id;
$$;

create function public.client_rewards(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.clients where id = p_client_id;
  if v_business is null or not private.front_of_house(v_business) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return private.reward_summary(p_client_id);
end;
$$;

-- For the client's own account page (our code has checked their session).
create function public.account_rewards(p_client_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.reward_summary(p_client_id);
$$;

-- A new client who came from someone's referral link (the booking site,
-- service role): only a client with no visit yet, only once, never
-- themselves, and only someone at the same salon.
create function public.set_referred_by(p_client_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_referrer uuid;
begin
  select * into v_client from public.clients where id = p_client_id for update;
  if v_client.id is null or v_client.referred_by is not null then
    return false;
  end if;
  select id into v_referrer from public.clients where business_id = v_client.business_id and referral_code = upper(trim(p_code));
  if v_referrer is null or v_referrer = v_client.id or private.visited_before(v_client.id, null) then
    return false;
  end if;
  update public.clients set referred_by = v_referrer where id = v_client.id;
  return true;
end;
$$;

-- Clients waiting for an opening at this location whose tier has priority
-- booking (they're offered openings first; front of house).
create function public.waitlist_priority_clients(p_location_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct w.client_id), '{}')
  from public.waitlist_entries w
  join public.locations l on l.id = w.location_id
  join public.reward_programs p on p.business_id = l.business_id and p.enabled
  where w.location_id = p_location_id and w.status = 'waiting'
    and private.front_of_house(l.business_id)
    and (private.reward_tier(w.client_id)).priority_booking;
$$;

-- ---------------------------------------------------------------------------
-- The nightly jobs (service role): birthday bonuses and expiry.
-- ---------------------------------------------------------------------------

create function public.run_reward_jobs(p_business_id uuid, p_today date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs;
  v_birthdays integer := 0;
  v_expired integer := 0;
  v_leap boolean := (extract(year from p_today)::int % 4 = 0 and extract(year from p_today)::int % 100 <> 0) or extract(year from p_today)::int % 400 = 0;
begin
  select * into v_program from public.reward_programs where business_id = p_business_id;
  if v_program.business_id is null or not v_program.enabled then
    return jsonb_build_object('birthdays', 0, 'expired', 0);
  end if;
  if v_program.birthday_points > 0 then
    -- On their birthday (Feb 29 birthdays on Feb 28 in other years), once a year.
    insert into public.reward_points (business_id, client_id, delta, kind, bonus, cycle)
    select p_business_id, c.id, v_program.birthday_points, 'bonus', 'birthday', 'birthday:' || extract(year from p_today)
    from public.clients c
    where c.business_id = p_business_id and c.birth_month = extract(month from p_today)
      and (c.birth_day = extract(day from p_today) or (not v_leap and c.birth_month = 2 and c.birth_day = 29 and extract(day from p_today) = 28))
    on conflict do nothing;
    get diagnostics v_birthdays = row_count;
  end if;
  if v_program.expiry_months is not null then
    -- No points earned for that long: what's left expires.
    insert into public.reward_points (business_id, client_id, delta, kind, reason)
    select p_business_id, b.client_id, -b.balance, 'expire', 'No visits for ' || v_program.expiry_months || ' months'
    from (
      select client_id, sum(delta)::int as balance, max(created_at) filter (where kind in ('earn', 'bonus')) as last_earned
      from public.reward_points where business_id = p_business_id group by client_id
    ) b
    where b.balance > 0 and (b.last_earned is null or b.last_earned < p_today - make_interval(months => v_program.expiry_months));
    get diagnostics v_expired = row_count;
  end if;
  return jsonb_build_object('birthdays', v_birthdays, 'expired', v_expired);
end;
$$;

-- Earns points on every sale a salon already has, oldest first (turning the
-- program on for the demo; service role).
create function public.backfill_reward_points(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale uuid;
  v_count integer := 0;
begin
  for v_sale in select id from public.sales where business_id = p_business_id and client_id is not null and status <> 'voided' order by created_at loop
    perform private.earn_sale_points(v_sale);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports (the reports permission): points earned, redeemed and expired in
-- the period, outstanding now, members by tier, referrals and the
-- redemption rate.
-- ---------------------------------------------------------------------------

create function public.rewards_report(p_business_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not private.can(p_business_id, 'reports') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  with period as (
    select * from public.reward_points where business_id = p_business_id and created_at >= p_from and created_at < p_to
  ), members as (
    select client_id, sum(delta)::int as balance from public.reward_points where business_id = p_business_id group by client_id
  ), tiers as (
    select (private.reward_tier(m.client_id)).id as tier_id from members m
  )
  select jsonb_build_object(
    'earned', coalesce((select sum(delta) filter (where kind in ('earn', 'bonus', 'reverse')) from period), 0),
    'bonus', coalesce((select sum(delta) filter (where kind = 'bonus') from period), 0),
    'redeemed', coalesce((select -sum(delta) filter (where kind in ('redeem', 'restore')) from period), 0),
    'redemptions', coalesce((select count(*) filter (where kind = 'redeem') - count(*) filter (where kind = 'restore') from period), 0),
    'discount_cents', coalesce((select sum(discount_cents) filter (where kind = 'redeem') from period), 0)
      - coalesce((select sum(r.discount_cents) from period p join public.reward_points r on r.sale_id = p.sale_id and r.reward_id = p.reward_id and r.kind = 'redeem' where p.kind = 'restore'), 0),
    'expired', coalesce((select -sum(delta) filter (where kind = 'expire') from period), 0),
    'adjusted', coalesce((select sum(delta) filter (where kind = 'adjust') from period), 0),
    'outstanding', coalesce((select sum(greatest(balance, 0)) from members), 0),
    'members', (select count(*) from members),
    'by_tier', coalesce((select jsonb_object_agg(coalesce(tier_id::text, 'none'), n) from (select tier_id, count(*) as n from tiers group by tier_id) t), '{}'),
    'referrals', jsonb_build_object(
      'referred', (select count(*) from public.clients where business_id = p_business_id and referred_by is not null and created_at >= p_from and created_at < p_to),
      'completed', (select count(*) from period where kind = 'bonus' and bonus = 'referral' and cycle = 'referred'),
      'points', coalesce((select sum(delta) from period where kind = 'bonus' and bonus = 'referral'), 0)
    )
  ) into v_out;
  return v_out;
end;
$$;

-- Every client with points or a tier: their balance, tier and the last 12
-- months (reports; first names only, for the report and Denise).
create function public.reward_members(p_business_id uuid)
returns table (client_id uuid, first_name text, balance integer, tier_id uuid, spend_cents integer, visits integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can(p_business_id, 'reports') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select c.id, c.first_name, coalesce(b.balance, 0), (private.reward_tier(c.id)).id, a.spend_cents, a.visits
  from public.clients c
  left join (select r.client_id, sum(r.delta)::int as balance from public.reward_points r where r.business_id = p_business_id group by r.client_id) b on b.client_id = c.id
  cross join lateral private.reward_activity(c.id, now()) a
  where c.business_id = p_business_id
    and (b.client_id is not null or a.visits > 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who can call what.
-- ---------------------------------------------------------------------------

revoke all on function private.reward_activity(uuid, timestamptz, uuid) from public;
revoke all on function private.reward_tier(uuid, timestamptz, uuid) from public;
revoke all on function private.points_balance(uuid) from public;
revoke all on function private.sale_points(public.sales, public.reward_programs, integer) from public;
revoke all on function private.earn_sale_points(uuid) from public;
revoke all on function private.check_rewards(uuid, uuid, uuid[], integer) from public;
revoke all on function private.referral_code(uuid) from public;
revoke all on function private.reward_summary(uuid) from public;
revoke all on function public.account_rewards(uuid) from public, anon, authenticated;
revoke all on function public.set_referred_by(uuid, text) from public, anon, authenticated;
revoke all on function public.run_reward_jobs(uuid, date) from public, anon, authenticated;
revoke all on function public.backfill_reward_points(uuid) from public, anon, authenticated;
grant execute on function public.account_rewards(uuid) to service_role;
grant execute on function public.set_referred_by(uuid, text) to service_role;
grant execute on function public.run_reward_jobs(uuid, date) to service_role;
grant execute on function public.backfill_reward_points(uuid) to service_role;
revoke all on function public.save_reward_program(uuid, jsonb) from public, anon;
revoke all on function public.save_reward_tiers(uuid, jsonb) from public, anon;
revoke all on function public.save_reward(uuid, jsonb) from public, anon;
revoke all on function public.adjust_reward_points(uuid, integer, text) from public, anon;
revoke all on function public.client_rewards(uuid) from public, anon;
revoke all on function public.rewards_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.save_reward_program(uuid, jsonb) to authenticated;
grant execute on function public.save_reward_tiers(uuid, jsonb) to authenticated;
grant execute on function public.save_reward(uuid, jsonb) to authenticated;
grant execute on function public.adjust_reward_points(uuid, integer, text) to authenticated;
grant execute on function public.client_rewards(uuid) to authenticated;
grant execute on function public.rewards_report(uuid, timestamptz, timestamptz) to authenticated;
revoke all on function public.reward_members(uuid) from public, anon;
grant execute on function public.reward_members(uuid) to authenticated;
revoke all on function public.waitlist_priority_clients(uuid) from public, anon;
grant execute on function public.waitlist_priority_clients(uuid) to authenticated;
