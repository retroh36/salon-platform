-- Ordering: purchase orders to suppliers, and receiving them into stock.
--
-- An order goes draft -> sent -> partly received -> received. Owners and
-- managers write and send orders; the front desk (and up) receives
-- deliveries, which adds stock (quantity x container size) as
-- 'order_received' movements and records the cost paid (also the product's
-- new cost). Denise can draft an order (from the AI action log); staff
-- review it, and nothing is sent automatically.
--
-- Orders are written only through the functions below.

create type public.purchase_order_status as enum ('draft', 'sent', 'partly_received', 'received');

create table public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  location_id   uuid not null,
  supplier_id   uuid not null,
  -- Shown as PO-1001.
  number        bigint generated always as identity (start with 1001) unique,
  status        public.purchase_order_status not null default 'draft',
  notes         text check (length(notes) <= 2000),
  -- Set when Denise drafted it.
  ai_action_id  uuid references public.ai_actions (id) on delete set null,
  created_by    uuid,
  sent_by       uuid,
  sent_at       timestamptz,
  received_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, business_id),
  check ((status = 'draft') = (sent_at is null)),
  check ((status = 'received') = (received_at is not null)),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (supplier_id, business_id) references public.suppliers (id, business_id),
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by),
  foreign key (sent_by, business_id) references public.staff (id, business_id) on delete set null (sent_by)
);

create index purchase_orders_location_status_idx on public.purchase_orders (location_id, status, created_at desc);
create index purchase_orders_business_id_idx on public.purchase_orders (business_id);
create index purchase_orders_supplier_id_idx on public.purchase_orders (supplier_id);

create table public.purchase_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses (id) on delete cascade,
  purchase_order_id  uuid not null,
  product_id         uuid not null,
  -- Containers: tubes, bottles, units.
  quantity           integer not null check (quantity between 1 and 10000),
  unit_cost_cents    integer not null check (unit_cost_cents >= 0),
  received_quantity  integer not null default 0 check (received_quantity >= 0 and received_quantity <= quantity),
  -- Why Denise suggested it, if she did.
  reason             text check (length(reason) <= 500),
  unique (purchase_order_id, product_id),
  foreign key (purchase_order_id, business_id) references public.purchase_orders (id, business_id) on delete cascade,
  foreign key (product_id, business_id) references public.products (id, business_id)
);

create index purchase_order_lines_product_id_idx on public.purchase_order_lines (product_id);
create index purchase_order_lines_business_id_idx on public.purchase_order_lines (business_id);

alter table public.stock_movements add column purchase_order_id uuid references public.purchase_orders (id) on delete set null;
create index stock_movements_purchase_order_idx on public.stock_movements (purchase_order_id) where purchase_order_id is not null;

create trigger purchase_orders_set_updated_at before update on public.purchase_orders
  for each row execute function public.set_updated_at();

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

-- The front of house sees orders (it receives them).
create policy "Front of house can view purchase orders"
  on public.purchase_orders for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can view purchase order lines"
  on public.purchase_order_lines for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- Owners and managers at the order's business, or raise.
