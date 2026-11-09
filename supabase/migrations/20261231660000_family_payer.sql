-- A family member pays for another's visit at checkout (families are
-- …_families.sql): the sale keeps who paid (sales.payer_client_id, someone
-- in the client's family), the receipt goes to them, and the points the
-- sale earns go to them, unless the salon gives them to the client who
-- had the visit (reward_programs.family_points). Bonuses for the visit
-- itself (first visit, referral, rebooking) stay with the client.

alter table public.reward_programs
  add column family_points text not null default 'payer' check (family_points in ('payer', 'client'));

-- No foreign keys to clients here: a second one would make every
-- clients(...) embed from sales and sale_drafts ambiguous (as with
-- appointment_items.requested_staff_id). complete_sale checks the payer.
alter table public.sales
  add column payer_client_id uuid,
  add constraint sales_payer_not_client check (payer_client_id is null or payer_client_id <> client_id);
create index sales_payer_idx on public.sales (payer_client_id) where payer_client_id is not null;

-- Who pays, chosen on the checkout as it's built.
alter table public.sale_drafts
  add column payer_client_id uuid;

-- Whose points a sale earns and spends: the payer's when a family member
-- paid and the salon gives points to whoever pays, else the client's.
create function private.points_client(p_business_id uuid, p_client_id uuid, p_payer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_payer_id is not null and coalesce((select family_points from public.reward_programs where business_id = p_business_id), 'payer') = 'payer'
      then p_payer_id
    else p_client_id
  end;
$$;
revoke all on function private.points_client(uuid, uuid, uuid) from public;

-- complete_sale: takes payer_client_id (someone else in the client's
-- family), keeps it on the sale, and prices and spends rewards from the
-- points account the sale earns into.
do $$
declare
  v_def text := pg_get_functiondef('public.complete_sale(uuid,jsonb)'::regprocedure);
  v_pairs text[][] := array[
    array[
      $o$  v_client_id uuid := nullif(p_input ->> 'client_id', '')::uuid;$o$,
      $n$  v_client_id uuid := nullif(p_input ->> 'client_id', '')::uuid;
  v_payer_id uuid := nullif(p_input ->> 'payer_client_id', '')::uuid;
  v_points_client uuid;$n$],
    array[
      $o$    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if v_employee is not null then$o$,
      $n$    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  -- Paid by someone else in the client's family.
  if v_payer_id is not null and (v_client_id is null or v_payer_id = v_client_id or not exists (
       select 1 from public.clients p join public.clients c on c.family_id = p.family_id
       where p.id = v_payer_id and c.id = v_client_id and p.business_id = v_business.id)) then
    raise exception 'Only someone in the client''s family can pay for them' using errcode = '22023', hint = 'payer';
  end if;
  v_points_client := private.points_client(v_business.id, v_client_id, v_payer_id);
  if v_employee is not null then$n$],
    array[
      $o$v_tier := private.reward_tier(v_client_id);$o$,
      $n$v_tier := private.reward_tier(v_points_client);$n$],
    array[
      $o$perform private.check_rewards(v_business.id, v_client_id, $o$,
      $n$perform private.check_rewards(v_business.id, v_points_client, $n$],
    array[
      $o$select v_business.id, v_client_id, -r.points, 'redeem'$o$,
      $n$select v_business.id, v_points_client, -r.points, 'redeem'$n$],
    array[
      $o$rebook_appointment_id, draft_id, employee_id
  ) values ($o$,
      $n$rebook_appointment_id, draft_id, employee_id, payer_client_id
  ) values ($n$],
    array[
      $o$v_me, v_rebook, v_draft.id, v_employee
  ) returning id into v_sale_id;$o$,
      $n$v_me, v_rebook, v_draft.id, v_employee, v_payer_id
  ) returning id into v_sale_id;$n$]
  ];
  i integer;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'complete_sale changed: update this migration (%)', i;
    end if;
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;
end;
$$;

-- Earning: the sale's points go to its points account (at the tier that
-- account was in before the sale); the visit's bonuses stay the client's.
create or replace function private.earn_sale_points(p_sale_id uuid)
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
  v_earner uuid;
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
  v_earner := private.points_client(v_sale.business_id, v_sale.client_id, v_sale.payer_client_id);
  v_tier := private.reward_tier(v_earner, v_sale.created_at, v_sale.id);
  v_points := private.sale_points(v_sale, v_program, coalesce(v_tier.bonus_pct, 0));
  if v_points > 0 then
    insert into public.reward_points (business_id, client_id, delta, kind, sale_id, created_at)
    values (v_sale.business_id, v_earner, v_points, 'earn', v_sale.id, v_sale.created_at);
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

-- A partial refund takes back its share from whoever earned the points.
create or replace function private.on_sale_refunded_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_earner uuid;
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
  v_earner := coalesce((select client_id from public.reward_points where sale_id = v_sale.id and kind = 'earn' limit 1), v_sale.client_id);
  select coalesce(sum(delta) filter (where kind = 'earn'), 0), coalesce(sum(delta) filter (where kind in ('earn', 'reverse')), 0)
    into v_earned, v_left
  from public.reward_points where sale_id = v_sale.id and client_id = v_earner and kind in ('earn', 'reverse');
  -- As pointsBack in lib/rewards.ts: rounded up, never more than is left.
  v_back := least(v_left, ceil(v_earned::numeric * new.amount_cents / nullif(v_sale.total_cents, 0))::int);
  if v_back > 0 then
    insert into public.reward_points (business_id, client_id, delta, kind, sale_id, reason)
    values (v_sale.business_id, v_earner, -v_back, 'reverse', v_sale.id, 'Sale #' || v_sale.number || ' partly refunded');
  end if;
  return new;
end;
$$;

-- The program, now with who earns on a family member's visit.
create or replace function public.save_reward_program(p_business_id uuid, p_program jsonb)
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
    birthday_points, referral_points, rebook_points, first_visit_points, expiry_months, min_redeem_points, stack_with_promotions, tier_basis,
    family_points, updated_by, updated_at
  ) values (
    p_business_id, coalesce((p_program ->> 'enabled')::boolean, false),
    coalesce((p_program ->> 'service_points_per_dollar')::int, 1), coalesce((p_program ->> 'retail_points_per_dollar')::int, 1),
    coalesce((p_program ->> 'earn_on_packages')::boolean, false), coalesce((p_program ->> 'earn_on_memberships')::boolean, false),
    coalesce((p_program ->> 'birthday_points')::int, 0), coalesce((p_program ->> 'referral_points')::int, 0),
    coalesce((p_program ->> 'rebook_points')::int, 0), coalesce((p_program ->> 'first_visit_points')::int, 0),
    (p_program ->> 'expiry_months')::int, coalesce((p_program ->> 'min_redeem_points')::int, 0),
    coalesce((p_program ->> 'stack_with_promotions')::boolean, false), coalesce(p_program ->> 'tier_basis', 'spend'),
    coalesce(p_program ->> 'family_points', 'payer'),
    private.current_staff_id(p_business_id), now()
  )
  on conflict (business_id) do update set
    enabled = excluded.enabled, service_points_per_dollar = excluded.service_points_per_dollar, retail_points_per_dollar = excluded.retail_points_per_dollar,
    earn_on_packages = excluded.earn_on_packages, earn_on_memberships = excluded.earn_on_memberships, birthday_points = excluded.birthday_points,
    referral_points = excluded.referral_points, rebook_points = excluded.rebook_points, first_visit_points = excluded.first_visit_points,
    expiry_months = excluded.expiry_months, min_redeem_points = excluded.min_redeem_points, stack_with_promotions = excluded.stack_with_promotions,
    tier_basis = excluded.tier_basis, family_points = excluded.family_points, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
