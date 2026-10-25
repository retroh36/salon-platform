-- The deposit on a card link came from whoever called it, unchecked: the
-- app works it out from the policy, but called directly it could ask a
-- client for any amount, or for a deposit with no visit. Now a deposit is
-- at most the visit's price (or its service deposit), and only for a visit.

CREATE OR REPLACE FUNCTION public.create_card_request(p_client_id uuid, p_appointment_id uuid, p_token_hash text, p_deposit_cents integer, p_channel text, p_to text, p_hours integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client public.clients;
  v_location uuid;
  v_id uuid;
begin
  select * into v_client from public.clients where id = p_client_id;
  if v_client.id is null or not private.has_business_role(v_client.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_appointment_id is not null then
    select location_id into v_location from public.appointments
    where id = p_appointment_id and client_id = p_client_id and status in ('booked', 'confirmed');
    if v_location is null then
      raise exception 'That visit can''t take a deposit now' using errcode = '55000';
    end if;
  else
    v_location := (select id from public.locations where business_id = v_client.business_id order by created_at limit 1);
  end if;
  if p_hours not between 1 and 168 or p_deposit_cents < 0 then
    raise exception 'Check the link' using errcode = '22023';
  end if;
  -- A deposit is at most the visit's price (or the service's own deposit,
  -- set when it was booked, if that's more), and only for a visit.
  if p_deposit_cents > 0 and (p_appointment_id is null
     or p_deposit_cents > greatest(
          (select coalesce(sum(i.price_cents), 0) from public.appointment_items i where i.appointment_id = p_appointment_id),
          (select coalesce(a.deposit_cents, 0) from public.appointments a where a.id = p_appointment_id))) then
    raise exception 'A deposit can''t be more than the visit costs' using errcode = '22023';
  end if;
  update public.card_requests set status = 'canceled'
  where client_id = p_client_id and appointment_id is not distinct from p_appointment_id and status = 'open';
  insert into public.card_requests (business_id, location_id, client_id, appointment_id, token_hash, deposit_cents, channel, sent_to, expires_at, created_by)
  values (v_client.business_id, v_location, p_client_id, p_appointment_id, p_token_hash, p_deposit_cents, p_channel, trim(p_to),
          now() + make_interval(hours => p_hours), private.current_staff_id(v_client.business_id))
  returning id into v_id;
  return v_id;
end;
$function$;
