-- No path can double-book: the database itself refuses it, whatever saved
-- it. The booking rules (lib/scheduling/booking.ts) still check first and
-- explain; this is the guarantee underneath, for races and for any path
-- that forgot. The same two rules:
--   * a stylist's busy time (the service and finishing parts, not
--     processing) never overlaps their busy time on another visit;
--   * a chair or room is never taken by two items at once (processing
--     included: the client is still in it).
-- Only visits that hold time count (not canceled or no-show:
-- FREE_STATUSES), kept on each item as holds_time. Both are checked when the
-- transaction commits, so a fix that swaps two clients can move them one at
-- a time. Records brought in from another system (imported) are left as they
-- came, clashes and all, for Denise to fix; moving one makes it count.

create extension if not exists btree_gist with schema extensions;

-- When the stylist is with the client: the service, then finishing.
create function private.item_busy(p_start timestamptz, p_active integer, p_processing integer, p_finishing integer)
returns tstzmultirange
language sql
immutable
set search_path to ''
as $$
  select tstzmultirange(
    tstzrange(p_start, p_start + make_interval(mins => p_active)),
    tstzrange(p_start + make_interval(mins => p_active + p_processing), p_start + make_interval(mins => p_active + p_processing + p_finishing)));
$$;

-- When the chair or room is taken: the whole item.
create function private.item_held(p_start timestamptz, p_active integer, p_processing integer, p_finishing integer)
returns tstzrange
language sql
immutable
set search_path to ''
as $$
  select tstzrange(p_start, p_start + make_interval(mins => p_active + p_processing + p_finishing));
$$;

alter table public.appointment_items
  add column holds_time boolean not null default true,
  add column imported boolean not null default false,
  add column staff_busy tstzmultirange generated always as (private.item_busy(starts_at, active_minutes, processing_minutes, finishing_minutes)) stored,
  add column resource_held tstzrange generated always as (private.item_held(starts_at, active_minutes, processing_minutes, finishing_minutes)) stored;

update public.appointment_items i set holds_time = a.status not in ('canceled', 'no_show')
from public.appointments a where a.id = i.appointment_id;

-- An item holds time while its visit does; one moved is checked like any.
create function private.item_holds_time()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  new.holds_time := coalesce((select a.status not in ('canceled', 'no_show') from public.appointments a where a.id = new.appointment_id), true);
  if tg_op = 'UPDATE' and (new.starts_at, new.staff_id, new.resource_id, new.active_minutes, new.processing_minutes, new.finishing_minutes)
     is distinct from (old.starts_at, old.staff_id, old.resource_id, old.active_minutes, old.processing_minutes, old.finishing_minutes) then
    new.imported := false;
  end if;
  return new;
end;
$$;

create trigger appointment_items_holds_time before insert or update on public.appointment_items
  for each row execute function private.item_holds_time();

create function private.visit_holds_time()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.appointment_items set holds_time = new.status not in ('canceled', 'no_show')
  where appointment_id = new.id and holds_time is distinct from (new.status not in ('canceled', 'no_show'));
  return null;
end;
$$;

create trigger appointments_holds_time after update of status on public.appointments
  for each row when (old.status is distinct from new.status) execute function private.visit_holds_time();

alter table public.appointment_items
  add constraint appointment_items_no_double_booking
    exclude using gist (staff_id with =, staff_busy with &&) where (holds_time and not imported) deferrable initially deferred,
  add constraint appointment_items_no_double_resource
    exclude using gist (resource_id with =, resource_held with &&) where (holds_time and not imported and resource_id is not null) deferrable initially deferred;
