-- Patch tests at check-in. When the salon's setting is "block", a client
-- can't be checked in (or started, or checked out straight from booked)
-- while a service on the visit needs a patch test they don't have in order:
-- none, expired, too recent, or the latest showed a reaction. The same rule
-- as lib/scheduling/patch-tests.ts (patchTestState). A manager or owner can
-- check them in anyway with a reason (check_in_patch_override), logged in
-- the visit's history (appointment_events, kind patch_test_override).
-- With "warn", nothing here stops anyone.

alter table public.appointment_events drop constraint appointment_events_kind_check;
alter table public.appointment_events add constraint appointment_events_kind_check check (kind in ('check_in_undone', 'patch_test_override'));

-- ---------------------------------------------------------------------------
-- private.patch_tests_missing: services on the visit whose patch test isn't
-- in order, when the salon blocks without one (empty otherwise).
-- ---------------------------------------------------------------------------

create function private.patch_tests_missing(p_appointment_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct s.name order by s.name), '{}')
  from public.appointments a
  join public.businesses b on b.id = a.business_id and b.patch_test_enforcement = 'block'
  join public.appointment_items i on i.appointment_id = a.id
  join public.services s on s.id = i.service_id and s.requires_patch_test
  where a.id = p_appointment_id
    and a.client_id is not null
    and (
      -- The latest test before the service showed a reaction.
      coalesce((
        select t.result = 'reaction'
        from public.client_patch_tests t
        where t.client_id = a.client_id and t.tested_at <= i.starts_at
        order by t.tested_at desc
        limit 1
      ), false)
      -- Or none passed long enough before it, and recently enough.
      or not exists (
        select 1
        from public.client_patch_tests t
        where t.client_id = a.client_id
          and t.result = 'no_reaction'
          and t.tested_at <= i.starts_at - make_interval(hours => b.patch_test_min_hours)
          and t.tested_at >= i.starts_at - make_interval(days => b.patch_test_valid_days)
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- The check, on every way a visit goes from booked to here: check-in
-- (set_appointment_status), starting a service (record_item_time), and
-- checking out straight from booked (complete_sale). Not when a voided sale
-- reopens a visit.
-- ---------------------------------------------------------------------------

create function private.check_patch_test_on_arrival()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text[];
begin
  if old.status in ('booked', 'confirmed') and new.status in ('checked_in', 'completed')
     and not exists (select 1 from public.appointment_events e where e.appointment_id = new.id and e.kind = 'patch_test_override') then
    v_missing := private.patch_tests_missing(new.id);
    if cardinality(v_missing) > 0 then
      raise exception 'A valid patch test is needed for % before this visit. A manager or owner can check them in with a reason.', array_to_string(v_missing, ' and ')
        using errcode = '55000', hint = 'patch_test';
    end if;
  end if;
  return new;
end;
$$;

create trigger appointments_patch_test_on_arrival
  before update of status on public.appointments
  for each row execute function private.check_patch_test_on_arrival();

-- ---------------------------------------------------------------------------
-- check_in_patch_override: a manager or owner checks the client in without
-- the patch test, saying why. Logged with who, why and which services.
-- ---------------------------------------------------------------------------

create function public.check_in_patch_override(p_appointment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if v_appointment.id is null
     or not private.has_business_role(v_appointment.business_id, array['owner', 'manager']::public.staff_role[]) then
    raise exception 'Only a manager or owner can do that' using errcode = '42501';
  end if;
  if v_reason = '' or length(v_reason) > 300 then
    raise exception 'Say why (up to 300 characters)' using errcode = '22023';
  end if;
  if v_appointment.status not in ('booked', 'confirmed') then
    raise exception 'This visit is already checked in or over' using errcode = '55000';
  end if;

  insert into public.appointment_events (business_id, appointment_id, kind, detail, staff_id)
  values (
    v_appointment.business_id,
    p_appointment_id,
    'patch_test_override',
    jsonb_build_object('reason', v_reason, 'services', to_jsonb(private.patch_tests_missing(p_appointment_id))),
    private.current_staff_id(v_appointment.business_id)
  );
  perform public.set_appointment_status(p_appointment_id, 'checked_in', null);
end;
$$;

revoke all on function public.check_in_patch_override(uuid, text) from public, anon;
grant execute on function public.check_in_patch_override(uuid, text) to authenticated;