create function private.require_inventory_manager(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_business_id is null or not private.has_business_role(p_business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can do this' using errcode = '42501';
  end if;
end;
$$;

-- Replace a draft's lines: [{"product_id", "quantity", "unit_cost_cents", "reason"?}]
create function private.set_order_lines(p_order public.purchase_orders, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]')) > 200 then
    raise exception 'Up to 200 lines' using errcode = '22023';
  end if;
  delete from public.purchase_order_lines where purchase_order_id = p_order.id;
  insert into public.purchase_order_lines (business_id, purchase_order_id, product_id, quantity, unit_cost_cents, reason)
  select p_order.business_id, p_order.id, (l ->> 'product_id')::uuid, (l ->> 'quantity')::int,
         coalesce((l ->> 'unit_cost_cents')::int, p.cost_cents), nullif(l ->> 'reason', '')
  from jsonb_array_elements(coalesce(p_lines, '[]')) l
  join public.products p on p.id = (l ->> 'product_id')::uuid and p.business_id = p_order.business_id;
  if (select count(*) from public.purchase_order_lines where purchase_order_id = p_order.id) <> jsonb_array_length(coalesce(p_lines, '[]')) then
    raise exception 'A product on the order doesn''t exist' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_purchase_order: create a draft (p_order_id null) or change one.
-- ---------------------------------------------------------------------------

create function public.save_purchase_order(p_order_id uuid, p_location_id uuid, p_supplier_id uuid, p_notes text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_order public.purchase_orders;
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  perform private.require_inventory_manager(v_business_id);
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.business_id = v_business_id) then
    raise exception 'Choose a supplier' using errcode = '22023';
  end if;

  if p_order_id is null then
    insert into public.purchase_orders (business_id, location_id, supplier_id, notes, created_by)
    values (v_business_id, p_location_id, p_supplier_id, nullif(trim(p_notes), ''), private.current_staff_id(v_business_id))
    returning * into v_order;
  else
    update public.purchase_orders set supplier_id = p_supplier_id, notes = nullif(trim(p_notes), '')
    where id = p_order_id and business_id = v_business_id and status = 'draft'
    returning * into v_order;
    if v_order.id is null then
      raise exception 'Only drafts can be changed' using errcode = '55000';
    end if;
  end if;
  perform private.set_order_lines(v_order, p_lines);
  return v_order.id;
end;
$$;

create function public.send_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  perform private.require_inventory_manager(v_order.business_id);
  if v_order.status <> 'draft' then
    raise exception 'Already sent' using errcode = '55000';
  end if;
  if not exists (select 1 from public.purchase_order_lines where purchase_order_id = p_order_id) then
    raise exception 'Add something to order first' using errcode = '22023';
  end if;
  update public.purchase_orders set status = 'sent', sent_at = now(), sent_by = private.current_staff_id(business_id)
  where id = p_order_id;
end;
$$;

create function public.delete_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  perform private.require_inventory_manager(v_order.business_id);
  if v_order.status <> 'draft' then
    raise exception 'Only drafts can be deleted' using errcode = '55000';
  end if;
  delete from public.purchase_orders where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- receive_purchase_order: a delivery. p_lines = [{"line_id", "quantity"}]
-- (containers received now, up to what's still due). Adds the stock and
-- records the cost paid, which becomes the product's cost.
-- ---------------------------------------------------------------------------

create function public.receive_purchase_order(p_order_id uuid, p_lines jsonb)
returns public.purchase_order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_line record;
  v_movement uuid;
  v_any boolean := false;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if v_order.id is null
     or not private.has_business_role(v_order.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to receive orders' using errcode = '42501';
  end if;
  if v_order.status not in ('sent', 'partly_received') then
    raise exception 'Only sent orders can be received' using errcode = '55000';
  end if;

  for v_line in
    select l.*, p.size, (r ->> 'quantity')::int as now_received
    from jsonb_array_elements(coalesce(p_lines, '[]')) r
    join public.purchase_order_lines l on l.id = (r ->> 'line_id')::uuid and l.purchase_order_id = p_order_id
    join public.products p on p.id = l.product_id
    for update of l
  loop
    if v_line.now_received is null or v_line.now_received < 0 or v_line.received_quantity + v_line.now_received > v_line.quantity then
      raise exception 'More received than was ordered' using errcode = '22023';
    end if;
    continue when v_line.now_received = 0;
    v_any := true;
    update public.purchase_order_lines set received_quantity = received_quantity + v_line.now_received where id = v_line.id;
    v_movement := private.move_stock(
      v_order.location_id, v_line.product_id, v_line.now_received * v_line.size, 'order_received',
      'PO-' || v_order.number, null, null, v_line.unit_cost_cents
    );
    update public.stock_movements set purchase_order_id = p_order_id where id = v_movement;
    update public.products set cost_cents = v_line.unit_cost_cents where id = v_line.product_id and cost_cents <> v_line.unit_cost_cents;
  end loop;
  if not v_any then
    raise exception 'Enter what arrived' using errcode = '22023';
  end if;

  update public.purchase_orders set
    status = case
      when exists (select 1 from public.purchase_order_lines where purchase_order_id = p_order_id and received_quantity < quantity)
      then 'partly_received'::public.purchase_order_status else 'received' end,
    received_at = case
      when exists (select 1 from public.purchase_order_lines where purchase_order_id = p_order_id and received_quantity < quantity)
      then null else now() end
  where id = p_order_id
  returning * into v_order;
  return v_order.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Denise's reorder drafts. A proposal with feature 'reorder' carries
--   {"purchase_order": {"location_id", "supplier_id",
--                       "lines": [{"product_id", "quantity", "unit_cost_cents", "reason"}]}}
-- Approving makes it a draft order (owners and managers); undo deletes the
-- draft if it hasn't been sent.
-- ---------------------------------------------------------------------------

create function public.apply_reorder_draft(p_action_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
  v_order public.purchase_orders;
  v_draft jsonb;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  perform private.require_inventory_manager(v_action.business_id);
  if v_action.feature <> 'reorder' or v_action.status <> 'proposed' then
    raise exception 'This suggestion was already decided' using errcode = '55000';
  end if;
  v_draft := v_action.proposal -> 'purchase_order';
  if not exists (
    select 1 from public.suppliers s where s.id = (v_draft ->> 'supplier_id')::uuid and s.business_id = v_action.business_id
  ) then
    raise exception 'That supplier no longer exists' using errcode = '55000';
  end if;

  insert into public.purchase_orders (business_id, location_id, supplier_id, notes, ai_action_id, created_by)
  values (v_action.business_id, v_action.location_id, (v_draft ->> 'supplier_id')::uuid, 'Drafted by Denise',
          v_action.id, private.current_staff_id(v_action.business_id))
  returning * into v_order;
  perform private.set_order_lines(v_order, v_draft -> 'lines');

  update public.ai_actions set
    status = 'approved',
    decided_by = private.current_staff_id(business_id),
    decided_at = now(),
    previous_state = jsonb_build_object('created_purchase_order_id', v_order.id)
  where id = v_action.id;
  return v_order.id;
end;
$$;

create function public.undo_reorder_draft(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.ai_actions;
  v_order public.purchase_orders;
begin
  select * into v_action from public.ai_actions where id = p_action_id for update;
  perform private.require_inventory_manager(v_action.business_id);
  if v_action.feature <> 'reorder' or v_action.status <> 'approved' then
    raise exception 'Only an applied suggestion can be undone' using errcode = '55000';
  end if;
  select * into v_order from public.purchase_orders
  where id = (v_action.previous_state ->> 'created_purchase_order_id')::uuid
  for update;
  if v_order.id is not null and v_order.status <> 'draft' then
    raise exception 'The order has been sent, so it can''t be undone' using errcode = '55000';
  end if;
  delete from public.purchase_orders where id = v_order.id;
  update public.ai_actions set status = 'undone', undone_by = private.current_staff_id(business_id), undone_at = now()
  where id = v_action.id;
end;
$$;

revoke all on function private.require_inventory_manager(uuid) from public;
revoke all on function private.set_order_lines(public.purchase_orders, jsonb) from public;
revoke all on function public.save_purchase_order(uuid, uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.send_purchase_order(uuid) from public, anon;
revoke all on function public.delete_purchase_order(uuid) from public, anon;
revoke all on function public.receive_purchase_order(uuid, jsonb) from public, anon;
revoke all on function public.apply_reorder_draft(uuid) from public, anon;
revoke all on function public.undo_reorder_draft(uuid) from public, anon;
grant execute on function public.save_purchase_order(uuid, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.send_purchase_order(uuid) to authenticated;
grant execute on function public.delete_purchase_order(uuid) to authenticated;
grant execute on function public.receive_purchase_order(uuid, jsonb) to authenticated;
grant execute on function public.apply_reorder_draft(uuid) to authenticated;
grant execute on function public.undo_reorder_draft(uuid) to authenticated;
