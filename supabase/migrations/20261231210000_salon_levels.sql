-- Stylist levels are the salon's own: each salon names, orders and colors
-- them on Settings → Levels (the `settings` permission), and adds or
-- removes them. Until now they were a fixed list (Artisan, Senior,
-- Master, the enum public.staff_level).
--
-- A level is a key that never changes (`master`, `junior`, `level_2`…)
-- with a name, a place in the order (0 is the most senior), one of a fixed
-- set of colors and a badge symbol. public.staff_level becomes a domain
-- over text holding that key, so every column, cast and function that
-- named the type keeps working; the key must be one of the salon's levels
-- (foreign keys from staff and service_level_prices).

create table public.staff_levels (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,31}$'),
  name         text not null check (length(btrim(name)) between 1 and 40),
  position     integer not null check (position >= 0),
  color        text not null check (color in ('gold', 'fuchsia', 'green', 'blue', 'violet', 'slate')),
  symbol       text not null check (symbol in ('star', 'two_dots', 'dot', 'triangle', 'diamond', 'three_dots')),
  primary key (business_id, key),
  unique (business_id, position) deferrable initially deferred
);

create unique index staff_levels_name_idx on public.staff_levels (business_id, lower(btrim(name)));

alter table public.staff_levels enable row level security;

-- Everyone at the salon sees its levels (names and colors on the calendar,
-- Scheduling, booking details). Written only through save_staff_levels.
create policy "Members can view levels"
  on public.staff_levels for select to authenticated
  using (business_id in (select private.member_businesses()));

-- Every salon starts with Master, Senior and Artisan.
create function private.default_staff_levels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.staff_levels (business_id, key, name, position, color, symbol)
  values
    (new.id, 'master', 'Master', 0, 'gold', 'star'),
    (new.id, 'senior', 'Senior', 1, 'fuchsia', 'two_dots'),
    (new.id, 'artisan', 'Artisan', 2, 'green', 'dot');
  return new;
end;
$$;

revoke all on function private.default_staff_levels() from public;

create trigger businesses_default_staff_levels
  after insert on public.businesses
  for each row execute function private.default_staff_levels();

insert into public.staff_levels (business_id, key, name, position, color, symbol)
select b.id, l.key, l.name, l.position, l.color, l.symbol
from public.businesses b
cross join (values
  ('master', 'Master', 0, 'gold', 'star'),
  ('senior', 'Senior', 1, 'fuchsia', 'two_dots'),
  ('artisan', 'Artisan', 2, 'green', 'dot')
) as l (key, name, position, color, symbol);

-- ---------------------------------------------------------------------------
-- The enum becomes a domain over text.
-- ---------------------------------------------------------------------------

alter type public.staff_level rename to staff_level_enum;
create domain public.staff_level as text check (value ~ '^[a-z][a-z0-9_]{0,31}$');

alter table public.staff alter column level type public.staff_level using level::text;
alter table public.service_level_prices alter column level type public.staff_level using level::text;
alter table public.package_templates alter column levels type public.staff_level[] using levels::text[];
alter table public.client_packages alter column levels type public.staff_level[] using levels::text[];
alter table public.promotions alter column levels type public.staff_level[] using levels::text[];

alter table public.staff
  add constraint staff_level_fkey foreign key (business_id, level) references public.staff_levels (business_id, key);
create index staff_level_idx on public.staff (business_id, level);
alter table public.service_level_prices
  add constraint service_level_prices_level_fkey foreign key (business_id, level)
  references public.staff_levels (business_id, key) on delete cascade;

-- Named the enum in its arguments: the same, with the domain.
drop function private.promotion_applies(public.promotions, text, uuid, text, uuid, public.staff_level_enum, uuid);

