-- Color usage: what each service uses from stock.
--
-- A formula entry (client_formulas) can now be tied to the service on a
-- visit it was for (appointment_item_id) and list the products and amounts
-- used (formula_products): 30 g Topchic 7N + 30 ml 20 vol developer.
-- Services can have a default recipe (service_products) for when there's
-- no formula: a gloss uses about 60 ml Shades EQ + 60 ml processing
-- solution.
--
-- When a visit is checked out, each service draws down stock: the latest
-- formula with products recorded for it, or else its service's recipe.
-- private.deduct_item_stock compares that with what was already taken for
-- the service and moves only the difference, so a formula recorded (or
-- corrected) after checkout puts the stock right instead of double
-- counting. Every change is a 'service_use' stock movement.

alter table public.client_formulas
  add column appointment_item_id uuid references public.appointment_items (id) on delete set null;
create index client_formulas_appointment_item_idx on public.client_formulas (appointment_item_id) where appointment_item_id is not null;

create table public.formula_products (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  formula_id   uuid not null references public.client_formulas (id) on delete cascade,
  product_id   uuid not null,
  -- In the product's unit (grams or ml).
  amount       numeric(10, 2) not null check (amount > 0 and amount <= 10000),
  position     smallint not null default 0,
  foreign key (product_id, business_id) references public.products (id, business_id)
);

create index formula_products_formula_id_idx on public.formula_products (formula_id);
create index formula_products_product_id_idx on public.formula_products (product_id);
create index formula_products_business_id_idx on public.formula_products (business_id);

create table public.service_products (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  service_id   uuid not null,
  product_id   uuid not null,
  amount       numeric(10, 2) not null check (amount > 0 and amount <= 10000),
  unique (service_id, product_id),
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade,
  foreign key (product_id, business_id) references public.products (id, business_id) on delete cascade
);

