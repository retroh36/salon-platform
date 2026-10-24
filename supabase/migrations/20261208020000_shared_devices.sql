-- The shared front-desk iPad: an owner or manager marks a device as shared
-- (shared_devices: only the hash of its token, kept in a cookie), then
-- anyone at that location with a PIN switches to themselves on it without
-- typing their password (check_staff_pin, service role: the app then signs
-- them in). Wrong PINs lock that person out for a few minutes; every switch
-- is logged. The device locks itself after the salon's idle time.

create table public.shared_devices (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  location_id  uuid not null references public.locations (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 60),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by   uuid references public.staff (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index shared_devices_business_id_idx on public.shared_devices (business_id);

-- One PIN per person, hashed (bcrypt). Nobody reads this table.
create table public.staff_pins (
  staff_id        uuid primary key references public.staff (id) on delete cascade,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  pin_hash        text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

create table public.device_switches (
  id         bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  device_id  uuid not null references public.shared_devices (id) on delete cascade,
  staff_id   uuid references public.staff (id) on delete set null,
  outcome    text not null check (outcome in ('switched', 'wrong_pin', 'locked')),
  created_at timestamptz not null default now()
);

create index device_switches_device_idx on public.device_switches (device_id, created_at desc);

alter table public.businesses
  add column auto_lock_minutes integer not null default 5 check (auto_lock_minutes between 1 and 60);

alter table public.shared_devices enable row level security;
alter table public.staff_pins enable row level security;
alter table public.device_switches enable row level security;

create policy "Owners and managers see the salon's shared devices" on public.shared_devices
  for select to authenticated using ((select private.can(business_id, 'settings')));
create policy "Owners and managers see who switched on shared devices" on public.device_switches
  for select to authenticated using ((select private.can(business_id, 'settings')));
-- staff_pins: no policies; only the functions below touch it.

-- PINs are 4 to 6 digits, and not the easy ones (all the same digit, or a
-- run like 1234 or 9876).
create function private.pin_problem(p_pin text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_pin is null or p_pin !~ '^[0-9]{4,6}$' then 'Use 4 to 6 digits.'
    when p_pin ~ '^(.)\1+$' then 'Use different digits.'
    when position(p_pin in '01234567890') > 0 or position(p_pin in '09876543210') > 0 then 'Avoid a run like 1234.'
  end;
$$;

-- Anyone sets their own PIN.
create function public.set_my_pin(p_business_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.current_staff_id(p_business_id);
  v_problem text := private.pin_problem(p_pin);
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

-- Whether people have a PIN (never the PIN): yourself, or with the team.
create function public.staff_with_pins(p_business_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.staff_id from public.staff_pins p
  where p.business_id = p_business_id
    and (private.can(p_business_id, 'team') or p.staff_id = private.current_staff_id(p_business_id));
$$;

-- Owners and managers clear someone's PIN (they set a new one themselves).
-- A manager can't clear an owner's.
create function public.clear_staff_pin(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null or not private.can(v_staff.business_id, 'team')
     or (v_staff.role = 'owner' and not private.has_business_role(v_staff.business_id, array['owner']::public.staff_role[])) then
    raise exception 'Only owners and managers clear PINs' using errcode = '42501';
  end if;
  delete from public.staff_pins where staff_id = p_staff_id;
end;
$$;

create function public.register_shared_device(p_location_id uuid, p_name text, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.locations where id = p_location_id);
  v_id uuid;
begin
  if v_business is null or not private.can(v_business, 'settings') then
    raise exception 'Only owners and managers set up shared devices' using errcode = '42501';
  end if;
  insert into public.shared_devices (business_id, location_id, name, token_hash, created_by)
  values (v_business, p_location_id, trim(p_name), p_token_hash, private.current_staff_id(v_business))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.revoke_shared_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.shared_devices where id = p_device_id);
begin
  if v_business is null or not private.can(v_business, 'settings') then
    raise exception 'Only owners and managers change shared devices' using errcode = '42501';
  end if;
  update public.shared_devices set revoked_at = now() where id = p_device_id and revoked_at is null;
end;
$$;

-- For the lock screen (service role): the device, and the people at its
-- location who can switch to it.
create function public.shared_device(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id, 'name', d.name, 'business_id', d.business_id, 'location_id', d.location_id,
    'salon', b.name, 'logo_path', b.logo_path, 'auto_lock_minutes', b.auto_lock_minutes,
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'first_name', s.first_name, 'last_initial', left(s.last_name, 1), 'role', s.role,
                                          'photo_path', s.photo_path, 'color', s.color) order by s.first_name, s.last_name)
      from public.staff s join public.staff_pins p on p.staff_id = s.id
      where s.business_id = d.business_id and s.location_id = d.location_id and s.is_active and s.user_id is not null
    ), '[]'::jsonb))
  from public.shared_devices d join public.businesses b on b.id = d.business_id
  where d.token_hash = p_token_hash and d.revoked_at is null;
$$;

-- Checks a PIN on a shared device (service role). Five wrong in a row
-- locks that person out for five minutes. Returns their login to sign in.
create function public.check_staff_pin(p_token_hash text, p_staff_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create function public.set_auto_lock(p_business_id uuid, p_minutes integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers change this' using errcode = '42501';
  end if;
  update public.businesses set auto_lock_minutes = p_minutes where id = p_business_id;
end;
$$;

revoke all on function public.set_my_pin(uuid, text) from public, anon;
revoke all on function public.staff_with_pins(uuid) from public, anon;
revoke all on function public.clear_staff_pin(uuid) from public, anon;
revoke all on function public.register_shared_device(uuid, text, text) from public, anon;
revoke all on function public.revoke_shared_device(uuid) from public, anon;
revoke all on function public.set_auto_lock(uuid, integer) from public, anon;
revoke all on function public.shared_device(text) from public, anon, authenticated;
revoke all on function public.check_staff_pin(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_my_pin(uuid, text) to authenticated;
grant execute on function public.staff_with_pins(uuid) to authenticated;
grant execute on function public.clear_staff_pin(uuid) to authenticated;
grant execute on function public.register_shared_device(uuid, text, text) to authenticated;
grant execute on function public.revoke_shared_device(uuid) to authenticated;
grant execute on function public.set_auto_lock(uuid, integer) to authenticated;
grant execute on function public.shared_device(text) to service_role;
grant execute on function public.check_staff_pin(text, uuid, text) to service_role;
