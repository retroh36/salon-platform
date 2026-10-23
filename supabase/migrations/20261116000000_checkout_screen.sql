-- The full-screen checkout: a draft ticket per checkout, kept as staff
-- build it (so leaving and coming back loses nothing), then completed
-- through complete_sale. Plus what the ticket can do: credit a stylist for
-- products, add services on the spot, discount single lines, sell out of
-- stock with a manager's OK, and record the visit booked before the client
-- left.

create table public.sale_drafts (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null,
  appointment_id  uuid references public.appointments (id) on delete cascade,
  client_id       uuid references public.clients (id) on delete set null,
  -- The ticket as built on screen (lines, tips, payments...). Checked in
  -- full by complete_sale; nothing here is trusted.
  ticket          jsonb not null default '{}',
  status          text not null default 'open' check (status in ('open', 'completed')),
  sale_id         uuid references public.sales (id) on delete set null,
  -- Where staff came from, to go back to.
  return_to       text check (return_to ~ '^/[^/]' and length(return_to) <= 300),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, business_id),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

-- One open checkout per visit.
create unique index sale_drafts_appointment_key on public.sale_drafts (appointment_id) where appointment_id is not null and status = 'open';

create trigger sale_drafts_set_updated_at before update on public.sale_drafts
  for each row execute function public.set_updated_at();

-- A manager's OK to sell a product the system shows as out of stock, for
-- one checkout.
create table public.stock_overrides (
  id           uuid primary key default gen_random_uuid(),
  draft_id     uuid not null references public.sale_drafts (id) on delete cascade,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  approved_by  uuid not null,
  created_at   timestamptz not null default now(),
  unique (draft_id, product_id),
  foreign key (approved_by, business_id) references public.staff (id, business_id) on delete cascade
);

alter table public.sales
  add column rebook_appointment_id uuid references public.appointments (id) on delete set null,
  add column draft_id uuid references public.sale_drafts (id) on delete set null;
alter table public.sale_items
  add column line_discount_cents integer not null default 0 check (line_discount_cents >= 0),
  add column line_discount_reason text check (length(line_discount_reason) <= 300);

alter table public.sale_drafts enable row level security;
alter table public.stock_overrides enable row level security;

