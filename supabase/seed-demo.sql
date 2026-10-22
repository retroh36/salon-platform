-- The busy demo month, added on top of supabase/seed.sql by
-- `npm run seed:demo` (which resets the database first): time off, a
-- month of appointments, blocked time and a waitlist. The database and
-- browser tests (npm run test:db, npm run test:e2e) expect this data.
-- All people are made up.

-- Time off and one-off changes, relative to the reset date so they're always
-- current. next_monday is the Monday after today (local time).
with d as (
  select (now() at time zone 'America/Chicago')::date as today,
         (now() at time zone 'America/Chicago')::date
           + (8 - extract(isodow from (now() at time zone 'America/Chicago')::date))::int as next_monday
)
insert into public.staff_time_off (
  business_id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status,
  requested_by, decided_by, decided_at
)
select 'b0000000-0000-4000-8000-000000000001', t.staff_id::uuid, t.starts_on, t.ends_on, t.start_minute, t.end_minute,
       t.reason::public.time_off_reason, t.note, t.status::public.time_off_status,
       t.requested_by::uuid, t.decided_by::uuid, case when t.status = 'requested' then null else now() end
from d, lateral (values
  -- Sandra: a week's vacation, the week after next (approved by Olivia)
  ('d0000000-0000-4000-8000-000000000008', d.next_monday + 7, d.next_monday + 13, null::int, null::int,
   'vacation', 'Family trip', 'approved', 'd0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000001'),
  -- Gil: called in sick yesterday (entered by Daniel)
  ('d0000000-0000-4000-8000-000000000005', d.today - 1, d.today - 1, null, null,
   'sick', null, 'approved', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002'),
  -- Hannah: dentist next Thursday afternoon
  ('d0000000-0000-4000-8000-000000000006', d.next_monday + 3, d.next_monday + 3, 14 * 60, 16 * 60,
   'personal', 'Dentist', 'approved', 'd0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000002'),
  -- Shae: a pending request for the Friday after next
  ('d0000000-0000-4000-8000-000000000009', d.next_monday + 11, d.next_monday + 11, null, null,
   'personal', 'Sister''s graduation', 'requested', 'd0000000-0000-4000-8000-000000000009', null),
  -- Bridget: a declined request (shows the history)
  ('d0000000-0000-4000-8000-000000000004', d.next_monday + 5, d.next_monday + 5, null, null,
   'personal', 'Long weekend', 'declined', 'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001')
) as t (staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status, requested_by, decided_by);

-- Nola covers a late Friday next week, 12:00 to 20:00 instead of 9 to 5.
insert into public.staff_schedule_overrides (business_id, staff_id, on_date, start_minute, end_minute)
select 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000007',
       (now() at time zone 'America/Chicago')::date
         + (8 - extract(isodow from (now() at time zone 'America/Chicago')::date))::int + 4,
       12 * 60, 20 * 60;

-- ---------------------------------------------------------------------------
-- A month of appointments: three weeks back to nine days ahead, about 70%
-- of the stylists' bookable time. Deterministic for a given reset date.
--
-- Built greedily, stylist by stylist, following the booking rules in
-- lib/scheduling/booking.ts (tests/db/appointments.test.ts checks every
-- seeded item against them):
--   - only services the stylist offers, within their hours, the salon's
--     hours and around approved time off,
--   - no overlapping busy time; short services are fitted into some color
--     processing gaps, in a spare chair (the color client keeps theirs),
--   - one client per chair or room at a time, processing included.
-- Some color visits continue with a blow-dry or cut from another stylist,
-- as one appointment with two items.
-- ---------------------------------------------------------------------------

-- Stable pseudo-random number 0..9999.
create function pg_temp.rnd(key text) returns int
language sql immutable as $$ select abs(hashtext(key)) % 10000 $$;

create function pg_temp.at_local(d date, minute int) returns timestamptz
language sql stable as $$ select (d + make_interval(mins => minute)) at time zone 'America/Chicago' $$;

-- Salon open, staff member on shift and no approved time off for [p_from, p_to).
create function pg_temp.staff_free(p_staff uuid, d date, p_from int, p_to int) returns boolean
language sql stable as $$
  select
    exists (
      select 1 from public.location_hours lh
      where lh.location_id = 'c0000000-0000-4000-8000-000000000001'
        and lh.weekday = extract(isodow from d) and lh.start_minute <= p_from and p_to <= lh.end_minute
    )
    and case
      when exists (select 1 from public.staff_schedule_overrides o where o.staff_id = p_staff and o.on_date = d) then
        exists (
          select 1 from public.staff_schedule_overrides o
          where o.staff_id = p_staff and o.on_date = d and o.start_minute <= p_from and p_to <= o.end_minute
        )
      else
        exists (
          select 1 from public.staff_working_hours w
          where w.staff_id = p_staff and w.weekday = extract(isodow from d) and w.start_minute <= p_from and p_to <= w.end_minute
        )
    end
    and not exists (
      select 1 from public.staff_time_off t
      where t.staff_id = p_staff and t.status = 'approved' and d between t.starts_on and t.ends_on
        and (t.start_minute is null or (t.start_minute < p_to and p_from < t.end_minute))
    )
$$;

-- Busy parts of an item: [start, start + active) and the finishing part.
create function pg_temp.busy_parts(s timestamptz, a int, p int, f int) returns table (part_start timestamptz, part_end timestamptz)
language sql immutable as $$
  select s, s + make_interval(mins => a)
  union all
  select s + make_interval(mins => a + p), s + make_interval(mins => a + p + f) where f > 0
$$;

-- Would the staff member be busy with someone else?
create function pg_temp.staff_clash(p_staff uuid, s timestamptz, a int, p int, f int) returns boolean
language sql stable as $$
  select exists (
    select 1
    from public.appointment_items i
    join public.appointments ap on ap.id = i.appointment_id
    cross join lateral pg_temp.busy_parts(i.starts_at, i.active_minutes, i.processing_minutes, i.finishing_minutes) x
    cross join lateral pg_temp.busy_parts(s, a, p, f) y
    where i.staff_id = p_staff
      and ap.status not in ('canceled', 'no_show')
      and i.starts_at < s + make_interval(mins => a + p + f) and i.ends_at > s
      and x.part_start < y.part_end and y.part_start < x.part_end
  )
$$;

create function pg_temp.resource_free(p_resource uuid, s timestamptz, e timestamptz) returns boolean
language sql stable as $$
  select not exists (
    select 1
    from public.appointment_items i
    join public.appointments ap on ap.id = i.appointment_id
    where i.resource_id = p_resource and ap.status not in ('canceled', 'no_show') and i.starts_at < e and i.ends_at > s
  )
$$;

-- The first free resource of the candidates, or null.
create function pg_temp.pick_resource(candidates uuid[], s timestamptz, e timestamptz) returns uuid
language sql stable as $$
  select c from unnest(candidates) with ordinality as u (c, n) where pg_temp.resource_free(c, s, e) order by n limit 1
$$;

create function pg_temp.add_item(
  p_appointment uuid, p_staff uuid, p_service uuid, p_resource uuid, s timestamptz
) returns void
language sql as $$
  insert into public.appointment_items (
    business_id, location_id, appointment_id, service_id, staff_id, resource_id, starts_at, ends_at,
    active_minutes, processing_minutes, finishing_minutes, price_cents
  )
  select sv.business_id, 'c0000000-0000-4000-8000-000000000001', p_appointment, sv.id, p_staff, p_resource, s,
         s + make_interval(mins => sv.duration_minutes),
         sv.active_minutes, sv.processing_minutes, sv.finishing_minutes, coalesce(ss.price_cents, sv.price_cents)
  from public.services sv
  join public.staff_services ss on ss.service_id = sv.id and ss.staff_id = p_staff
  where sv.id = p_service
$$;

-- A client with no other appointment that day, favoring the stylist's regulars.
create function pg_temp.pick_client(p_staff uuid, d date, key text) returns uuid
language plpgsql stable as $$
declare
  v_client uuid;
begin
  for attempt in 0..9 loop
    select c.id into v_client
    from public.clients c
    where c.business_id = 'b0000000-0000-4000-8000-000000000001'
      and (c.preferred_staff_id = p_staff or c.preferred_staff_id is null)
    order by c.id
    offset pg_temp.rnd(key || ':' || attempt) % 250
    limit 1;
    if v_client is not null and not exists (
      select 1 from public.appointments a
      where a.client_id = v_client and a.starts_at >= pg_temp.at_local(d, 0) and a.starts_at < pg_temp.at_local(d + 1, 0)
    ) then
      return v_client;
    end if;
  end loop;
  return null;
end;
$$;

-- Who booked it: the front desk (Sam), the manager (Daniel) or the owner
-- (Olivia) take in-person and phone bookings; online bookings are made by
-- the client, so have no staff member. Booked one to three weeks ahead.
create function pg_temp.new_appointment(p_client uuid, s timestamptz, e timestamptz, key text) returns uuid
language sql as $$
  insert into public.appointments (business_id, location_id, client_id, starts_at, ends_at, source, created_by, updated_by, created_at)
  select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', p_client, s, e,
         src::public.appointment_source, booker, booker,
         least(s - make_interval(days => 1 + pg_temp.rnd(key || ':ahead') % 20, mins => pg_temp.rnd(key || ':at') % 600), now())
  from (select case when pg_temp.rnd(key || ':src') % 100 < 45 then 'front_desk'
                    when pg_temp.rnd(key || ':src') % 100 < 80 then 'online'
                    else 'phone' end as src) x
  cross join lateral (select case
      when x.src = 'online' then null
      when pg_temp.rnd(key || ':by') % 10 < 7 then 'd0000000-0000-4000-8000-000000000003'::uuid -- Sam
      when pg_temp.rnd(key || ':by') % 10 < 9 then 'd0000000-0000-4000-8000-000000000002'::uuid -- Daniel
      else 'd0000000-0000-4000-8000-000000000001'::uuid -- Olivia
    end as booker) b
  returning id
$$;

do $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_spares uuid[] := array['f0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000007']::uuid[];
  v_room uuid := 'f0000000-0000-4000-8000-000000000009';
  d date;
  st record;
  sh record;
  svc record;
  extra record;
  cur int;
  key text;
  v_start timestamptz;
  v_end timestamptz;
  v_client uuid;
  v_resource uuid;
  v_appointment uuid;
begin
  for d in select generate_series(v_today - 21, v_today + 9, interval '1 day')::date loop
    -- Colorists first, so their follow-ups are in place before the others' days fill up.
    for st in
      select * from (values
        ('d0000000-0000-4000-8000-000000000004'::uuid, 'f0000000-0000-4000-8000-000000000001'::uuid, 1),
        ('d0000000-0000-4000-8000-000000000008'::uuid, 'f0000000-0000-4000-8000-000000000004'::uuid, 2),
        ('d0000000-0000-4000-8000-000000000005'::uuid, 'f0000000-0000-4000-8000-000000000002'::uuid, 3),
        ('d0000000-0000-4000-8000-000000000006'::uuid, 'f0000000-0000-4000-8000-000000000003'::uuid, 4),
        ('d0000000-0000-4000-8000-000000000007'::uuid, 'f0000000-0000-4000-8000-000000000008'::uuid, 5),
        ('d0000000-0000-4000-8000-000000000009'::uuid, 'f0000000-0000-4000-8000-000000000005'::uuid, 6),
        ('d0000000-0000-4000-8000-000000000010'::uuid, 'f0000000-0000-4000-8000-000000000007'::uuid, 7)
      ) as s (staff_id, home, n)
      order by n
    loop
      for sh in
        select o.start_minute, o.end_minute from public.staff_schedule_overrides o where o.staff_id = st.staff_id and o.on_date = d
        union all
        select w.start_minute, w.end_minute from public.staff_working_hours w
        where w.staff_id = st.staff_id and w.weekday = extract(isodow from d)
          and not exists (select 1 from public.staff_schedule_overrides o where o.staff_id = st.staff_id and o.on_date = d)
        order by 1
      loop
        cur := sh.start_minute;
        while cur < sh.end_minute loop
          key := d || ':' || st.staff_id || ':' || cur;

          -- Some time stays open.
          if pg_temp.rnd(key || ':idle') % 100 < 30 then
            cur := cur + 15 * (1 + pg_temp.rnd(key || ':gap') % 3);
            continue;
          end if;

          -- A service that fits before the end of the shift; everyday
          -- services come up more often.
          select sv.id, sv.name, sv.category, sv.active_minutes, sv.processing_minutes, sv.finishing_minutes, sv.duration_minutes
          into svc
          from public.staff_services ss
          join public.services sv on sv.id = ss.service_id
          where ss.staff_id = st.staff_id and sv.archived_at is null and cur + sv.duration_minutes <= sh.end_minute
          order by -ln((pg_temp.rnd(key || sv.id) + 1) / 10001.0)
                   / case when sv.name in ('Women''s Cut & Style', 'Men''s Cut', 'Skin Fade', 'Root Touch-Up', 'Balayage',
                                           'Partial Highlights', 'Full Highlights', 'Blowout', 'Gloss / Toner', 'All-Over Color')
                          then 5 when sv.name in ('Color Correction', 'Bridal Trial', 'Color Consultation', 'Restyle / Big Chop')
                          then 0.3 else 1 end
          limit 1;
          exit when not found;

          v_start := pg_temp.at_local(d, cur);
          v_end := v_start + make_interval(mins => svc.duration_minutes);
          v_resource := pg_temp.pick_resource(
            case when svc.name in ('Keratin Smoothing', 'Brazilian Blowout') then array[v_room] else array[st.home] || v_spares end,
            v_start, v_end);
          if not pg_temp.staff_free(st.staff_id, d, cur, cur + svc.duration_minutes)
             or pg_temp.staff_clash(st.staff_id, v_start, svc.active_minutes, svc.processing_minutes, svc.finishing_minutes)
             or v_resource is null then
            cur := cur + 15;
            continue;
          end if;
          v_client := pg_temp.pick_client(st.staff_id, d, key);
          if v_client is null then
            cur := cur + 15;
            continue;
          end if;

          v_appointment := pg_temp.new_appointment(v_client, v_start, v_end, key);
          perform pg_temp.add_item(v_appointment, st.staff_id, svc.id, v_resource, v_start);

          -- A blow-dry or cut with another stylist straight after some color visits.
          if svc.category in ('Color', 'Highlights', 'Balayage') and pg_temp.rnd(key || ':follow') % 100 < 30 then
            select o.staff_id, sv.id as service_id, sv.duration_minutes, o.home into extra
            from (values
              ('d0000000-0000-4000-8000-000000000006'::uuid, 'f0000000-0000-4000-8000-000000000003'::uuid),
              ('d0000000-0000-4000-8000-000000000009'::uuid, 'f0000000-0000-4000-8000-000000000005'::uuid),
              ('d0000000-0000-4000-8000-000000000005'::uuid, 'f0000000-0000-4000-8000-000000000002'::uuid)
            ) as o (staff_id, home)
            join public.staff_services ss on ss.staff_id = o.staff_id
            join public.services sv on sv.id = ss.service_id and sv.name in ('Blowout', 'Blowout (Long/Thick Hair)', 'Women''s Cut & Style', 'Curls / Beach Waves')
            where pg_temp.staff_free(o.staff_id, d, cur + svc.duration_minutes, cur + svc.duration_minutes + sv.duration_minutes)
              and not pg_temp.staff_clash(o.staff_id, v_end, sv.active_minutes, sv.processing_minutes, sv.finishing_minutes)
              and pg_temp.pick_resource(array[o.home] || v_spares, v_end, v_end + make_interval(mins => sv.duration_minutes)) is not null
            order by pg_temp.rnd(key || o.staff_id || sv.id)
            limit 1;
            if found then
              perform pg_temp.add_item(
                v_appointment, extra.staff_id, extra.service_id,
                pg_temp.pick_resource(array[extra.home] || v_spares, v_end, v_end + make_interval(mins => extra.duration_minutes)),
                v_end);
            end if;
          end if;

          -- A short service for another client in some processing gaps.
          if svc.processing_minutes >= 30 and pg_temp.rnd(key || ':fill') % 100 < 50 then
            select sv.id, sv.duration_minutes into extra
            from public.staff_services ss
            join public.services sv on sv.id = ss.service_id
            where ss.staff_id = st.staff_id and sv.archived_at is null and sv.processing_minutes = 0
              and sv.duration_minutes <= svc.processing_minutes
              and pg_temp.pick_resource(v_spares, v_start + make_interval(mins => svc.active_minutes),
                                        v_start + make_interval(mins => svc.active_minutes + sv.duration_minutes)) is not null
            order by pg_temp.rnd(key || ':fill' || sv.id)
            limit 1;
            if found then
              v_client := pg_temp.pick_client(st.staff_id, d, key || ':fill');
              if v_client is not null then
                v_start := v_start + make_interval(mins => svc.active_minutes);
                perform pg_temp.add_item(
                  pg_temp.new_appointment(v_client, v_start, v_start + make_interval(mins => extra.duration_minutes), key || ':fill'),
                  st.staff_id, extra.id,
                  pg_temp.pick_resource(v_spares, v_start, v_start + make_interval(mins => extra.duration_minutes)),
                  v_start);
              end if;
            end if;
          end if;

          cur := cur + svc.duration_minutes;
        end loop;
      end loop;
    end loop;
  end loop;
end;
$$;

-- Statuses: past visits completed (a few no-shows), today's in progress or
-- done, upcoming ones booked or confirmed. Some, past and future, canceled.
-- (Set updated_at by hand to when each change happened, rather than the
-- reset time.)
alter table public.appointments disable trigger appointments_set_updated_at;

update public.appointments a
set status = x.status,
    canceled_at = case when x.status = 'canceled' then least(a.starts_at - interval '1 day', now()) end,
    cancel_reason = case when x.status = 'canceled'
      then (array['Client canceled', 'Client rescheduled', 'Client is sick', 'Stylist unavailable'])[pg_temp.rnd(a.id::text || ':why') % 4 + 1] end,
    -- The front desk checks clients in and out and marks no-shows; online
    -- bookings canceled online have no staff member.
    updated_by = case
      when x.status in ('checked_in', 'completed', 'no_show') then 'd0000000-0000-4000-8000-000000000003'::uuid
      when x.status = 'canceled' and a.source <> 'online' then 'd0000000-0000-4000-8000-000000000003'::uuid
      else a.created_by
    end,
    updated_at = case x.status
      when 'completed' then least(a.ends_at, now())
      when 'no_show' then least(a.starts_at + interval '20 minutes', now())
      when 'checked_in' then least(a.starts_at, now())
      when 'canceled' then least(a.starts_at - interval '1 day', now())
      else a.created_at
    end
from (
  select id, case
      when pg_temp.rnd(id::text || ':cancel') % 100 < 5 then 'canceled'
      when ends_at <= now() and pg_temp.rnd(id::text || ':noshow') % 100 < 4 then 'no_show'
      when ends_at <= now() then 'completed'
      when starts_at <= now() then 'checked_in'
      when pg_temp.rnd(id::text || ':confirm') % 100 < 60 then 'confirmed'
      else 'booked'
    end::public.appointment_status as status
  from public.appointments
  where business_id = 'b0000000-0000-4000-8000-000000000001'
) x
where a.id = x.id;

-- Canceled bookings made the day before can be after they were booked.
update public.appointments set updated_at = greatest(updated_at, created_at) where business_id = 'b0000000-0000-4000-8000-000000000001';

alter table public.appointments enable trigger appointments_set_updated_at;

-- Blocked time: lunches and a break that repeat, and a one-off training
-- session. Days where a seeded client is already booked over a repeating
-- block are skipped, so the calendar keeps to the rules.
insert into public.time_blocks (id, business_id, location_id, staff_id, kind, note, start_minute, end_minute, repeat_weekdays, starts_on, created_by)
select id::uuid, 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', staff::uuid, kind::public.time_block_kind,
       note, start_minute, end_minute, weekdays, (now() at time zone 'America/Chicago')::date - 35, 'd0000000-0000-4000-8000-000000000002'
from (values
  ('e2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000008', 'lunch', null, 750, 780, array[1, 2, 3, 4, 5]::smallint[]),
  ('e2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000007', 'lunch', null, 720, 750, array[2, 3, 5, 6]::smallint[]),
  ('e2000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000005', 'break', 'Coffee', 930, 945, array[3, 4, 5, 6]::smallint[])
) as b (id, staff, kind, note, start_minute, end_minute, weekdays);

insert into public.time_block_skips (block_id, business_id, on_date)
select b.id, b.business_id, d::date
from public.time_blocks b
cross join generate_series(b.starts_on, b.starts_on + 70, interval '1 day') d
where b.repeat_weekdays is not null
  and extract(isodow from d)::smallint = any (b.repeat_weekdays)
  and exists (
    select 1 from public.appointment_items i join public.appointments a on a.id = i.appointment_id
    where i.staff_id = b.staff_id and a.status not in ('canceled', 'no_show')
      and i.starts_at < (d::date + make_interval(mins => b.end_minute))::timestamp at time zone 'America/Chicago'
      and i.ends_at > (d::date + make_interval(mins => b.start_minute))::timestamp at time zone 'America/Chicago'
  );

-- Hannah's color class next Thursday morning, if she's free then.
insert into public.time_blocks (business_id, location_id, staff_id, kind, note, start_minute, end_minute, on_date, created_by)
select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006',
       'training', 'Wella color class', 720, 780, d, 'd0000000-0000-4000-8000-000000000002'
from (select (now() at time zone 'America/Chicago')::date + (11 - extract(isodow from (now() at time zone 'America/Chicago')::date))::int as d) x
where not exists (
  select 1 from public.appointment_items i join public.appointments a on a.id = i.appointment_id
  where i.staff_id = 'd0000000-0000-4000-8000-000000000006' and a.status not in ('canceled', 'no_show')
    and i.starts_at < (x.d + time '13:00')::timestamp at time zone 'America/Chicago'
    and i.ends_at > (x.d + time '12:00')::timestamp at time zone 'America/Chicago'
);

-- The waitlist: a few clients hoping for a spot in the next few weeks.
insert into public.waitlist_entries (business_id, location_id, client_id, service_ids, staff_ids, from_date, to_date, windows, notes, created_by, created_at)
select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', c.id,
       (select array_agg(s.id order by array_position(w.services, s.name)) from public.services s where s.business_id = 'b0000000-0000-4000-8000-000000000001' and s.name = any (w.services)),
       w.staff, current_date + w.from_days, current_date + w.to_days, w.windows, w.notes,
       'd0000000-0000-4000-8000-000000000003', now() - make_interval(days => w.waiting_days)
from (values
  (10, array['Women''s Cut & Style'], array['d0000000-0000-4000-8000-000000000005']::uuid[], 0, 14, array['afternoon'], 'Prefers Gil', 6),
  (20, array['Balayage'], '{}'::uuid[], 0, 21, '{}'::text[], null, 9),
  (30, array['Blowout'], '{}'::uuid[], 0, 7, array['morning'], 'Event on Saturday', 2),
  (40, array['Root Touch-Up', 'Blowout'], array['d0000000-0000-4000-8000-000000000004']::uuid[], 1, 14, '{}'::text[], null, 4),
  (50, array['Men''s Cut'], '{}'::uuid[], 0, 10, array['evening'], null, 1)
) as w(client_offset, services, staff, from_days, to_days, windows, notes, waiting_days)
cross join lateral (select id from public.clients where business_id = 'b0000000-0000-4000-8000-000000000001' order by id offset w.client_offset limit 1) c;
