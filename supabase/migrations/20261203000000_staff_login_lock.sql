-- Which login belongs to a staff member is set only by the server (an
-- invite, lib/team-logins.ts, with the service role) or by setup scripts,
-- never by someone signed in: otherwise an owner could attach any login to
-- their salon. Staff RLS still decides who may edit the rest of the row.

create function private.lock_staff_login()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and (tg_op = 'INSERT' and new.user_id is not null or tg_op = 'UPDATE' and new.user_id is distinct from old.user_id) then
    raise exception 'A login is linked by an invite' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger staff_lock_login before insert or update of user_id on public.staff
  for each row execute function private.lock_staff_login();

-- Managers can't deactivate owners (said first, before the owner checks).
create or replace function public.set_staff_active(p_staff_id uuid, p_active boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null
     or not private.has_business_role(v_staff.business_id, array['owner', 'manager']::public.staff_role[])
     or (v_staff.role = 'owner' and not private.has_business_role(v_staff.business_id, array['owner']::public.staff_role[])) then
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
