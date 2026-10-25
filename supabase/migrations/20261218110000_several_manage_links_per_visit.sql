-- A visit keeps every manage link it's been given: the one in the booking
-- confirmation still works after the client opens the visit from their
-- account (which mints a fresh one), or after a reschedule. Only each
-- token's sha256 is stored, as before. Read and written by the service role
-- only (the booking site's server); staff never see them.

create table public.appointment_manage_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index appointment_manage_links_appointment on public.appointment_manage_links (appointment_id);

-- RLS on, no policies: nobody signed in reads or writes them.
alter table public.appointment_manage_links enable row level security;
revoke all on public.appointment_manage_links from anon, authenticated;

insert into public.appointment_manage_links (business_id, appointment_id, token_hash, created_at)
select business_id, id, manage_token_hash, created_at from public.appointments where manage_token_hash is not null;

create function private.has_manage_link(p_appointment_id uuid, p_token_hash text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (select 1 from public.appointment_manage_links l where l.appointment_id = p_appointment_id and l.token_hash = p_token_hash);
$$;

create or replace function public.cancel_online_appointment(p_appointment_id uuid, p_manage_token_hash text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.appointments set
    status = 'canceled',
    canceled_at = now(),
    cancel_reason = 'Canceled online by the client',
    updated_by = null
  where id = p_appointment_id and private.has_manage_link(id, p_manage_token_hash) and status in ('booked', 'confirmed');
  if not found then
    raise exception 'Appointment not found or can''t be canceled' using errcode = 'P0002';
  end if;
end;
$$;

-- A new booking gets its first link; a reschedule must come with one of
-- its links, and keeps them all.
create or replace function public.save_online_appointment(p_location_id uuid, p_appointment_id uuid, p_client_id uuid, p_notes text, p_items jsonb, p_expected_version bigint, p_manage_token_hash text, p_source text default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_appointment_id uuid;
begin
  if p_client_id is null then
    raise exception 'An online booking needs a client' using errcode = '22023';
  end if;
  if p_appointment_id is not null and not exists (
    select 1 from public.appointments a
    where a.id = p_appointment_id and private.has_manage_link(a.id, p_manage_token_hash) and a.client_id = p_client_id
      and a.status in ('booked', 'confirmed')
  ) then
    raise exception 'Appointment not found or can''t be changed' using errcode = 'P0002';
  end if;

  v_appointment_id := private.write_appointment(p_location_id, p_appointment_id, p_client_id, p_notes, p_items, p_expected_version, 'online', null);

  update public.appointments a set
    -- Where a new booking came from (a reschedule keeps the original's).
    online_source = case when p_appointment_id is null then p_source else a.online_source end,
    deposit_cents = coalesce((
      select sum(case s.deposit_kind
                   when 'fixed' then least(s.deposit_amount, i.price_cents)
                   when 'percent' then round(i.price_cents * s.deposit_amount / 100.0)::integer
                   else 0 end)
      from public.appointment_items i join public.services s on s.id = i.service_id
      where i.appointment_id = a.id
    ), 0)
  where a.id = v_appointment_id;
  if p_appointment_id is null then
    insert into public.appointment_manage_links (business_id, appointment_id, token_hash)
    select a.business_id, a.id, p_manage_token_hash from public.appointments a where a.id = v_appointment_id;
  end if;
  return v_appointment_id;
end;
$$;

-- Another link for a client's own visit (from their account), alongside
-- the ones they have.
create function public.add_manage_link(p_appointment_id uuid, p_client_id uuid, p_business_id uuid, p_token_hash text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.appointment_manage_links (business_id, appointment_id, token_hash)
  select a.business_id, a.id, p_token_hash from public.appointments a
  where a.id = p_appointment_id and a.client_id = p_client_id and a.business_id = p_business_id;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.add_manage_link(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.add_manage_link(uuid, uuid, uuid, text) to service_role;

-- One place for them now.
alter table public.appointments drop column manage_token_hash;