create index service_products_product_id_idx on public.service_products (product_id);
create index service_products_business_id_idx on public.service_products (business_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: everyone sees formulas' products and recipes. Formula
-- products are written with their formula (add_formula); owners and
-- managers manage recipes.
-- ---------------------------------------------------------------------------

alter table public.formula_products enable row level security;
alter table public.service_products enable row level security;

create policy "Members can view formula products"
  on public.formula_products for select to authenticated
  using ((select private.is_business_member(business_id)));

create policy "Members can view recipes"
  on public.service_products for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners and managers can manage recipes"
  on public.service_products for all to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager']::public.staff_role[])));

-- ---------------------------------------------------------------------------
-- private.deduct_item_stock: bring what a checked-out service has taken from
-- stock in line with what it used. Nothing until the visit is checked out.
-- ---------------------------------------------------------------------------

create function private.deduct_item_stock(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.appointment_items;
  v_status public.appointment_status;
  v_formula_id uuid;
  v_service text;
  v_row record;
begin
  select * into v_item from public.appointment_items where id = p_item_id;
  select a.status into v_status from public.appointments a where a.id = v_item.appointment_id;
  if v_item.id is null or v_status is distinct from 'completed' then
    return;
  end if;
  select s.name into v_service from public.services s where s.id = v_item.service_id;

  -- The latest formula recorded for this service that lists products.
  select f.id into v_formula_id
  from public.client_formulas f
  where f.appointment_item_id = v_item.id
    and exists (select 1 from public.formula_products fp where fp.formula_id = f.id)
  order by f.created_at desc, f.id desc
  limit 1;

  for v_row in
    with wanted as (
      select fp.product_id, sum(fp.amount) as amount
      from public.formula_products fp
      where fp.formula_id = v_formula_id
      group by fp.product_id
      union all
      select sp.product_id, sp.amount
      from public.service_products sp
      where v_formula_id is null and sp.service_id = v_item.service_id
    ),
    taken as (
      select m.product_id, -sum(m.change) as amount
      from public.stock_movements m
      where m.appointment_item_id = v_item.id and m.reason = 'service_use'
      group by m.product_id
    )
    select coalesce(w.product_id, t.product_id) as product_id,
           coalesce(w.amount, 0) - coalesce(t.amount, 0) as more
    from wanted w full join taken t on t.product_id = w.product_id
  loop
    if v_row.more <> 0 then
      perform private.move_stock(
        v_item.location_id, v_row.product_id, -v_row.more, 'service_use',
        case
          when v_row.more < 0 then v_service || ': correction'
          when v_formula_id is not null then v_service || ': formula'
          else v_service || ': recipe'
        end,
        v_item.appointment_id, v_item.id
      );
    end if;
  end loop;
end;
$$;

revoke all on function private.deduct_item_stock(uuid) from public;

-- ---------------------------------------------------------------------------
-- add_formula: a formula entry by the signed-in staff member, optionally for
-- a service on a visit and with the products used:
--   p_lines = [{"product_id": uuid, "amount": number}]
-- If that visit is already checked out, stock is put right straight away.
-- ---------------------------------------------------------------------------

create function public.add_formula(
  p_client_id uuid,
  p_appointment_item_id uuid,
  p_visit_date date,
  p_formula text,
  p_notes text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_staff_id uuid;
  v_formula_id uuid;
  v_line jsonb;
  v_position int := 0;
  v_product public.products;
begin
  select c.business_id into v_business_id from public.clients c where c.id = p_client_id;
  v_staff_id := private.current_staff_id(v_business_id);
  if v_business_id is null or v_staff_id is null then
    raise exception 'Not allowed to add formulas' using errcode = '42501';
  end if;
  if p_appointment_item_id is not null and not exists (
    select 1 from public.appointment_items i join public.appointments a on a.id = i.appointment_id
    where i.id = p_appointment_item_id and a.client_id = p_client_id and a.business_id = v_business_id
  ) then
    raise exception 'That service isn''t on this client''s visit' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]')) > 20 then
    raise exception 'Up to 20 products' using errcode = '22023';
  end if;

  insert into public.client_formulas (business_id, client_id, staff_id, visit_date, formula, notes, appointment_item_id)
  values (v_business_id, p_client_id, v_staff_id, p_visit_date, p_formula, nullif(trim(p_notes), ''), p_appointment_item_id)
  returning id into v_formula_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    select * into v_product from public.products
    where id = (v_line ->> 'product_id')::uuid and business_id = v_business_id;
    if v_product.id is null or v_product.type <> 'back_bar' then
      raise exception 'Formulas use back-bar products' using errcode = '22023';
    end if;
    insert into public.formula_products (business_id, formula_id, product_id, amount, position)
    values (v_business_id, v_formula_id, v_product.id, (v_line ->> 'amount')::numeric, v_position);
    v_position := v_position + 1;
  end loop;

  if p_appointment_item_id is not null then
    perform private.deduct_item_stock(p_appointment_item_id);
  end if;
  return v_formula_id;
end;
$$;

revoke all on function public.add_formula(uuid, uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.add_formula(uuid, uuid, date, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- set_appointment_status: as before, and checking out draws down the
-- products each service used.
-- ---------------------------------------------------------------------------

create or replace function public.set_appointment_status(p_appointment_id uuid, p_status public.appointment_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_item_id uuid;
begin
  select a.business_id into v_business_id from public.appointments a where a.id = p_appointment_id;
  if v_business_id is null
     or not private.has_business_role(v_business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to change this appointment' using errcode = '42501';
  end if;
  if p_status = 'canceled' and nullif(trim(p_reason), '') is null then
    raise exception 'A cancellation needs a reason' using errcode = '22023';
  end if;

  update public.appointments set
    status = p_status,
    canceled_at = case when p_status = 'canceled' then now() end,
    cancel_reason = case when p_status = 'canceled' then trim(p_reason) end,
    updated_by = private.current_staff_id(v_business_id)
  where id = p_appointment_id;

  if p_status = 'completed' then
    for v_item_id in select i.id from public.appointment_items i where i.appointment_id = p_appointment_id order by i.starts_at loop
      perform private.deduct_item_stock(v_item_id);
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_service_recipe: replace a service's default products (owners and
-- managers). p_lines = [{"product_id": uuid, "amount": number}]
-- ---------------------------------------------------------------------------

create function public.set_service_recipe(p_service_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select s.business_id into v_business_id from public.services s where s.id = p_service_id;
  if v_business_id is null or not private.has_business_role(v_business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Not allowed to change recipes' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]')) > 20 then
    raise exception 'Up to 20 products' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_lines, '[]')) l
    left join public.products p on p.id = (l ->> 'product_id')::uuid and p.business_id = v_business_id
    where p.id is null or p.type <> 'back_bar'
  ) then
    raise exception 'Recipes use back-bar products' using errcode = '22023';
  end if;

  delete from public.service_products where service_id = p_service_id;
  insert into public.service_products (business_id, service_id, product_id, amount)
  select v_business_id, p_service_id, (l ->> 'product_id')::uuid, sum((l ->> 'amount')::numeric)
  from jsonb_array_elements(coalesce(p_lines, '[]')) l
  group by (l ->> 'product_id')::uuid;
end;
$$;

revoke all on function public.set_service_recipe(uuid, jsonb) from public, anon;
grant execute on function public.set_service_recipe(uuid, jsonb) to authenticated;
