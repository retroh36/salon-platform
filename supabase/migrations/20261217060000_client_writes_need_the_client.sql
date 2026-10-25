-- Assistants are read-only, and stylists work only with clients on their
-- own book, but recording a formula, a before-and-after photo or a patch
-- test checked only that you worked at the salon: an assistant could add
-- them, and a stylist could add them to any client. Now each needs a role
-- that records them and a client you can see (private.writes_client).

create function private.writes_client(p_business uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_business_role(p_business, array['owner', 'manager', 'front_desk', 'stylist']::public.staff_role[])
     and private.sees_client(p_business, p_client)
$$;
revoke all on function private.writes_client(uuid, uuid) from public, anon;
grant execute on function private.writes_client(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.add_formula(p_client_id uuid, p_appointment_item_id uuid, p_visit_date date, p_formula text, p_notes text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_business_id is null or v_staff_id is null or not private.writes_client(v_business_id, p_client_id) then
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
$function$;

CREATE OR REPLACE FUNCTION public.add_visit_photo(p_appointment_id uuid, p_kind text, p_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_appt public.appointments;
  v_me uuid;
  v_id uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id;
  if v_appt.id is null or not private.is_business_member(v_appt.business_id)
     or (v_appt.client_id is not null and not private.writes_client(v_appt.business_id, v_appt.client_id)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_appt.client_id is null then
    raise exception 'Photos are saved to a client; this visit has none' using errcode = '22023';
  end if;
  if p_kind not in ('before', 'after') then
    raise exception 'Say whether it''s before or after' using errcode = '22023';
  end if;
  if split_part(p_path, '/', 1) <> v_appt.business_id::text or split_part(p_path, '/', 2) <> v_appt.client_id::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'visit-photos' and o.name = p_path) then
    raise exception 'Upload the photo first' using errcode = '22023';
  end if;
  v_me := private.current_staff_id(v_appt.business_id);
  insert into public.visit_photos (business_id, client_id, appointment_id, staff_id, kind, storage_path, created_by)
  values (
    v_appt.business_id, v_appt.client_id, v_appt.id,
    (select i.staff_id from public.appointment_items i where i.appointment_id = v_appt.id order by i.starts_at, i.id limit 1),
    p_kind, p_path, v_me
  )
  returning id into v_id;
  return v_id;
end;
$function$;

drop policy "Members can record patch tests" on public.client_patch_tests;
create policy "Staff record patch tests for clients they see" on public.client_patch_tests
  for insert to authenticated
  with check ((select private.writes_client(business_id, client_id)));
