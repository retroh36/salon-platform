-- Retail products get an employee price (what the team pays), a tax rate
-- of their own (null: the salon's retail rate; 0: not taxed) and other
-- barcodes beside the main one (another size's case, an old label). No
-- barcode is on two products of a salon, main or other.
--
-- A team purchase (sales.employee_id) is a sale to someone on the team with
-- no client or visit: products at their employee price, credited to nobody
-- (no commission).

alter table public.products
  add column employee_price_cents integer check (employee_price_cents >= 0),
  add column tax_rate_bp integer check (tax_rate_bp between 0 and 10000),
  add column other_barcodes text[] not null default '{}';
alter table public.products
  add constraint products_retail_only_prices check (type = 'retail' or (employee_price_cents is null and tax_rate_bp is null)),
  add constraint products_other_barcodes_check check (
    cardinality(other_barcodes) <= 10 and array_to_string(other_barcodes, ',') ~ '^([0-9]{6,14}(,[0-9]{6,14})*)?$'
  );
grant select (employee_price_cents, tax_rate_bp, other_barcodes) on public.products to authenticated;
create index products_other_barcodes_idx on public.products using gin (other_barcodes);

create function private.product_barcodes_unique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codes text[] := array_remove(array[new.barcode], null) || new.other_barcodes;
  v_taken text;
begin
  if cardinality(v_codes) = 0 then
    return new;
  end if;
  if (select count(distinct c) from unnest(v_codes) c) <> cardinality(v_codes) then
    raise exception 'The same barcode is in twice' using errcode = '23505';
  end if;
  -- One check at a time per salon, so two saves can't take one code.
  perform pg_advisory_xact_lock(hashtext('product_barcodes:' || new.business_id::text));
  select c into v_taken
  from unnest(v_codes) c
  where exists (
    select 1 from public.products p
    where p.business_id = new.business_id and p.id <> new.id and (p.barcode = c or c = any (p.other_barcodes))
  )
  limit 1;
  if v_taken is not null then
    raise exception 'Another product has barcode %', v_taken using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger products_barcodes_unique
before insert or update of barcode, other_barcodes on public.products
for each row execute function private.product_barcodes_unique();

alter table public.sales add column employee_id uuid references public.staff (id);
grant select (employee_id) on public.sales to authenticated;
create index sales_employee_id_idx on public.sales (employee_id) where employee_id is not null;

-- complete_sale: the team purchase, the employee price and each product's
-- own tax rate.
do $$
declare
  v_def text := pg_get_functiondef('public.complete_sale(uuid,jsonb)'::regprocedure);
  v_pairs text[][] := array[
    array[
      $o$  v_tier public.reward_tiers;
begin$o$,
      $n$  v_tier public.reward_tiers;
  -- A team purchase: who on the team is buying.
  v_employee uuid := nullif(p_input ->> 'employee_id', '')::uuid;
  v_unit integer;
begin$n$],
    array[
      $o$    raise exception 'Client not found' using errcode = 'P0002';
  end if;$o$,
      $n$    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if v_employee is not null then
    if v_appointment.id is not null or v_client_id is not null then
      raise exception 'A team purchase has no client or visit' using errcode = '22023', hint = 'employee';
    end if;
    if not exists (select 1 from public.staff where id = v_employee and business_id = v_business.id and is_active) then
      raise exception 'Choose who on the team is buying' using errcode = '22023', hint = 'employee';
    end if;
  end if;$n$],
    array[
      $o$      v_gross := v_product.price_cents * v_qty;$o$,
      $n$      -- The team pays the employee price (credited to nobody); everyone else the price.
      if v_employee is not null then
        v_staff_id := null;
      end if;
      v_unit := case when v_employee is not null then coalesce(v_product.employee_price_cents, v_product.price_cents) else v_product.price_cents end;
      v_gross := v_unit * v_qty;$n$],
    array[
      $o$'quantity', v_qty, 'unit', v_product.price_cents,$o$,
      $n$'quantity', v_qty, 'unit', v_unit,$n$],
    array[
      $o$'taxable_bp', v_business.tax_rate_retail_bp, 'discountable', true);$o$,
      $n$'taxable_bp', coalesce(v_product.tax_rate_bp, v_business.tax_rate_retail_bp), 'discountable', true);$n$],
    array[
      $o$created_by, rebook_appointment_id, draft_id
  ) values ($o$,
      $n$created_by, rebook_appointment_id, draft_id, employee_id
  ) values ($n$],
    array[
      $o$v_me, v_rebook, v_draft.id
  ) returning id into v_sale_id;$o$,
      $n$v_me, v_rebook, v_draft.id, v_employee
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
