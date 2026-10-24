-- Notices when staff change a visit's day, time or stylist (editing it,
-- dragging it, or moving it to another day), as Denise's fixes already
-- record: one to the client and one to each stylist involved, in our fixed
-- templates (lib/notifications.ts, never AI-written). Like hers, they're
-- recorded in notifications until texts are connected.
--
-- The front of house records them for a visit at their location, to its
-- client or the salon's staff only, from the move templates only.

create function public.record_visit_notices(p_appointment_id uuid, p_notices jsonb)
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
  if v_appointment.id is null
     or not private.has_business_role(v_appointment.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed to change this appointment' using errcode = '42501';
  end if;
  for v_notice in select * from jsonb_array_elements(coalesce(p_notices, '[]')) loop
    if v_notice ->> 'template' not in ('visit_moved', 'staff_visit_moved') then
      raise exception 'Not a move notice' using errcode = '22023';
    end if;
    if (v_notice ->> 'template') = 'visit_moved' and (v_notice ->> 'client_id')::uuid is distinct from v_appointment.client_id then
      raise exception 'A visit notice goes to its own client' using errcode = '22023';
    end if;
    if (v_notice ->> 'template') = 'staff_visit_moved'
       and not exists (select 1 from public.staff s where s.id = (v_notice ->> 'staff_id')::uuid and s.business_id = v_appointment.business_id) then
      raise exception 'A stylist notice goes to the salon''s staff' using errcode = '22023';
    end if;
    insert into public.notifications (business_id, location_id, appointment_id, client_id, staff_id, template, body)
    values (
      v_appointment.business_id, v_appointment.location_id, p_appointment_id,
      case when v_notice ->> 'template' = 'visit_moved' then v_appointment.client_id end,
      case when v_notice ->> 'template' = 'staff_visit_moved' then (v_notice ->> 'staff_id')::uuid end,
      v_notice ->> 'template', v_notice ->> 'body'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.record_visit_notices(uuid, jsonb) from public, anon;
grant execute on function public.record_visit_notices(uuid, jsonb) to authenticated;
