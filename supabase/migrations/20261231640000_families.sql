-- Families: clients linked into a household (a parent and their children, a
-- couple), each still their own client with their own visits, formulas and
-- history. A family can name who usually pays for its visits (a member),
-- which the paying client and card authorization build on.
--
-- A client is in one family at most (clients.family_id). Families and the
-- link are written only through save_family / delete_family (front of
-- house); a trigger keeps anyone else from changing a client's family.

create table public.families (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- Who usually pays for the family's visits; null: each pays their own.
  payer_client_id uuid,
  created_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (payer_client_id, business_id) references public.clients (id, business_id) on delete set null (payer_client_id)
);
create index families_business_idx on public.families (business_id);

alter table public.clients
  add column family_id uuid,
  add foreign key (family_id, business_id) references public.families (id, business_id) on delete set null (family_id);
create index clients_family_idx on public.clients (family_id) where family_id is not null;

alter table public.families enable row level security;

-- The front of house sees every family; anyone else the families of the
-- clients they can see (the clients policy decides which).
create policy "Members can view families" on public.families for select to authenticated
  using (
    business_id in (select private.front_of_house_businesses())
    or id in (select c.family_id from public.clients c where c.family_id is not null)
  );

create function private.lock_client_family()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('maestra.family_change', true), '') <> 'on'
     and (tg_op = 'INSERT' and new.family_id is not null
          or tg_op = 'UPDATE' and new.family_id is distinct from old.family_id) then
    raise exception 'A client''s family is changed on their family card' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger clients_lock_family before insert or update of family_id on public.clients
  for each row execute function private.lock_client_family();

-- Creates (p_family_id null) or changes a family: its name, exactly these
-- members (2 to 12; anyone left out leaves it) and who usually pays. A
-- client already in another family is refused (hint other_family): they
-- leave that one first.
create function public.save_family(p_business_id uuid, p_family_id uuid, p_name text, p_client_ids uuid[], p_payer_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_family_id;
  v_members uuid[] := array(select distinct unnest(coalesce(p_client_ids, '{}')));
  v_name text := btrim(coalesce(p_name, ''));
  v_other text;
begin
  if not private.front_of_house(p_business_id) then
    raise exception 'Only owners, managers and front desk can change families' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Give the family a name' using errcode = '22023', hint = 'name';
  end if;
  if cardinality(v_members) not between 2 and 12 then
    raise exception 'A family has 2 to 12 people' using errcode = '22023', hint = 'members';
  end if;
  if (select count(*) from public.clients where id = any(v_members) and business_id = p_business_id) <> cardinality(v_members) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if p_payer_client_id is not null and not p_payer_client_id = any(v_members) then
    raise exception 'Who pays must be in the family' using errcode = '22023', hint = 'payer';
  end if;
  if v_id is not null and not exists (select 1 from public.families where id = v_id and business_id = p_business_id) then
    raise exception 'Family not found' using errcode = 'P0002';
  end if;
  select first_name || ' ' || last_name into v_other
    from public.clients
    where id = any(v_members) and family_id is not null and family_id is distinct from v_id
    limit 1;
  if v_other is not null then
    raise exception '% is already in another family', btrim(v_other) using errcode = '23505', hint = 'other_family';
  end if;

  if v_id is null then
    insert into public.families (business_id, name, payer_client_id, created_by)
      values (p_business_id, v_name, p_payer_client_id, private.current_staff_id(p_business_id))
      returning id into v_id;
  else
    update public.families set name = v_name, payer_client_id = p_payer_client_id, updated_at = now() where id = v_id;
  end if;

  perform set_config('maestra.family_change', 'on', true);
  update public.clients set family_id = null where family_id = v_id and not id = any(v_members);
  update public.clients set family_id = v_id where id = any(v_members) and family_id is distinct from v_id;
  perform set_config('maestra.family_change', 'off', true);
  return v_id;
end;
$$;

-- Unlinks everyone and removes the family; each keeps their own profile.
create function public.delete_family(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.families where id = p_family_id;
  if v_business is null then
    raise exception 'Family not found' using errcode = 'P0002';
  end if;
  if not private.front_of_house(v_business) then
    raise exception 'Only owners, managers and front desk can change families' using errcode = '42501';
  end if;
  perform set_config('maestra.family_change', 'on', true);
  update public.clients set family_id = null where family_id = p_family_id;
  perform set_config('maestra.family_change', 'off', true);
  delete from public.families where id = p_family_id;
end;
$$;

revoke all on function public.save_family(uuid, uuid, text, uuid[], uuid), public.delete_family(uuid) from public, anon;
grant execute on function public.save_family(uuid, uuid, text, uuid[], uuid), public.delete_family(uuid) to authenticated;
grant select on public.families to authenticated;
