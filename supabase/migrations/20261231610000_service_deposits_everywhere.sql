-- The policy check on every booking: a service's own deposit (Settings →
-- Online booking, per service) was only asked of visits booked online,
-- which set appointments.deposit_cents in save_online_appointment. A visit
-- booked at the desk, by phone through Denise, from the waitlist, a group, a
-- series or a rebook at checkout now gets the same deposit, worked out the
-- same way from its services whenever they change while it's still to come,
-- so booking details asks for it ("Deposit needed") and the card link takes
-- it. Imported visits keep what they came with; the seeds' made-up history
-- is left alone.

create function private.visit_service_deposit(p_appointment_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case s.deposit_kind
                        when 'fixed' then least(s.deposit_amount, i.price_cents)
                        when 'percent' then round(i.price_cents * s.deposit_amount / 100.0)::integer
                        else 0 end), 0)::integer
  from public.appointment_items i join public.services s on s.id = i.service_id
  where i.appointment_id = p_appointment_id;
$$;

create function private.set_visit_deposit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.appointment_id, old.appointment_id);
begin
  if coalesce(current_setting('maestra.seeding', true), '') = 'on' or coalesce(new.imported, old.imported) then
    return null;
  end if;
  update public.appointments a set deposit_cents = private.visit_service_deposit(a.id)
  where a.id = v_id
    and a.status in ('booked', 'confirmed')
    and a.deposit_cents is distinct from private.visit_service_deposit(a.id);
  return null;
end;
$$;

create trigger appointment_items_deposit
  after insert or delete or update of service_id, price_cents on public.appointment_items
  for each row execute function private.set_visit_deposit();

revoke all on function private.visit_service_deposit(uuid) from public;
revoke all on function private.set_visit_deposit() from public;
