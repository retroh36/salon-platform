-- Consultation forms for visits booked by phone: the front of house texts
-- (or emails) the client a secure, once-only link to fill in and sign the
-- forms their visit needs on their own phone before they come, instead of
-- on the iPad at the desk (lib/form-links.ts, /form/<token>). Only the
-- token's sha256 is kept. Each form they sign is an ordinary signed form
-- on their profile (client_forms, with form_request_id saying it came by
-- link); the link is done once every form on it is signed, here or at the
-- desk since it was sent.

create table public.form_requests (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  location_id   uuid not null references public.locations (id) on delete cascade,
  client_id     uuid not null,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  template_ids  uuid[] not null check (cardinality(template_ids) between 1 and 10),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  channel       text not null check (channel in ('sms', 'email')),
  sent_to       text not null check (length(sent_to) between 3 and 254),
  status        text not null default 'open' check (status in ('open', 'done', 'canceled')),
  expires_at    timestamptz not null,
  created_by    uuid references public.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade
);
create index form_requests_appointment_idx on public.form_requests (appointment_id);
create index form_requests_business_idx on public.form_requests (business_id);
create unique index form_requests_one_open_idx on public.form_requests (appointment_id) where status = 'open';

alter table public.form_requests enable row level security;
create policy "The front of house reads form links" on public.form_requests
  for select to authenticated using (business_id in (select private.front_of_house_businesses()));

alter table public.client_forms add column form_request_id uuid references public.form_requests (id) on delete set null;

-- Sends a new link for a visit still to come (any open one for it is
-- canceled). It works until the visit starts, and at most p_hours.
create function public.create_form_request(p_appointment_id uuid, p_template_ids uuid[], p_token_hash text, p_channel text, p_to text, p_hours integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments;
  v_id uuid;
begin
  select * into v_a from public.appointments where id = p_appointment_id;
  if v_a.id is null or not private.front_of_house(v_a.business_id) then
    raise exception 'Only the front of house can send a form link' using errcode = '42501';
  end if;
  if v_a.client_id is null or v_a.status not in ('booked', 'confirmed') or v_a.starts_at <= now() then
    raise exception 'Form links are for visits still to come' using errcode = '55000', hint = 'visit';
  end if;
  if coalesce(cardinality(p_template_ids), 0) not between 1 and 10
     or exists (select 1 from unnest(p_template_ids) t(id)
                where not exists (select 1 from public.form_templates f where f.id = t.id and f.business_id = v_a.business_id and f.is_active)) then
    raise exception 'Choose the forms again' using errcode = '22023', hint = 'forms';
  end if;
  if p_hours not between 1 and 336 or p_channel not in ('sms', 'email') then
    raise exception 'Check the link' using errcode = '22023';
  end if;
  update public.form_requests set status = 'canceled' where appointment_id = p_appointment_id and status = 'open';
  insert into public.form_requests (business_id, location_id, client_id, appointment_id, template_ids, token_hash, channel, sent_to, expires_at, created_by)
  values (v_a.business_id, v_a.location_id, v_a.client_id, v_a.id, p_template_ids, p_token_hash, p_channel, btrim(p_to),
          least(now() + make_interval(hours => p_hours), v_a.starts_at), private.current_staff_id(v_a.business_id))
  returning id into v_id;
  return v_id;
end;
$$;

-- One form signed from the link (the service role: the client has no
-- login). Our code checks the answers first (checkAnswers); this keeps the
-- form as it was, once per link, and closes the link when all are signed.
-- Returns how many are still to sign.
create or replace function public.sign_form_from_link(p_request_id uuid, p_template_id uuid, p_answers jsonb, p_signature text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.form_requests;
  v_t public.form_templates;
  v_left integer;
begin
  select * into v_r from public.form_requests where id = p_request_id for update;
  if v_r.id is null or v_r.status <> 'open' then
    raise exception 'This link is no longer active' using errcode = '55000', hint = 'closed';
  end if;
  if v_r.expires_at <= now() then
    raise exception 'This link has expired' using errcode = '55000', hint = 'expired';
  end if;
  if not p_template_id = any (v_r.template_ids) then
    raise exception 'That form isn''t on this link' using errcode = '22023';
  end if;
  if exists (select 1 from public.client_forms where client_id = v_r.client_id and template_id = p_template_id and signed_at >= v_r.created_at) then
    raise exception 'That form is already signed' using errcode = '55000', hint = 'signed';
  end if;
  select * into v_t from public.form_templates where id = p_template_id and business_id = v_r.business_id;
  if v_t.id is null or not v_t.is_active then
    raise exception 'That form isn''t in use any more' using errcode = '55000', hint = 'inactive';
  end if;
  insert into public.client_forms (business_id, client_id, template_id, template_name, fields, answers, signature, form_request_id)
  values (v_r.business_id, v_r.client_id, v_t.id, v_t.name, v_t.fields, p_answers,
          case when exists (select 1 from jsonb_array_elements(v_t.fields) f where f ->> 'type' = 'signature') then p_signature end, v_r.id);
  select count(*) into v_left from unnest(v_r.template_ids) t(id)
  where not exists (select 1 from public.client_forms c where c.client_id = v_r.client_id and c.template_id = t.id and c.signed_at >= v_r.created_at);
  if v_left = 0 then
    update public.form_requests set status = 'done', completed_at = now() where id = v_r.id;
  end if;
  return v_left;
end;
$$;

revoke all on function public.create_form_request(uuid, uuid[], text, text, text, integer) from public, anon;
grant execute on function public.create_form_request(uuid, uuid[], text, text, text, integer) to authenticated;
revoke all on function public.sign_form_from_link(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.sign_form_from_link(uuid, uuid, jsonb, text) to service_role;
