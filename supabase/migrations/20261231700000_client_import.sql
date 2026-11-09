-- Importing clients from a CSV file (Settings → Import clients; owners and
-- managers, the settings permission). Sent in batches under one import.
-- A client already here (the same phone or email, or the same name with
-- neither) is left exactly as they are. Everyone added gets the usual
-- visit messages and no marketing consent. An import can be undone while
-- its clients have no visits or sales.

create table public.client_imports (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  file_name   text not null check (length(file_name) between 1 and 200),
  added       integer not null default 0,
  skipped     integer not null default 0,
  created_by  uuid references public.staff (id) on delete set null,
  created_at  timestamptz not null default now(),
  undone_at   timestamptz,
  undone_by   uuid references public.staff (id) on delete set null,
  removed     integer
);
create index client_imports_business on public.client_imports (business_id, created_at desc);

alter table public.client_imports enable row level security;
create policy client_imports_read on public.client_imports for select to authenticated
  using (business_id in (select private.businesses_with('settings')));

alter table public.clients add column import_id uuid references public.client_imports (id) on delete set null;
create index clients_import_idx on public.clients (import_id) where import_id is not null;
create index clients_business_email_lower on public.clients (business_id, lower(email)) where email is not null;
create index clients_business_phone_digits on public.clients (business_id, phone_digits) where phone_digits is not null;

create function public.import_clients(p_business_id uuid, p_import_id uuid, p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import uuid := p_import_id;
  v_row jsonb;
  v_first text;
  v_last text;
  v_phone text;
  v_email text;
  v_added integer := 0;
  v_skipped integer := 0;
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers import clients' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Send up to 1,000 clients at a time' using errcode = '22023';
  end if;
  if v_import is null then
    insert into public.client_imports (business_id, file_name, created_by)
    values (p_business_id, left(btrim(p_file_name), 200), private.current_staff_id(p_business_id))
    returning id into v_import;
  elsif not exists (select 1 from public.client_imports where id = v_import and business_id = p_business_id and undone_at is null) then
    raise exception 'Import not found' using errcode = 'P0002';
  end if;
  perform set_config('maestra.consent_source', 'import', true);
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_first := btrim(v_row ->> 'first_name');
    v_last := coalesce(btrim(v_row ->> 'last_name'), '');
    v_phone := nullif(btrim(v_row ->> 'phone'), '');
    v_email := nullif(lower(btrim(v_row ->> 'email')), '');
    if exists (
      select 1 from public.clients c
      where c.business_id = p_business_id
        and ((v_phone is not null and c.phone_digits = regexp_replace(v_phone, '\D', '', 'g'))
          or (v_email is not null and lower(c.email) = v_email)
          or (v_phone is null and v_email is null and c.phone is null and c.email is null and lower(c.first_name) = lower(v_first) and lower(c.last_name) = lower(v_last)))
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.clients (business_id, first_name, last_name, phone, email, birth_month, birth_day, notes, allergies, import_id)
    values (p_business_id, v_first, v_last, v_phone, v_email, (v_row ->> 'birth_month')::smallint, (v_row ->> 'birth_day')::smallint,
            nullif(btrim(v_row ->> 'notes'), ''), nullif(btrim(v_row ->> 'allergies'), ''), v_import);
    v_added := v_added + 1;
  end loop;
  update public.client_imports set added = added + v_added, skipped = skipped + v_skipped where id = v_import;
  return jsonb_build_object('import_id', v_import, 'added', v_added, 'skipped', v_skipped);
end;
$$;
revoke all on function public.import_clients(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.import_clients(uuid, uuid, text, jsonb) to authenticated;

-- Takes an import back: its clients go, unless they've had a visit or a
-- sale since or anything else now refers to them.
create function public.undo_client_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.client_imports;
  v_client uuid;
  v_removed integer := 0;
  v_kept integer := 0;
begin
  select * into v_import from public.client_imports where id = p_import_id for update;
  if v_import.id is null then
    raise exception 'Import not found' using errcode = 'P0002';
  end if;
  if not private.can(v_import.business_id, 'settings') then
    raise exception 'Only owners and managers undo an import' using errcode = '42501';
  end if;
  if v_import.undone_at is not null then
    raise exception 'That import has already been undone' using errcode = '22023';
  end if;
  for v_client in select id from public.clients where import_id = p_import_id loop
    if exists (select 1 from public.appointments where client_id = v_client) or exists (select 1 from public.sales where client_id = v_client) then
      v_kept := v_kept + 1;
      continue;
    end if;
    begin
      delete from public.clients where id = v_client;
      v_removed := v_removed + 1;
    exception when foreign_key_violation then
      v_kept := v_kept + 1;
    end;
  end loop;
  update public.client_imports set undone_at = now(), undone_by = private.current_staff_id(v_import.business_id), removed = v_removed where id = p_import_id;
  return jsonb_build_object('removed', v_removed, 'kept', v_kept);
end;
$$;
revoke all on function public.undo_client_import(uuid) from public, anon;
grant execute on function public.undo_client_import(uuid) to authenticated;
