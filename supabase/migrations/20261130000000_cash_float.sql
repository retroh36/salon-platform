-- A starting cash float for the close-out: the drawer opens each day with
-- the salon's usual float (Settings → Tax and receipts), which the owner
-- can change for a day when counting. Expected cash is the float plus the
-- day's cash taken, less cash refunds and voids.

alter table public.businesses
  add column cash_float_cents integer not null default 0 check (cash_float_cents between 0 and 1000000);

alter table public.cash_closeouts
  add column float_cents integer not null default 0 check (float_cents between 0 and 1000000);

-- As before, and the usual float.
create or replace function public.set_checkout_settings(p_business_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can change checkout settings' using errcode = '42501';
  end if;
  update public.businesses set
    tax_rate_services_bp = coalesce((p_settings ->> 'tax_rate_services_bp')::int, tax_rate_services_bp),
    tax_rate_retail_bp = coalesce((p_settings ->> 'tax_rate_retail_bp')::int, tax_rate_retail_bp),
    discount_roles = coalesce((select array_agg(r::public.staff_role) from jsonb_array_elements_text(p_settings -> 'discount_roles') r), discount_roles),
    discount_max_percent = coalesce((p_settings ->> 'discount_max_percent')::int, discount_max_percent),
    receipt_footer = case when p_settings ? 'receipt_footer' then nullif(trim(p_settings ->> 'receipt_footer'), '') else receipt_footer end,
    receipt_show_stylists = coalesce((p_settings ->> 'receipt_show_stylists')::boolean, receipt_show_stylists),
    cash_float_cents = coalesce((p_settings ->> 'cash_float_cents')::int, cash_float_cents)
  where id = p_business_id;
end;
$$;

drop function public.save_closeout(uuid, date, integer, text);

-- The count against the float plus the day's cash (worked out here, not
-- taken from the app). p_float_cents null: the day's float as saved, else
-- the salon's usual one. Returns counted less expected.
create function public.save_closeout(p_location_id uuid, p_day date, p_counted_cents integer, p_note text, p_float_cents integer default null)
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
begin
  select l.business_id, l.timezone into v_business_id, v_tz from public.locations l where l.id = p_location_id;
  if v_business_id is null or not private.has_business_role(v_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can close out the day' using errcode = '42501';
  end if;
  if p_counted_cents is null or p_counted_cents < 0 then
    raise exception 'Enter the cash counted' using errcode = '22023';
  end if;
  if p_float_cents is not null and (p_float_cents < 0 or p_float_cents > 1000000) then
    raise exception 'Enter the starting float' using errcode = '22023';
  end if;
  v_float := coalesce(
    p_float_cents,
    (select c.float_cents from public.cash_closeouts c where c.location_id = p_location_id and c.day = p_day),
    (select b.cash_float_cents from public.businesses b where b.id = v_business_id)
  );
  select v_float + coalesce(sum(p.amount_cents), 0)::int into v_expected
  from public.payments p
  where p.location_id = p_location_id and p.method = 'cash'
    and p.created_at >= (p_day::timestamp at time zone v_tz) and p.created_at < ((p_day + 1)::timestamp at time zone v_tz);

  insert into public.cash_closeouts (business_id, location_id, day, expected_cents, counted_cents, float_cents, note, closed_by)
  values (v_business_id, p_location_id, p_day, v_expected, p_counted_cents, v_float, nullif(trim(p_note), ''), private.current_staff_id(v_business_id))
  on conflict (location_id, day) do update set
    expected_cents = excluded.expected_cents, counted_cents = excluded.counted_cents, float_cents = excluded.float_cents,
    note = excluded.note, closed_by = excluded.closed_by, closed_at = now();
  return p_counted_cents - v_expected;
end;
$$;

revoke all on function public.save_closeout(uuid, date, integer, text, integer) from public, anon;
grant execute on function public.save_closeout(uuid, date, integer, text, integer) to authenticated;
