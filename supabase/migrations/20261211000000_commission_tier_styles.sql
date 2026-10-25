-- Commission plans, revised: booth rent is gone (plans are commission or
-- hourly), and each plan says how its tiers pay (tier_style):
--   'marginal'    each dollar at the rate of the tier it falls in (as before)
--   'retroactive' reaching a tier pays all the window's sales at its rate

-- Nobody stays on a booth rent plan: back to their own rates.
update public.staff_compensation c set plan_id = null
from public.commission_plans p join public.commission_plan_versions v on v.id = p.current_version_id
where c.plan_id = p.id and v.rules->>'mode' = 'booth_rent';

-- Lines sold under a booth rent version keep the rate they recorded (100%)
-- as their own, and the booth rent plans and versions go.
update public.sale_items i set commission_version_id = null
from public.commission_plan_versions v
where i.commission_version_id = v.id and v.rules->>'mode' = 'booth_rent';
update public.staff_compensation_history h set plan_id = null
where h.plan_id in (select plan_id from public.commission_plan_versions where rules->>'mode' = 'booth_rent');
update public.commission_plans set current_version_id = null
where id in (select plan_id from public.commission_plan_versions where rules->>'mode' = 'booth_rent');
delete from public.commission_plans where id in (select plan_id from public.commission_plan_versions where rules->>'mode' = 'booth_rent');

-- Every remaining version: no rent, and the tier style they were paid by.
update public.commission_plan_versions set rules = (rules - 'rent') || jsonb_build_object('tier_style', coalesce(rules->>'tier_style', 'marginal'));

create or replace function private.check_commission_rules(p_rules jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_kind text;
  v_tiers jsonb;
  v_last bigint;
  v_tier jsonb;
begin
  if coalesce(p_rules->>'mode', '') not in ('commission', 'hourly') then
    raise exception 'Choose how they''re paid' using errcode = '22023';
  end if;
  if coalesce(p_rules->>'tier_period', '') not in ('pay_period', 'month') then
    raise exception 'Choose when the tiers start again' using errcode = '22023';
  end if;
  if coalesce(p_rules->>'tier_style', '') not in ('marginal', 'retroactive') then
    raise exception 'Choose how the tiers pay' using errcode = '22023';
  end if;
  if p_rules ? 'rent' then
    raise exception 'Plans don''t take rent' using errcode = '22023';
  end if;
  foreach v_kind in array array['service', 'retail'] loop
    v_tiers := p_rules->v_kind;
    if jsonb_typeof(v_tiers) <> 'array' or jsonb_array_length(v_tiers) not between 1 and 6 then
      raise exception 'Give % commission one to six tiers', v_kind using errcode = '22023';
    end if;
    v_last := -1;
    for v_tier in select * from jsonb_array_elements(v_tiers) loop
      if coalesce((v_tier->>'from_cents')::bigint, -1) <= v_last or coalesce((v_tier->>'pct')::numeric, -1) not between 0 and 100 then
        raise exception 'Each % tier starts above the last, at 0 to 100%%', v_kind using errcode = '22023';
      end if;
      v_last := (v_tier->>'from_cents')::bigint;
    end loop;
    if (v_tiers->0->>'from_cents')::bigint <> 0 then
      raise exception 'The first % tier starts at $0', v_kind using errcode = '22023';
    end if;
  end loop;
  if coalesce(p_rules->'backbar'->>'kind', '') not in ('none', 'fixed', 'percent')
     or (p_rules->'backbar'->>'kind' = 'fixed' and coalesce((p_rules->'backbar'->>'value')::integer, 0) not between 1 and 10000)
     or (p_rules->'backbar'->>'kind' = 'percent' and coalesce((p_rules->'backbar'->>'value')::numeric, 0) not between 1 and 50) then
    raise exception 'Give the back-bar fee as $0.01 to $100 or 1 to 50%% per service' using errcode = '22023';
  end if;
end;
$$;

-- Lines record their plan version and its first rate, as before, without
-- booth rent.
create or replace function private.record_line_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
  v_rules jsonb;
begin
  if new.commission_pct is null and new.staff_id is not null and new.kind::text in ('service', 'product') then
    select c.plan_id, case when new.kind::text = 'service' then c.service_commission_pct else c.retail_commission_pct end
      into v_plan, new.commission_pct
    from public.staff_compensation c where c.staff_id = new.staff_id;
    if v_plan is not null then
      select p.current_version_id, v.rules into new.commission_version_id, v_rules
      from public.commission_plans p join public.commission_plan_versions v on v.id = p.current_version_id
      where p.id = v_plan;
      new.commission_pct := case
        when v_rules->>'mode' = 'hourly' and new.kind::text = 'service' then 0
        else (v_rules->(case when new.kind::text = 'service' then 'service' else 'retail' end)->0->>'pct')::numeric
      end;
    end if;
    new.commission_pct := coalesce(new.commission_pct, 0);
  end if;
  return new;
end;
$$;
