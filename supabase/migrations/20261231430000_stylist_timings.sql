-- A stylist's own times for the services they do (active, processing,
-- finishing; null = the menu's), set by hand or copied from another
-- stylist on Team → Service times, all or nothing. Whoever manages the
-- person (owners; managers with `team`, never for an owner). New bookings
-- take them (private.stylist_timing); booked visits keep their own.
create function public.set_staff_timings(p_staff_id uuid, p_timings jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
  v_me uuid;
  v_my_role public.staff_role;
  v_row jsonb;
  v_count integer := 0;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null then
    raise exception 'No such team member' using errcode = 'P0002';
  end if;
  v_me := private.current_staff_id(v_staff.business_id);
  select role into v_my_role from public.staff where id = v_me;
  if v_my_role is null or v_my_role not in ('owner', 'manager') or not private.can(v_staff.business_id, 'team')
     or (v_staff.role = 'owner' and v_my_role <> 'owner') then
    raise exception 'Only someone who manages % can change their times', v_staff.first_name using errcode = '42501';
  end if;
  if jsonb_typeof(p_timings) <> 'array' then
    raise exception 'Timings are a list' using errcode = '22023';
  end if;
  for v_row in select * from jsonb_array_elements(p_timings) loop
    update public.staff_services
    set active_minutes = (v_row ->> 'active_minutes')::int,
        processing_minutes = (v_row ->> 'processing_minutes')::int,
        finishing_minutes = (v_row ->> 'finishing_minutes')::int,
        updated_at = now()
    where staff_id = p_staff_id and service_id = (v_row ->> 'service_id')::uuid;
    if not found then
      raise exception '% doesn''t do that service', v_staff.first_name using errcode = '22023', hint = 'not_offered';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.set_staff_timings(uuid, jsonb) from public, anon;
grant execute on function public.set_staff_timings(uuid, jsonb) to authenticated;
