-- Staff moves ask before telling the client.
--
-- When staff dragged, edited or moved a visit to another day, the app
-- recorded a pending "visit_moved" text to the client, which a sender to
-- come would have sent by itself. Now nothing to a client goes out on its
-- own: the calendar asks "Let Maria know about the new time?" with the
-- message, and only Send there messages them (send_client_message, logged
-- with who sent it). So:
--   - every pending "visit_moved" notice to a client is canceled;
--   - record_visit_notices_for_user records notices to stylists only and
--     refuses one to a client;
--   - the salon chooses which answer the question leans to
--     (businesses.move_message_default: 'send', "Usually send", or 'skip',
--     "Usually don't"). It only decides the button that's first; neither
--     sends anything without a tap.
-- Online bookings and changes clients make themselves keep their own
-- confirmations: the client started those.

update public.notifications set status = 'canceled', updated_at = now()
where template = 'visit_moved' and client_id is not null and status = 'pending';

alter table public.businesses
  add column move_message_default text not null default 'send'
    constraint businesses_move_message_default_check check (move_message_default in ('send', 'skip'));

create or replace function public.record_visit_notices_for_user(p_user_id uuid, p_appointment_id uuid, p_notices jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_notice jsonb;
  v_count integer := 0;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if v_appointment.id is null or private.front_of_house_staff(p_user_id, v_appointment.business_id) is null then
    raise exception 'Not allowed to change this appointment' using errcode = '42501';
  end if;
  for v_notice in select * from jsonb_array_elements(coalesce(p_notices, '[]')) loop
    if nullif(v_notice ->> 'client_id', '') is not null or (v_notice ->> 'template') = 'visit_moved' then
      raise exception 'A move never records a message to a client' using errcode = '22023';
    end if;
    if (v_notice ->> 'template') is distinct from 'staff_visit_moved' then
      raise exception 'Not a move notice' using errcode = '22023';
    end if;
    if not exists (select 1 from public.staff s where s.id = (v_notice ->> 'staff_id')::uuid and s.business_id = v_appointment.business_id) then
      raise exception 'A stylist notice goes to the salon''s staff' using errcode = '22023';
    end if;
    insert into public.notifications (business_id, location_id, appointment_id, staff_id, template, body)
    values (v_appointment.business_id, v_appointment.location_id, p_appointment_id, (v_notice ->> 'staff_id')::uuid, 'staff_visit_moved', v_notice ->> 'body');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.record_visit_notices_for_user(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_visit_notices_for_user(uuid, uuid, jsonb) to service_role;
