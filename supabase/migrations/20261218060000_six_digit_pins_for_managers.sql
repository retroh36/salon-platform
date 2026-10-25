-- Owners and managers can do much more from the shared iPad, so their PIN
-- is 6 digits; everyone else keeps 4 to 6. Saving checks it for the
-- person's role, and switching in refuses an owner's or manager's PIN that
-- isn't 6 digits (one saved before, or from before a promotion), since only
-- its hash is stored and its length can't be told from that.

drop function if exists private.pin_problem(text);
create function private.pin_problem(p_pin text, p_role public.staff_role)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_role in ('owner', 'manager') and (p_pin is null or p_pin !~ '^[0-9]{6}$') then 'Owners and managers use 6 digits.'
    when p_pin is null or p_pin !~ '^[0-9]{4,6}$' then 'Use 4 to 6 digits.'
    when p_pin ~ '^(.)\1+$' then 'Use different digits.'
    when position(p_pin in '01234567890') > 0 or position(p_pin in '09876543210') > 0 then 'Avoid a run like 1234.'
  end;
$$;

create or replace function public.set_my_pin(p_business_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_staff uuid := private.current_staff_id(p_business_id);
  v_problem text := private.pin_problem(p_pin, (select s.role from public.staff s where s.id = v_staff));
begin
  if v_staff is null then
    raise exception 'Not signed in here' using errcode = '42501';
  end if;
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  insert into public.staff_pins (staff_id, business_id, pin_hash)
  values (v_staff, p_business_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  on conflict (staff_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();
end;
$$;

CREATE OR REPLACE FUNCTION public.check_staff_pin(p_token_hash text, p_staff_id uuid, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_device public.shared_devices;
  v_staff public.staff;
  v_pin public.staff_pins;
begin
  select * into v_device from public.shared_devices where token_hash = p_token_hash and revoked_at is null;
  select * into v_staff from public.staff where id = p_staff_id;
  if v_device.id is null or v_staff.id is null or v_staff.business_id <> v_device.business_id
     or v_staff.location_id <> v_device.location_id or not v_staff.is_active or v_staff.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into v_pin from public.staff_pins where staff_id = p_staff_id for update;
  if v_pin.staff_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  -- Owners and managers use 6 digits; a shorter PIN from before isn't
  -- checked at all, so they set a new one.
  if v_staff.role in ('owner', 'manager') and length(coalesce(p_pin, '')) <> 6 then
    return jsonb_build_object('ok', false, 'reason', 'needs_six');
  end if;
  if v_pin.locked_until > now() then
    insert into public.device_switches (business_id, device_id, staff_id, outcome) values (v_device.business_id, v_device.id, p_staff_id, 'locked');
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_pin.locked_until);
  end if;
  if v_pin.pin_hash <> extensions.crypt(coalesce(p_pin, ''), v_pin.pin_hash) then
    update public.staff_pins
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' end
    where staff_id = p_staff_id
    returning * into v_pin;
    insert into public.device_switches (business_id, device_id, staff_id, outcome) values (v_device.business_id, v_device.id, p_staff_id, 'wrong_pin');
    return jsonb_build_object('ok', false, 'reason', case when v_pin.locked_until is not null then 'locked' else 'wrong' end,
                              'locked_until', v_pin.locked_until, 'left', greatest(0, 5 - v_pin.failed_attempts));
  end if;
  update public.staff_pins set failed_attempts = 0, locked_until = null where staff_id = p_staff_id;
  update public.shared_devices set last_used_at = now() where id = v_device.id;
  insert into public.device_switches (business_id, device_id, staff_id, outcome) values (v_device.business_id, v_device.id, p_staff_id, 'switched');
  return jsonb_build_object('ok', true, 'user_id', v_staff.user_id, 'email', (select u.email from auth.users u where u.id = v_staff.user_id));
end;
$function$;
