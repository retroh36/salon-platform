-- A member paying their own share of an event pays their package with its
-- service charge and tax rounded down to the cent (memberShare in
-- lib/events/pricing.ts), never more than their exact share. Rounding the
-- charge and the tax up separately could make it a cent more, with the
-- main client a cent less; the main client's part is the total less what
-- members pay, so the leftover cent is now always theirs.

create or replace function private.event_member_share(p_price integer, p_charge_pct integer, p_tax_bp integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select p_price + (p_price * (p_charge_pct * 100 + p_tax_bp)) / 10000;
$$;

-- Events already priced: the main client's part and deposit again.
do $$
declare e record;
begin
  for e in select id from public.events where billing = 'split' loop
    perform private.price_event(e.id);
  end loop;
end $$;