-- Drafts aren't money: the front of house reads and writes them (the sale
-- itself is only ever made by complete_sale, which checks everything).
create policy "Front of house can view checkouts" on public.sale_drafts for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can start checkouts" on public.sale_drafts for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])) and status = 'open' and sale_id is null);
create policy "Front of house can change open checkouts" on public.sale_drafts for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])) and status = 'open')
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])) and status = 'open' and sale_id is null);
create policy "Front of house can discard open checkouts" on public.sale_drafts for delete to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])) and status = 'open');
create policy "Front of house can view stock overrides" on public.stock_overrides for select to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- A manager (signed in on the desk's screen for a moment) OKs selling an
-- out-of-stock product on this checkout.
create function public.approve_stock_override(p_draft_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.sale_drafts;
begin
  select * into v_draft from public.sale_drafts where id = p_draft_id;
  if v_draft.id is null or not private.has_business_role(v_draft.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only a manager or owner can OK that' using errcode = '42501';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and business_id = v_draft.business_id) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  insert into public.stock_overrides (draft_id, business_id, product_id, approved_by)
  values (p_draft_id, v_draft.business_id, p_product_id, private.current_staff_id(v_draft.business_id))
  on conflict (draft_id, product_id) do nothing;
end;
$$;

-- A line's own discount in cents: {kind: 'amount' | 'percent', value,
-- reason}, never more than the line, and always with a reason.
create function private.line_discount(p_discount jsonb, p_gross integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v integer;
begin
  if p_discount is null or jsonb_typeof(p_discount) <> 'object' or coalesce((p_discount ->> 'value')::int, 0) <= 0 then
    return 0;
  end if;
  if nullif(trim(p_discount ->> 'reason'), '') is null then
    raise exception 'Say why there''s a discount' using errcode = '22023';
  end if;
  if p_discount ->> 'kind' = 'percent' then
    if (p_discount ->> 'value')::int > 100 then
      raise exception 'A discount can''t be more than 100%%' using errcode = '22023';
    end if;
    v := round(p_gross::numeric * (p_discount ->> 'value')::int / 100)::int;
  else
    v := (p_discount ->> 'value')::int;
  end if;
  if v > p_gross then
    raise exception 'The discount is more than the line' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function private.line_discount(jsonb, integer) from public;

-- price_sale, as before, with each line's own discount taken off first:
-- the sale's discount is shared on what's left, and tax is on the rest.
-- (lib/checkout.ts priceLines does the same.)
create or replace function private.price_sale(p_lines jsonb, p_discount integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pool bigint := 0;
  v_given bigint := 0;
  v_left integer;
  v_out jsonb := '[]';
  v_shares integer[] := '{}';
  v_line jsonb;
  v_share integer;
  v_after integer;
  v_own integer;
  v_net integer;
  v_tax integer;
  i integer;
begin
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ->> 'discountable')::boolean then
      v_pool := v_pool + (v_line ->> 'gross')::int - coalesce((v_line ->> 'line_discount')::int, 0);
    end if;
  end loop;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_after := (v_line ->> 'gross')::int - coalesce((v_line ->> 'line_discount')::int, 0);
    v_share := case when (v_line ->> 'discountable')::boolean and v_pool > 0 then floor(p_discount::bigint * v_after / v_pool)::int else 0 end;
    v_shares := v_shares || v_share;
    v_given := v_given + v_share;
  end loop;
  v_left := p_discount - v_given;
  i := 0;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    v_own := coalesce((v_line ->> 'line_discount')::int, 0);
    v_after := (v_line ->> 'gross')::int - v_own;
    if v_left > 0 and (v_line ->> 'discountable')::boolean and v_after > v_shares[i] then
      v_shares[i] := v_shares[i] + 1;
      v_left := v_left - 1;
    end if;
    v_net := v_after - v_shares[i];
    v_tax := round(v_net::numeric * (v_line ->> 'taxable_bp')::int / 10000)::int;
    v_out := v_out || jsonb_build_object('discount', v_own + v_shares[i], 'tax', v_tax, 'total', v_net + v_tax);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_sale, as before, plus:
--   draft_id: the checkout's draft ticket (marked completed with the sale;
--     its managers' stock OKs apply);
--   rebook_appointment_id: the client's next visit, booked at checkout;
--   service lines without appointment_item_id: a service added on the spot
--     ({service_id, staff_id, quantity}, at the stylist's price);
--   staff_id on service lines (who did it) and product lines (who gets the
--     credit for the sale);
--   discount on a line ({kind, value, reason});
--   products out of stock need an owner or manager, or a manager's OK.
-- ---------------------------------------------------------------------------

create or replace function public.complete_sale(p_location_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_me uuid;
  v_appointment public.appointments;
  v_client_id uuid := nullif(p_input ->> 'client_id', '')::uuid;
  v_line jsonb;
  v_item record;
  v_product public.products;
  v_card public.gift_cards;
  v_lines jsonb := '[]';
  v_priced jsonb;
  v_rows jsonb := '[]';
  v_subtotal integer := 0;
  v_discountable integer := 0;
  v_discount integer := 0;
  v_discount_reason text;
  v_tax integer := 0;
  v_tips integer := 0;
  v_total integer;
  v_paid integer := 0;
  v_pay jsonb;
  v_amount integer;
  v_number integer;
  v_sale_id uuid;
  v_payment_id uuid;
  v_sale_item_id uuid;
  v_seen uuid[] := '{}';
  v_codes text[] := '{}';
  v_price integer;
  v_has_cards boolean := false;
  v_code text;
  v_template public.package_templates;
  v_pitem record;
  v_package_id uuid;
  v_covered integer := 0;
  v_level public.staff_level;
  v_staff_id uuid;
  v_qty integer;
  v_gross integer;
  v_line_discount integer;
  v_line_discounts integer := 0;
  v_discount_gross integer := 0;
  v_on_hand numeric;
  v_draft public.sale_drafts;
  v_rebook uuid;
  i integer;
begin
  select b.* into v_business from public.businesses b join public.locations l on l.business_id = b.id where l.id = p_location_id;
  if v_business.id is null or not private.has_business_role(v_business.id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to take payments' using errcode = '42501';
  end if;
  v_me := private.current_staff_id(v_business.id);

  if nullif(p_input ->> 'appointment_id', '') is not null then
    select * into v_appointment from public.appointments
    where id = (p_input ->> 'appointment_id')::uuid and location_id = p_location_id for update;
    if v_appointment.id is null then
      raise exception 'Appointment not found' using errcode = 'P0002';
    end if;
    if v_appointment.status not in ('booked', 'confirmed', 'checked_in') then
      raise exception 'This visit is already checked out or canceled' using errcode = '55000';
    end if;
    v_client_id := v_appointment.client_id;
  end if;
  if v_client_id is not null and not exists (select 1 from public.clients where id = v_client_id and business_id = v_business.id) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  -- The checkout's draft ticket, if it came from one.
  if nullif(p_input ->> 'draft_id', '') is not null then
    select * into v_draft from public.sale_drafts where id = (p_input ->> 'draft_id')::uuid and business_id = v_business.id for update;
    if v_draft.id is null or v_draft.status <> 'open' then
      raise exception 'This checkout was already completed' using errcode = '55000';
    end if;
  end if;
  -- The visit booked before they left.
  if nullif(p_input ->> 'rebook_appointment_id', '') is not null then
    select id into v_rebook from public.appointments
    where id = (p_input ->> 'rebook_appointment_id')::uuid and business_id = v_business.id and client_id is not distinct from v_client_id and status not in ('canceled');
    if v_rebook is null then
      raise exception 'That rebooked visit isn''t this client''s' using errcode = '22023';
    end if;
  end if;

  -- Lines, priced from our tables.
  for v_line in select * from jsonb_array_elements(coalesce(p_input -> 'lines', '[]')) loop
    if v_line ->> 'kind' = 'service' then
      if nullif(v_line ->> 'appointment_item_id', '') is not null then
        select i.id, i.service_id, i.staff_id, i.price_cents, s.name into v_item
        from public.appointment_items i join public.services s on s.id = i.service_id
        where i.id = (v_line ->> 'appointment_item_id')::uuid and i.appointment_id = v_appointment.id;
        if v_item.id is null or v_item.id = any (v_seen) then
          raise exception 'That service isn''t on this visit' using errcode = '22023';
        end if;
        v_seen := v_seen || v_item.id;
        v_qty := 1;
      else
        -- A service added at checkout (not booked), at the stylist's price.
        select null::uuid as id, s.id as service_id, st.id as staff_id, private.stylist_price(st.id, s.id) as price_cents, s.name into v_item
        from public.services s join public.staff st on st.id = (v_line ->> 'staff_id')::uuid and st.business_id = v_business.id and st.is_active
        where s.id = (v_line ->> 'service_id')::uuid and s.business_id = v_business.id and s.archived_at is null;
        if v_item.service_id is null then
          raise exception 'Choose a service and who did it' using errcode = '22023';
        end if;
        v_qty := coalesce((v_line ->> 'quantity')::int, 1);
        if v_qty not between 1 and 20 then
          raise exception 'Enter how many' using errcode = '22023';
        end if;
      end if;
      -- Who gets the credit: the booked stylist, unless changed.
      v_staff_id := coalesce(nullif(v_line ->> 'staff_id', '')::uuid, v_item.staff_id);
      if not exists (select 1 from public.staff where id = v_staff_id and business_id = v_business.id) then
        raise exception 'Unknown stylist' using errcode = '22023';
      end if;
      v_price := coalesce((v_line ->> 'unit_price_cents')::int, v_item.price_cents);
      if v_price < 0 or v_price > 10000000 then
        raise exception 'Enter a price' using errcode = '22023';
      end if;
      if v_price <> v_item.price_cents and nullif(trim(v_line ->> 'price_reason'), '') is null then
        raise exception 'Say why the price changed' using errcode = '22023';
      end if;
      -- Paid for with a package the client has: a use of it covers the
      -- line (not taxed or discounted again).
      -- No package unless one is given (a record with empty fields).
      select null::uuid as id, null::int as total, null::int as used, null::uuid as package_id, null::public.staff_level[] as levels,
             null::timestamptz as expires_at, null::public.client_package_status as status, null::uuid as client_id, null::text as name
        into v_pitem;
      if nullif(v_line ->> 'package_item_id', '') is not null then
        select pi.id, pi.total, pi.used, p.id as package_id, p.levels, p.expires_at, p.status, p.client_id, p.name into v_pitem
        from public.client_package_items pi join public.client_packages p on p.id = pi.client_package_id
        where pi.id = (v_line ->> 'package_item_id')::uuid and pi.service_id = v_item.service_id and p.business_id = v_business.id
        for update of pi;
        if v_pitem.id is null or v_pitem.client_id is distinct from v_client_id then
          raise exception 'That package doesn''t cover this service for this client' using errcode = '22023';
        end if;
        if v_pitem.status <> 'active' or (v_pitem.expires_at is not null and v_pitem.expires_at <= now()) then
          raise exception 'That package has expired or was canceled' using errcode = '55000';
        end if;
        if v_pitem.used + (select count(*) from jsonb_array_elements(v_rows) r where r ->> 'package_item_id' = v_pitem.id::text) >= v_pitem.total then
          raise exception 'No uses left on that package for this service' using errcode = '22023';
        end if;
        if v_qty <> 1 then
          raise exception 'A package covers one at a time' using errcode = '22023';
        end if;
        select level into v_level from public.staff where id = v_staff_id;
        if v_pitem.levels is not null and (v_level is null or not (v_level = any (v_pitem.levels))) then
          raise exception 'That package doesn''t cover this stylist''s level' using errcode = '22023';
        end if;
        v_covered := v_covered + v_price;
      end if;
      v_gross := v_price * v_qty;
      v_line_discount := case when v_pitem.id is null then private.line_discount(v_line -> 'discount', v_gross) else 0 end;
      v_line_discounts := v_line_discounts + v_line_discount;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'service', 'service_id', v_item.service_id, 'appointment_item_id', v_item.id, 'staff_id', v_staff_id,
        'description', v_item.name, 'quantity', v_qty, 'unit', v_price,
        'booked', case when v_price <> v_item.price_cents then v_item.price_cents end,
        'reason', case when v_price <> v_item.price_cents then trim(v_line ->> 'price_reason') end,
        'package_item_id', v_pitem.id, 'package_name', v_pitem.name,
        'line_discount', v_line_discount, 'line_discount_reason', case when v_line_discount > 0 then trim(v_line -> 'discount' ->> 'reason') end);
      v_lines := v_lines || jsonb_build_object('gross', v_gross, 'line_discount', v_line_discount, 'taxable_bp', case when v_pitem.id is null then v_business.tax_rate_services_bp else 0 end, 'discountable', v_pitem.id is null);
    elsif v_line ->> 'kind' = 'product' then
      select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid and business_id = v_business.id;
      if v_product.id is null or v_product.type <> 'retail' or not v_product.is_active then
        raise exception 'That product can''t be sold' using errcode = '22023';
      end if;
      v_qty := coalesce((v_line ->> 'quantity')::int, 0);
      if v_qty not between 1 and 100 then
        raise exception 'Enter how many' using errcode = '22023';
      end if;
      -- Out of stock: a manager's OK (or a manager selling it).
      select on_hand into v_on_hand from public.stock_levels where location_id = p_location_id and product_id = v_product.id;
      if coalesce(v_on_hand, 0) - coalesce((select sum((r ->> 'quantity')::int) from jsonb_array_elements(v_rows) r where r ->> 'product_id' = v_product.id::text), 0) < v_qty
         and not private.has_business_role(v_business.id, array['owner', 'manager']::public.staff_role[])
         and not exists (select 1 from public.stock_overrides o where o.draft_id = v_draft.id and o.product_id = v_product.id) then
        raise exception 'Only % left of %. A manager needs to OK selling it.', greatest(coalesce(v_on_hand, 0), 0)::int, concat_ws(' ', v_product.brand, v_product.line, v_product.name) using errcode = '42501';
      end if;
      -- Who gets the credit for the sale (a stylist), if anyone.
      v_staff_id := nullif(v_line ->> 'staff_id', '')::uuid;
      if v_staff_id is not null and not exists (select 1 from public.staff where id = v_staff_id and business_id = v_business.id) then
        raise exception 'Unknown stylist' using errcode = '22023';
      end if;
      v_gross := v_product.price_cents * v_qty;
      v_line_discount := private.line_discount(v_line -> 'discount', v_gross);
      v_line_discounts := v_line_discounts + v_line_discount;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'product', 'product_id', v_product.id, 'staff_id', v_staff_id,
        'description', concat_ws(' ', v_product.brand, v_product.line, v_product.name), 'quantity', v_qty, 'unit', v_product.price_cents,
        'line_discount', v_line_discount, 'line_discount_reason', case when v_line_discount > 0 then trim(v_line -> 'discount' ->> 'reason') end);
      v_lines := v_lines || jsonb_build_object('gross', v_gross, 'line_discount', v_line_discount, 'taxable_bp', v_business.tax_rate_retail_bp, 'discountable', true);
    elsif v_line ->> 'kind' = 'gift_card' then
      v_amount := coalesce((v_line ->> 'amount_cents')::int, 0);
      if v_amount < 500 or v_amount > 100000 then
        raise exception 'A gift card is $5 to $1,000' using errcode = '22023';
      end if;
      v_code := nullif(private.gift_code(v_line ->> 'code'), '');
      if v_code is not null then
        if length(v_code) < 8 or length(v_code) > 32 then
          raise exception 'A card''s code has 8 to 32 letters and numbers' using errcode = '22023';
        end if;
        if v_code = any (v_codes) or exists (select 1 from public.gift_cards where business_id = v_business.id and code = v_code) then
          raise exception 'That gift card code is already in use' using errcode = '22023';
        end if;
        v_codes := v_codes || v_code;
      end if;
      v_has_cards := true;
      v_rows := v_rows || jsonb_build_object(
        'kind', 'gift_card', 'description', case when v_code is null then 'Gift card (digital)' else 'Gift card' end,
        'quantity', 1, 'unit', v_amount, 'code', v_code,
        'recipient_name', nullif(trim(v_line ->> 'recipient_name'), ''), 'recipient_email', nullif(trim(v_line ->> 'recipient_email'), ''));
      v_lines := v_lines || jsonb_build_object('gross', v_amount, 'taxable_bp', 0, 'discountable', false);
    elsif v_line ->> 'kind' = 'gift_card_reload' then
      v_amount := coalesce((v_line ->> 'amount_cents')::int, 0);
      if v_amount < 500 or v_amount > 100000 then
        raise exception 'A reload is $5 to $1,000' using errcode = '22023';
      end if;
      v_card := private.usable_card(v_business.id, v_line ->> 'code');
      if v_card.kind <> 'purchased' then
        raise exception 'Promotional cards can''t be reloaded' using errcode = '22023';
      end if;
      v_has_cards := true;
      v_rows := v_rows || jsonb_build_object('kind', 'gift_card_reload', 'description', 'Gift card reload', 'quantity', 1, 'unit', v_amount, 'gift_card_id', v_card.id);
      v_lines := v_lines || jsonb_build_object('gross', v_amount, 'taxable_bp', 0, 'discountable', false);
    elsif v_line ->> 'kind' = 'package' then
      select * into v_template from public.package_templates where id = (v_line ->> 'template_id')::uuid and business_id = v_business.id and is_active;
      if v_template.id is null then
        raise exception 'That package isn''t for sale' using errcode = '22023';
      end if;
      if v_client_id is null then
        raise exception 'Choose the client the package is for' using errcode = '22023';
      end if;
      v_rows := v_rows || jsonb_build_object('kind', 'package', 'description', v_template.name, 'quantity', 1, 'unit', v_template.price_cents, 'template_id', v_template.id);
      v_lines := v_lines || jsonb_build_object('gross', v_template.price_cents, 'taxable_bp', v_business.tax_rate_services_bp, 'discountable', true);
    else
      raise exception 'Unknown line' using errcode = '22023';
    end if;
  end loop;

  if jsonb_array_length(v_rows) = 0 then
    raise exception 'Add something to the sale' using errcode = '22023';
  end if;
  if v_appointment.id is not null and exists (
    select 1 from public.appointment_items i where i.appointment_id = v_appointment.id and not (i.id = any (v_seen))
  ) then
    raise exception 'Every service on the visit needs to be on the sale' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_subtotal := v_subtotal + (v_line ->> 'gross')::int;
    if (v_line ->> 'discountable')::boolean then
      v_discount_gross := v_discount_gross + (v_line ->> 'gross')::int;
      v_discountable := v_discountable + (v_line ->> 'gross')::int - coalesce((v_line ->> 'line_discount')::int, 0);
    end if;
  end loop;

  -- A discount on the whole sale (on what's left after line discounts).
  if p_input -> 'discount' is not null and jsonb_typeof(p_input -> 'discount') = 'object' and coalesce((p_input -> 'discount' ->> 'value')::int, 0) > 0 then
    v_discount_reason := nullif(trim(p_input -> 'discount' ->> 'reason'), '');
    if v_discount_reason is null then
      raise exception 'Say why there''s a discount' using errcode = '22023';
    end if;
    if p_input -> 'discount' ->> 'kind' = 'percent' then
      if (p_input -> 'discount' ->> 'value')::int > 100 then
        raise exception 'A discount can''t be more than 100%%' using errcode = '22023';
      end if;
      v_discount := round(v_discountable::numeric * (p_input -> 'discount' ->> 'value')::int / 100)::int;
    else
      v_discount := (p_input -> 'discount' ->> 'value')::int;
    end if;
    if v_discount > v_discountable then
      raise exception 'The discount is more than the sale' using errcode = '22023';
    end if;
  end if;
  -- Discounts (on lines or the sale): by who may give them, and how much.
  if v_discount + v_line_discounts > 0 then
    if not private.has_business_role(v_business.id, v_business.discount_roles) then
      raise exception 'You can''t give discounts' using errcode = '42501';
    end if;
    if not private.has_business_role(v_business.id, array['owner', 'manager']::public.staff_role[])
       and (v_discount + v_line_discounts) * 100 > v_discount_gross * v_business.discount_max_percent then
      raise exception 'That''s more discount than you can give' using errcode = '42501';
    end if;
  end if;

  v_priced := private.price_sale(v_lines, v_discount);
  for i in 0 .. jsonb_array_length(v_priced) - 1 loop
    v_tax := v_tax + (v_priced -> i ->> 'tax')::int;
  end loop;

  -- Tips, per stylist on the sale.
  for v_line in select * from jsonb_array_elements(coalesce(p_input -> 'tips', '[]')) loop
    if coalesce((v_line ->> 'amount_cents')::int, 0) < 0 then
      raise exception 'A tip can''t be negative' using errcode = '22023';
    end if;
    if coalesce((v_line ->> 'amount_cents')::int, 0) > 0 and not exists (
      select 1 from public.staff where id = (v_line ->> 'staff_id')::uuid and business_id = v_business.id
    ) then
      raise exception 'Unknown stylist for a tip' using errcode = '22023';
    end if;
    v_tips := v_tips + coalesce((v_line ->> 'amount_cents')::int, 0);
  end loop;

  v_total := v_subtotal - v_discount - v_line_discounts + v_tax + v_tips;

  -- Payments must cover the total exactly: what packages cover (added
  -- below), and the rest from what staff entered.
  for v_pay in select * from jsonb_array_elements(coalesce(p_input -> 'payments', '[]')) loop
    v_amount := coalesce((v_pay ->> 'amount_cents')::int, 0);
    if v_amount <= 0 then
      raise exception 'Enter each payment''s amount' using errcode = '22023';
    end if;
    if v_pay ->> 'method' not in ('cash', 'card', 'gift_card') then
      raise exception 'That way to pay isn''t available' using errcode = '22023';
    end if;
    if v_pay ->> 'method' = 'gift_card' and v_has_cards then
      raise exception 'Gift cards can''t be paid for with a gift card' using errcode = '22023';
    end if;
    if v_pay ->> 'method' = 'cash' and coalesce((v_pay ->> 'tendered_cents')::int, v_amount) < v_amount then
      raise exception 'The cash handed over is less than the amount' using errcode = '22023';
    end if;
    v_paid := v_paid + v_amount;
  end loop;
  if v_paid + v_covered <> v_total then
    raise exception 'Payments don''t add up to the total' using errcode = '22023';
  end if;

  update public.businesses set next_sale_number = next_sale_number + 1 where id = v_business.id returning next_sale_number - 1 into v_number;

  insert into public.sales (
    business_id, location_id, number, client_id, appointment_id, subtotal_cents, discount_cents, discount_reason,
    tax_cents, tip_cents, total_cents, note, receipt_email, created_by, rebook_appointment_id, draft_id
  ) values (
    v_business.id, p_location_id, v_number, v_client_id, v_appointment.id, v_subtotal, v_discount + v_line_discounts, v_discount_reason,
    v_tax, v_tips, v_total, nullif(trim(p_input ->> 'note'), ''), nullif(trim(p_input ->> 'receipt_email'), ''), v_me, v_rebook, v_draft.id
  ) returning id into v_sale_id;
  if v_draft.id is not null then
    update public.sale_drafts set status = 'completed', sale_id = v_sale_id where id = v_draft.id;
  end if;

  for i in 0 .. jsonb_array_length(v_rows) - 1 loop
    -- New gift cards are made first, so their line can point to them.
    v_card := null;
    if v_rows -> i ->> 'kind' = 'gift_card' then
      insert into public.gift_cards (business_id, code, kind, initial_cents, balance_cents, expires_at, client_id, recipient_name, recipient_email, physical, sale_id, created_by)
      values (v_business.id, coalesce(v_rows -> i ->> 'code', private.new_gift_code(v_business.id)), 'purchased', (v_rows -> i ->> 'unit')::int, 0,
              case when v_business.gift_card_expiry_months is not null then now() + make_interval(months => v_business.gift_card_expiry_months) end,
              v_client_id, v_rows -> i ->> 'recipient_name', v_rows -> i ->> 'recipient_email', v_rows -> i ->> 'code' is not null, v_sale_id, v_me)
      returning * into v_card;
      perform private.move_gift_card(v_card, 'sold', (v_rows -> i ->> 'unit')::int, v_sale_id, null);
    elsif v_rows -> i ->> 'kind' = 'gift_card_reload' then
      select * into v_card from public.gift_cards where id = (v_rows -> i ->> 'gift_card_id')::uuid for update;
      perform private.move_gift_card(v_card, 'reloaded', (v_rows -> i ->> 'unit')::int, v_sale_id, null);
    end if;
    v_package_id := null;
    if v_rows -> i ->> 'kind' = 'package' then
      v_package_id := private.sell_package((v_rows -> i ->> 'template_id')::uuid, v_client_id, v_sale_id, (v_priced -> i ->> 'total')::int - (v_priced -> i ->> 'tax')::int);
    end if;

    insert into public.sale_items (
      sale_id, business_id, position, kind, service_id, appointment_item_id, product_id, staff_id, description,
      quantity, unit_price_cents, booked_price_cents, price_reason, discount_cents, tax_cents, total_cents, gift_card_id,
      client_package_id, package_item_id, line_discount_cents, line_discount_reason
    ) values (
      v_sale_id, v_business.id, i + 1, (v_rows -> i ->> 'kind')::public.sale_item_kind,
      (v_rows -> i ->> 'service_id')::uuid, (v_rows -> i ->> 'appointment_item_id')::uuid, (v_rows -> i ->> 'product_id')::uuid,
      (v_rows -> i ->> 'staff_id')::uuid, v_rows -> i ->> 'description', (v_rows -> i ->> 'quantity')::int, (v_rows -> i ->> 'unit')::int,
      (v_rows -> i ->> 'booked')::int, v_rows -> i ->> 'reason',
      (v_priced -> i ->> 'discount')::int, (v_priced -> i ->> 'tax')::int, (v_priced -> i ->> 'total')::int, v_card.id,
      v_package_id, (v_rows -> i ->> 'package_item_id')::uuid,
      coalesce((v_rows -> i ->> 'line_discount')::int, 0), v_rows -> i ->> 'line_discount_reason'
    ) returning id into v_sale_item_id;
    if v_rows -> i ->> 'package_item_id' is not null then
      perform private.use_package((v_rows -> i ->> 'package_item_id')::uuid, v_sale_id, (v_rows -> i ->> 'appointment_item_id')::uuid);
      insert into public.payments (sale_id, business_id, location_id, method, amount_cents, reference, package_item_id, created_by)
      values (v_sale_id, v_business.id, p_location_id, 'package', (v_priced -> i ->> 'total')::int, left(v_rows -> i ->> 'package_name', 40), (v_rows -> i ->> 'package_item_id')::uuid, v_me);
    end if;
    if v_rows -> i ->> 'kind' = 'product' then
      perform private.move_stock(p_location_id, (v_rows -> i ->> 'product_id')::uuid, -(v_rows -> i ->> 'quantity')::int, 'sale', 'Sale #' || v_number, v_appointment.id);
    end if;
  end loop;

  insert into public.sale_tips (sale_id, business_id, staff_id, amount_cents)
  select v_sale_id, v_business.id, (t ->> 'staff_id')::uuid, sum((t ->> 'amount_cents')::int)
  from jsonb_array_elements(coalesce(p_input -> 'tips', '[]')) t
  where coalesce((t ->> 'amount_cents')::int, 0) > 0
  group by (t ->> 'staff_id')::uuid;

  for v_pay in select * from jsonb_array_elements(p_input -> 'payments') loop
    v_card := null;
    if v_pay ->> 'method' = 'gift_card' then
      v_card := private.usable_card(v_business.id, v_pay ->> 'code');
      if v_card.balance_cents < (v_pay ->> 'amount_cents')::int then
        raise exception 'Only % left on that gift card', to_char(v_card.balance_cents / 100.0, 'FM$999,990.00') using errcode = '22023';
      end if;
    end if;
    insert into public.payments (sale_id, business_id, location_id, method, amount_cents, tendered_cents, change_cents, reference, gift_card_id, created_by)
    values (
      v_sale_id, v_business.id, p_location_id, (v_pay ->> 'method')::public.payment_method, (v_pay ->> 'amount_cents')::int,
      case when v_pay ->> 'method' = 'cash' then coalesce((v_pay ->> 'tendered_cents')::int, (v_pay ->> 'amount_cents')::int) end,
      case when v_pay ->> 'method' = 'cash' then coalesce((v_pay ->> 'tendered_cents')::int, (v_pay ->> 'amount_cents')::int) - (v_pay ->> 'amount_cents')::int end,
      case when v_card.id is not null then '…' || right(v_card.code, 4) else nullif(trim(v_pay ->> 'reference'), '') end,
      v_card.id, v_me
    ) returning id into v_payment_id;
    if v_card.id is not null then
      perform private.move_gift_card(v_card, 'redeemed', -(v_pay ->> 'amount_cents')::int, v_sale_id, null);
    end if;
  end loop;

  insert into public.sale_events (sale_id, business_id, kind, amount_cents, staff_id)
  values (v_sale_id, v_business.id, 'completed', v_total, v_me);

  -- The visit is checked out (and its service products deducted).
  if v_appointment.id is not null then
    update public.appointments set
      status = 'completed',
      checked_in_at = coalesce(checked_in_at, now()),
      checked_out_at = now(),
      updated_by = v_me
    where id = v_appointment.id;
    for v_item in select i.id from public.appointment_items i where i.appointment_id = v_appointment.id order by i.starts_at loop
      perform private.deduct_item_stock(v_item.id);
    end loop;
  end if;

  return v_sale_id;
end;
$$;

revoke all on function public.approve_stock_override(uuid, uuid) from public, anon;
grant execute on function public.approve_stock_override(uuid, uuid) to authenticated;
