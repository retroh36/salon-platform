-- Marking a stylist out (the calendar's "Mark … out" panel): all day,
-- leaving early (out from a time, as before) or coming in late (out until
-- a time). A call-out now has an optional end, `ends_at`: null is the end
-- of the day. Its approved time off covers the same span, so the booking
-- rules and Denise's resolver see them free again from then.

alter table public.schedule_disruptions add column ends_at timestamptz;
alter table public.schedule_disruptions add constraint schedule_disruptions_ends_after_start
  check (ends_at is null or (starts_at is not null and ends_at > starts_at));

drop function public.report_call_out(uuid, timestamptz);

create function public.report_call_out(p_staff_id uuid, p_from timestamptz, p_until timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
  v_me uuid;
  v_tz text;
  v_local timestamp;
  v_minute int;
  v_until_local timestamp;
  v_end_minute int := 1440;
  v_time_off_id uuid;
  v_id uuid;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  v_me := private.current_staff_id(v_staff.business_id);
  if v_staff.id is null or v_staff.location_id is null or v_me is null or not (
    private.has_business_role(v_staff.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])
    or v_me = p_staff_id
  ) then
    raise exception 'Not allowed to report this' using errcode = '42501';
  end if;
  select l.timezone into v_tz from public.locations l where l.id = v_staff.location_id;
  v_local := p_from at time zone v_tz;
  v_minute := (extract(hour from v_local) * 60 + extract(minute from v_local))::int / 5 * 5;
  if p_until is not null then
    v_until_local := p_until at time zone v_tz;
    if v_until_local::date <> v_local::date or p_until <= p_from then
      raise exception 'Out until a later time the same day' using errcode = '22023';
    end if;
    v_end_minute := ceil((extract(hour from v_until_local) * 60 + extract(minute from v_until_local)) / 5.0)::int * 5;
  end if;

  select id into v_id from public.schedule_disruptions
  where kind = 'call_out' and staff_id = p_staff_id and on_date = v_local::date;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.staff_time_off (
    business_id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status, requested_by, decided_by, decided_at
  ) values (
    v_staff.business_id, p_staff_id, v_local::date, v_local::date, v_minute, v_end_minute, 'other',
    case when p_until is not null then 'Coming in late' else 'Out for the rest of the day' end,
    'approved', v_me, v_me, now()
  ) returning id into v_time_off_id;

  insert into public.schedule_disruptions (business_id, location_id, kind, on_date, staff_id, starts_at, ends_at, time_off_id, reported_by)
  values (v_staff.business_id, v_staff.location_id, 'call_out', v_local::date, p_staff_id, p_from, p_until, v_time_off_id, v_me)
  returning id into v_id;

  update public.locations set calendar_version = calendar_version + 1 where id = v_staff.location_id;
  return v_id;
end;
$$;
revoke all on function public.report_call_out(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_call_out(uuid, timestamptz, timestamptz) to authenticated;
