-- Managing the team in the app (Team → Add team member, a member's page):
-- owners manage everyone; managers manage everyone but owners, and can't
-- make anyone an owner (the staff RLS policies already say so; these
-- functions are security invoker, so those policies decide). Someone who
-- leaves is deactivated, never deleted, so their visits, sales and pay
-- history stay. Logins: an invite links a new login to their staff record
-- (the app does it with the service role, after checking the person
-- inviting may manage them); team_logins shows owners and managers whose
-- login is set up.

-- Who they are, their role and level, exactly which services they offer
-- (a stylist's own prices and lengths are kept for services they still
-- offer), and, when given, their weekly hours. Returns their id.
create function public.save_team_member(p_business_id uuid, p_location_id uuid, p_staff_id uuid, p_input jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_staff_id;
  v_me uuid := private.current_staff_id(p_business_id);
  v_old public.staff;
  v_role public.staff_role := (p_input ->> 'role')::public.staff_role;
  v_services uuid[] := coalesce((select array_agg(s::uuid) from jsonb_array_elements_text(coalesce(p_input -> 'service_ids', '[]')) s), '{}');
begin
  if not private.has_business_role(p_business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can manage the team' using errcode = '42501';
  end if;
  if nullif(trim(p_input ->> 'first_name'), '') is null then
    raise exception 'A first name' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.staff (business_id, location_id, first_name, last_name, email, phone, role, level)
    values (
      p_business_id, p_location_id, trim(p_input ->> 'first_name'), coalesce(trim(p_input ->> 'last_name'), ''),
      nullif(lower(trim(p_input ->> 'email')), ''), nullif(trim(p_input ->> 'phone'), ''), v_role,
      (nullif(p_input ->> 'level', ''))::public.staff_level
    )
    returning id into v_id;
  else
    select * into v_old from public.staff where id = v_id and business_id = p_business_id;
    if v_old.id is null then
      raise exception 'Not on the team' using errcode = 'P0002';
    end if;
    -- Nobody changes their own role, and the salon always keeps an owner.
    if v_id = v_me and v_role <> v_old.role then
      raise exception 'You can''t change your own role' using errcode = '55000';
    end if;
    if v_old.role = 'owner' and v_role <> 'owner'
       and not exists (select 1 from public.staff s where s.business_id = p_business_id and s.role = 'owner' and s.is_active and s.id <> v_id) then
      raise exception 'The salon needs an owner' using errcode = '55000';
    end if;
    update public.staff set
      first_name = trim(p_input ->> 'first_name'),
      last_name = coalesce(trim(p_input ->> 'last_name'), ''),
      email = nullif(lower(trim(p_input ->> 'email')), ''),
      phone = nullif(trim(p_input ->> 'phone'), ''),
      role = v_role,
      level = (nullif(p_input ->> 'level', ''))::public.staff_level
    where id = v_id and business_id = p_business_id;
    if not found then
      raise exception 'Not allowed to change this person' using errcode = '42501';
    end if;
  end if;

  delete from public.staff_services where staff_id = v_id and business_id = p_business_id and not (service_id = any (v_services));
  insert into public.staff_services (business_id, staff_id, service_id)
  select p_business_id, v_id, s.id from public.services s
  where s.business_id = p_business_id and s.id = any (v_services)
  on conflict (staff_id, service_id) do nothing;

  if p_input ? 'hours' then
    perform public.set_staff_weekly_hours(p_business_id, v_id, p_input -> 'hours');
  end if;
  return v_id;
end;
$$;

-- Someone leaving (or coming back). Deactivated staff can't sign in to
-- the salon or be booked; everything they did stays.
create function public.set_staff_active(p_staff_id uuid, p_active boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null or not private.has_business_role(v_staff.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only owners and managers can manage the team' using errcode = '42501';
  end if;
  if not p_active and v_staff.id = private.current_staff_id(v_staff.business_id) then
    raise exception 'You can''t deactivate yourself' using errcode = '55000';
  end if;
  if not p_active and v_staff.role = 'owner'
     and not exists (select 1 from public.staff s where s.business_id = v_staff.business_id and s.role = 'owner' and s.is_active and s.id <> v_staff.id) then
    raise exception 'The salon needs an owner' using errcode = '55000';
  end if;
  update public.staff set is_active = p_active where id = p_staff_id;
  if not found then
    raise exception 'Not allowed to change this person' using errcode = '42501';
  end if;
end;
$$;

-- Each staff member's login: the email they sign in with, when they were
-- invited, and when they last signed in (owners and managers only).
create function public.team_logins(p_business_id uuid)
returns table (staff_id uuid, email text, invited_at timestamptz, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, u.email::text, u.invited_at, u.last_sign_in_at
  from public.staff s
  join auth.users u on u.id = s.user_id
  where s.business_id = p_business_id
    and private.has_business_role(p_business_id, array['owner', 'manager']::public.staff_role[]);
$$;

revoke all on function public.save_team_member(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.set_staff_active(uuid, boolean) from public, anon;
revoke all on function public.team_logins(uuid) from public, anon;
grant execute on function public.save_team_member(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_staff_active(uuid, boolean) to authenticated;
grant execute on function public.team_logins(uuid) to authenticated;
