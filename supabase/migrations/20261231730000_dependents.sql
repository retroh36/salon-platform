-- A dependent: a client in a family (a child) whose visits another member,
-- their guardian, sees, books, changes and cancels from their own online
-- account, and whose confirmations and reminders go to the guardian. Staff
-- choose who's a dependent. Adults in a family see nothing of each other's
-- visits. Set only through set_client_guardian; leaving the family ends it.

alter table public.clients
  add column guardian_client_id uuid,
  add column guardian_set_by uuid references public.staff (id) on delete set null,
  add column guardian_set_at timestamptz,
  add foreign key (guardian_client_id, business_id) references public.clients (id, business_id) on delete set null (guardian_client_id),
  add constraint clients_not_own_guardian check (guardian_client_id is null or guardian_client_id <> id);
create index clients_guardian_idx on public.clients (guardian_client_id) where guardian_client_id is not null;

-- Clearing is harmless (the front of house can already change a client);
-- only naming a guardian has to come through the function.
create function private.lock_client_guardian()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('maestra.guardian_change', true), '') <> 'on'
     and new.guardian_client_id is not null
     and (tg_op = 'INSERT' or new.guardian_client_id is distinct from old.guardian_client_id) then
    raise exception 'A dependent''s guardian is changed on their family card' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clients_lock_guardian before insert or update of guardian_client_id on public.clients
  for each row execute function private.lock_client_guardian();

-- Someone who leaves the family stops being a dependent, or a guardian.
create function private.client_family_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_when = 'BEFORE' then
    new.guardian_client_id := null;
    return new;
  end if;
  update public.clients set guardian_client_id = null where guardian_client_id = new.id;
  return null;
end;
$$;
create trigger clients_family_left_self before update of family_id on public.clients
  for each row when (new.family_id is distinct from old.family_id) execute function private.client_family_left();
create trigger clients_family_left_others after update of family_id on public.clients
  for each row when (new.family_id is distinct from old.family_id) execute function private.client_family_left();

create function public.set_client_guardian(p_client_id uuid, p_guardian_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_guardian public.clients;
begin
  select * into v_client from public.clients where id = p_client_id for update;
  if v_client.id is null or not private.front_of_house(v_client.business_id) then
    raise exception 'Only owners, managers and front desk can change this' using errcode = '42501';
  end if;
  if p_guardian_id is not null then
    select * into v_guardian from public.clients where id = p_guardian_id and business_id = v_client.business_id;
    if v_guardian.id is null or v_guardian.id = v_client.id or v_client.family_id is null or v_guardian.family_id is distinct from v_client.family_id then
      raise exception 'A guardian is someone else in their family' using errcode = '22023', hint = 'family';
    end if;
    if v_guardian.guardian_client_id is not null then
      raise exception '% is a dependent, so can''t be a guardian', v_guardian.first_name using errcode = '22023', hint = 'guardian_dependent';
    end if;
    if exists (select 1 from public.clients where guardian_client_id = v_client.id) then
      raise exception '% is a guardian, so can''t be a dependent', v_client.first_name using errcode = '22023', hint = 'has_dependents';
    end if;
  end if;
  perform set_config('maestra.guardian_change', 'on', true);
  update public.clients
  set guardian_client_id = p_guardian_id, guardian_set_by = private.current_staff_id(v_client.business_id), guardian_set_at = now()
  where id = v_client.id;
  perform set_config('maestra.guardian_change', 'off', true);
end;
$$;
revoke all on function public.set_client_guardian(uuid, uuid) from public, anon;
grant execute on function public.set_client_guardian(uuid, uuid) to authenticated;
