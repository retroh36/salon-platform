-- Data export: owners download all their salon's data as CSV files in one
-- zip. Every export is logged (who, when, how many rows of each, how big).

create table public.data_exports (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  staff_id     uuid references public.staff (id) on delete set null,
  row_counts   jsonb not null,
  bytes        integer not null check (bytes >= 0),
  created_at   timestamptz not null default now()
);

create index data_exports_business_idx on public.data_exports (business_id, created_at desc);

alter table public.data_exports enable row level security;

create policy "Owners can view their data exports"
  on public.data_exports for select to authenticated
  using ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));

-- Logged before the file is handed over: no log, no file.
create function public.log_data_export(p_business_id uuid, p_row_counts jsonb, p_bytes integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can export their salon''s data' using errcode = '42501';
  end if;
  if jsonb_typeof(p_row_counts) is distinct from 'object' then
    raise exception 'p_row_counts must be an object' using errcode = '22023';
  end if;
  insert into public.data_exports (business_id, staff_id, row_counts, bytes)
  values (p_business_id, private.current_staff_id(p_business_id), p_row_counts, p_bytes)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.log_data_export(uuid, jsonb, integer) from public, anon;
grant execute on function public.log_data_export(uuid, jsonb, integer) to authenticated;