create function private.promotion_applies(
  p public.promotions, p_kind text, p_service_id uuid, p_category text, p_staff_id uuid, p_level public.staff_level, p_product_id uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'service' then p.applies_services
      and (p.service_ids is null or p_service_id = any (p.service_ids))
      and (p.categories is null or p_category = any (p.categories))
      and (p.staff_ids is null or p_staff_id = any (p.staff_ids))
      and (p.levels is null or p_level = any (p.levels))
      and not exists (
        select 1 from jsonb_array_elements(p.exclusions) e
        where (e ->> 'level' is not null or e ->> 'category' is not null)
          and (e ->> 'level' is null or e ->> 'level' = p_level::text)
          and (e ->> 'category' is null or e ->> 'category' = p_category)
      )
    when 'product' then p.applies_retail and (p.product_ids is null or p_product_id = any (p.product_ids))
    else false
  end;
$$;

revoke all on function private.promotion_applies(public.promotions, text, uuid, text, uuid, public.staff_level, uuid) from public;

drop type public.staff_level_enum;

-- Sets a service's level prices: p_prices is {"<level key>": cents | null,
-- …}; a missing or null level uses the menu price. Runs as the caller, so
-- the level price policies decide.
create or replace function public.set_service_level_prices(p_service_id uuid, p_prices jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  if jsonb_typeof(p_prices) is distinct from 'object' then
    raise exception 'p_prices must be a JSON object' using errcode = '22023';
  end if;
  select business_id into v_business_id from public.services where id = p_service_id;
  if v_business_id is null then
    raise exception 'Service not found' using errcode = '42501';
  end if;

  delete from public.service_level_prices lp
  where lp.service_id = p_service_id
    and coalesce(p_prices ->> lp.level::text, '') = '';

  insert into public.service_level_prices (service_id, business_id, level, price_cents)
  select p_service_id, v_business_id, l.key, (p_prices ->> l.key)::integer
  from public.staff_levels l
  where l.business_id = v_business_id
    and coalesce(p_prices ->> l.key, '') <> ''
  on conflict (service_id, level) do update
    set price_cents = excluded.price_cents
    where public.service_level_prices.price_cents is distinct from excluded.price_cents;
end;
$$;

-- Saves the salon's whole list of levels, in order (most senior first):
-- p_levels is [{"key": "<existing key>" | null, "name", "color",
-- "symbol"}, …]. A null key adds a level (its key made from the name); a
-- level left out is removed, refused while anyone (active or not) is on it.
-- Removing one also takes its prices, and takes it off package and
-- promotion rules.
create function public.save_staff_levels(p_business_id uuid, p_levels jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level jsonb;
  v_key text;
  v_base text;
  v_n integer;
  v_position integer := 0;
  v_kept text[] := '{}';
  v_in_use text;
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Not allowed to change levels' using errcode = '42501';
  end if;
  if jsonb_typeof(p_levels) is distinct from 'array' or jsonb_array_length(p_levels) = 0 then
    raise exception 'Keep at least one level' using errcode = '22023';
  end if;
  if jsonb_array_length(p_levels) > 8 then
    raise exception 'A salon can have up to 8 levels' using errcode = '22023';
  end if;

  -- Who's on a level being removed.
  select string_agg(distinct l.name, ', ') into v_in_use
  from public.staff_levels l
  join public.staff s on s.business_id = l.business_id and s.level = l.key
  where l.business_id = p_business_id
    and l.key not in (select e ->> 'key' from jsonb_array_elements(p_levels) e where e ->> 'key' is not null);
  if v_in_use is not null then
    raise exception 'Someone is still on %: move them to another level first', v_in_use using errcode = '23503', hint = 'in_use';
  end if;

  -- Out of the way of the new order (positions are unique).
  update public.staff_levels set position = position + 1000 where business_id = p_business_id;

  for v_level in select * from jsonb_array_elements(p_levels) loop
    v_key := v_level ->> 'key';
    if v_key is null then
      v_base := left(coalesce(nullif(trim(both '_' from regexp_replace(lower(v_level ->> 'name'), '[^a-z0-9]+', '_', 'g')), ''), 'level'), 24);
      if v_base !~ '^[a-z]' then
        v_base := 'level_' || v_base;
      end if;
      v_key := v_base;
      v_n := 1;
      while exists (select 1 from public.staff_levels where business_id = p_business_id and key = v_key) or v_key = any (v_kept) loop
        v_n := v_n + 1;
        v_key := v_base || '_' || v_n;
      end loop;
      insert into public.staff_levels (business_id, key, name, position, color, symbol)
      values (p_business_id, v_key, btrim(v_level ->> 'name'), v_position, v_level ->> 'color', v_level ->> 'symbol');
    else
      update public.staff_levels
      set name = btrim(v_level ->> 'name'), position = v_position, color = v_level ->> 'color', symbol = v_level ->> 'symbol'
      where business_id = p_business_id and key = v_key;
      if not found then
        raise exception 'Level not found' using errcode = 'P0002';
      end if;
    end if;
    v_kept := v_kept || v_key;
    v_position := v_position + 1;
  end loop;

  update public.package_templates t
  set levels = (select nullif(array_agg(x), '{}') from unnest(t.levels) x where x = any (v_kept))
  where t.business_id = p_business_id and t.levels is not null and not t.levels <@ v_kept::public.staff_level[];
  update public.promotions p
  set levels = (select nullif(array_agg(x), '{}') from unnest(p.levels) x where x = any (v_kept))
  where p.business_id = p_business_id and p.levels is not null and not p.levels <@ v_kept::public.staff_level[];

  delete from public.staff_levels where business_id = p_business_id and not (key = any (v_kept));
end;
$$;

revoke all on function public.save_staff_levels(uuid, jsonb) from public, anon;
grant execute on function public.save_staff_levels(uuid, jsonb) to authenticated;
