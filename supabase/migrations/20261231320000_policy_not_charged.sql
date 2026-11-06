-- "Not charged, and why" (Coterie's item 10): every no-show and late
-- cancellation in a period, by the visit's start, with what the visit was
-- booked for, the fee the policy set and what was collected, so the Policy
-- page can say in dollars what wasn't charged and why
-- (lib/policy-report.ts, notCharged).
--
-- Reports only (owners and managers, a bookkeeper, anyone an owner allows).
-- No client names or visits: one row per incident, so a bookkeeper reads it
-- too. A no-show with no fee assessed (no client on the visit, or before the
-- salon had a policy) comes back with a null status. Late cancellations
-- only exist as fees: a cancellation in good time, or by the salon, was
-- never the client's to pay.

create function public.policy_not_charged(p_business_id uuid, p_from timestamptz, p_to timestamptz)
returns table (kind text, visit_cents integer, fee_cents integer, collected_cents integer, status text, waive_reason text, failure_reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with incidents as (
    select a.id, coalesce(f.kind, 'no_show') as kind, f.fee_cents, f.from_deposit_cents, f.status, f.waive_reason, f.failure_reason
    from public.appointments a
    left join public.policy_fees f on f.appointment_id = a.id and f.status <> 'voided'
    where a.business_id = p_business_id
      and a.starts_at >= p_from and a.starts_at < p_to
      and (a.status = 'no_show' or f.kind = 'late_cancel')
  )
  select i.kind,
         coalesce((select sum(it.price_cents) from public.appointment_items it where it.appointment_id = i.id), 0)::int,
         coalesce(i.fee_cents, 0),
         -- A charged fee in full (a kept deposit included); a waived one was
         -- refunded; otherwise whatever deposit was kept towards it.
         case i.status when 'charged' then i.fee_cents when 'waived' then 0 else coalesce(i.from_deposit_cents, 0) end,
         i.status,
         i.waive_reason,
         i.failure_reason
  from incidents i
  where private.can(p_business_id, 'reports');
$$;

revoke all on function public.policy_not_charged(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.policy_not_charged(uuid, timestamptz, timestamptz) to authenticated;
