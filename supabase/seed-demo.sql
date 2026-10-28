-- The busy demo data, added on top of supabase/seed.sql by
-- `npm run seed:demo` (which resets the database first): time off, 16
-- weeks of history and the next nine days of appointments with actual
-- times, retail sales, blocked time and a waitlist. The database and
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

-- Time-off requests (Scheduling → Requests): Hannah asks for the coming
-- Saturday, short notice with clients booked; Lois asks for a day in the
-- salon's holiday blackout; Bridget's was declined with a reason.
insert into public.time_off_blackouts (business_id, starts_on, ends_on, label)
select 'b0000000-0000-4000-8000-000000000001', d.next_monday + 33, d.next_monday + 39, 'Holiday week'
from (select (now() at time zone 'America/Chicago')::date
             + (8 - extract(isodow from (now() at time zone 'America/Chicago')::date))::int as next_monday) d;

with d as (
  select (now() at time zone 'America/Chicago')::date as today,
         (now() at time zone 'America/Chicago')::date
           + (8 - extract(isodow from (now() at time zone 'America/Chicago')::date))::int as next_monday
)
insert into public.staff_time_off (business_id, staff_id, starts_on, ends_on, reason, note, status, requested_by, short_notice, in_blackout, created_at)
select 'b0000000-0000-4000-8000-000000000001', t.staff_id::uuid, t.starts_on, t.starts_on, t.reason::public.time_off_reason, t.note, 'requested',
       t.staff_id::uuid, t.short_notice, t.in_blackout, now() - interval '1 day'
from d, lateral (values
  ('d0000000-0000-4000-8000-000000000006', d.today + ((6 - extract(isodow from d.today)::int + 7) % 7 + case when extract(isodow from d.today) = 6 then 7 else 0 end), 'personal', 'Cousin''s wedding', true, false),
  ('d0000000-0000-4000-8000-000000000010', d.next_monday + 36, 'vacation', 'Visiting family', false, true)
) as t (staff_id, starts_on, reason, note, short_notice, in_blackout);

update public.staff_time_off set short_notice = true
where staff_id = 'd0000000-0000-4000-8000-000000000009' and status = 'requested' and note = 'Sister''s graduation';
update public.staff_time_off set decline_reason = 'Saturday is fully booked. Could you take the Monday instead?'
where staff_id = 'd0000000-0000-4000-8000-000000000004' and status = 'declined' and note = 'Long weekend';

-- Nola covers a late Friday next week, 12:00 to 20:00 instead of 9 to 5.
insert into public.staff_schedule_overrides (business_id, staff_id, on_date, start_minute, end_minute)
select 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000007',
       (now() at time zone 'America/Chicago')::date
         + (8 - extract(isodow from (now() at time zone 'America/Chicago')::date))::int + 4,
       12 * 60, 20 * 60;

-- Lois works every other Saturday: a pattern over two weeks, this week
-- the one with Saturday. The visits below follow it (private.live_hours).
update public.staff
set hours_cycle_weeks = 2,
    hours_cycle_starts_on = (now() at time zone 'America/Chicago')::date - (extract(isodow from (now() at time zone 'America/Chicago')::date)::int - 1)
where id = 'd0000000-0000-4000-8000-000000000010';
insert into public.staff_working_hours (business_id, staff_id, cycle_week, weekday, start_minute, end_minute)
select business_id, staff_id, 1, weekday, start_minute, end_minute
from public.staff_working_hours
where staff_id = 'd0000000-0000-4000-8000-000000000010' and cycle_week = 0 and weekday <> 6;

-- ---------------------------------------------------------------------------
-- Appointments: 16 weeks back to nine days ahead, about 60% of the
-- stylists' bookable time (clients come on their own cycles).
-- Deterministic for a given reset date.
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
    and exists (
      select 1 from jsonb_array_elements(private.live_hours(p_staff, d)) h
      where (h ->> 'start')::int <= p_from and p_to <= (h ->> 'end')::int
    )
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
         sv.active_minutes, sv.processing_minutes, sv.finishing_minutes, private.stylist_price(p_staff, sv.id)
  from public.services sv
  join public.staff_services ss on ss.service_id = sv.id and ss.staff_id = p_staff
  where sv.id = p_service
$$;

-- Each client's habits, so there's something real to learn: how often
-- they come (every 3 to 7 weeks), the weekday and time of day they like,
-- and for about one in ten, visits drifting further apart (churning).
-- last_visit is kept up to date as visits are added.
create temp table rhythm as
select c.id, c.preferred_staff_id,
       21 + (pg_temp.rnd('cycle' || c.id) % 5) * 7 as cycle_days,
       2 + pg_temp.rnd('dow' || c.id) % 5 as weekday,
       pg_temp.rnd('ampm' || c.id) % 2 = 0 as mornings,
       pg_temp.rnd('drift' || c.id) % 100 < 10 as drifting,
       null::date as last_visit
from public.clients c
where c.business_id = 'b0000000-0000-4000-8000-000000000001';

-- The client most due for a visit, among the stylist's regulars (and
-- clients without a favorite): close to their usual gap since their last
-- visit, on their day and time of day, and not already in that day.
create function pg_temp.pick_client(p_staff uuid, d date, key text, p_minute int) returns uuid
language plpgsql as $$
declare
  v_client uuid;
begin
  select r.id into v_client
  from rhythm r
  where (r.preferred_staff_id = p_staff or r.preferred_staff_id is null)
    and r.last_visit is distinct from d
    -- Drifting clients' gaps grow by a week each visit.
    and (r.last_visit is null or d - r.last_visit >= (r.cycle_days * 0.6)::int + case when r.drifting then (d - (current_date - 112)) / 3 else 0 end)
  order by
    case when r.last_visit is null then 20 + pg_temp.rnd(key || r.id) % 60 else abs(d - r.last_visit - r.cycle_days) end
    + case when extract(isodow from d) = r.weekday then 0 else 25 end
    + case when (p_minute < 12 * 60) = r.mornings then 0 else 15 end
    + pg_temp.rnd(key || ':' || r.id) % 12
  limit 1;
  if v_client is not null then
    update rhythm set last_visit = d where id = v_client;
  end if;
  return v_client;
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
  for d in select generate_series(v_today - 112, v_today + 9, interval '1 day')::date loop
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
        select (h ->> 'start')::int as start_minute, (h ->> 'end')::int as end_minute
        from jsonb_array_elements(private.live_hours(st.staff_id, d)) h
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
          v_client := pg_temp.pick_client(st.staff_id, d, key, cur);
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
              v_client := pg_temp.pick_client(st.staff_id, d, key || ':fill', cur);
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

-- The moment Denise fixes (npm run screenshots, shot 02), planted rather
-- than left to chance: when the data loads during opening hours, a
-- colorist (Gil first) has a color client in the chair now, finishing in
-- 20 to 35 minutes, a client booked straight after and 20 minutes free
-- after that, so "running 20 minutes late" always has a fix to propose.
-- Anything already there is cleared. The color client is kept off
-- memberships and packages, so their checkout shows the whole ticket.
create temp table planted (client_id uuid, appointment_id uuid, status public.appointment_status);

do $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_minute int := (extract(epoch from (now() at time zone 'America/Chicago')::time) / 60)::int;
  v_chairs uuid[] := array(select r.id from public.resources r where r.location_id = 'c0000000-0000-4000-8000-000000000001' and r.kind = 'chair' order by r.id);
  c record;
  v_from int;
  v_mid int;
  v_to int;
  v_client uuid;
  v_next uuid;
  v_appointment uuid;
begin
  -- Each colorist's color services (the everyday ones first, longest first), then their shortest
  -- other service of half an hour or more (a blowout if they do one).
  for c in
    select ss.staff_id, color.id as color_id, color.duration_minutes as color_minutes, nxt.id as next_id, nxt.duration_minutes as next_minutes
    from public.staff_services ss
    join public.services color on color.id = ss.service_id and color.category = 'Color' and color.duration_minutes >= 45 and color.archived_at is null
    cross join lateral (
      select sv.id, sv.duration_minutes from public.staff_services o join public.services sv on sv.id = o.service_id
      where o.staff_id = ss.staff_id and sv.category <> 'Color' and sv.duration_minutes >= 30 and sv.archived_at is null
      order by sv.name not like 'Blowout%', sv.duration_minutes, sv.name limit 1
    ) nxt
    order by ss.staff_id <> 'd0000000-0000-4000-8000-000000000005', ss.staff_id, color.name not in ('All-Over Color', 'Root Touch-Up', 'Gray Blending'), color.duration_minutes desc
  loop
    -- Done 20 minutes from now, started on the quarter hour before that.
    v_from := (v_minute + 20 - c.color_minutes) / 15 * 15;
    v_mid := v_from + c.color_minutes;
    v_to := v_mid + c.next_minutes + 20;
    exit when v_from < v_minute and pg_temp.staff_free(c.staff_id, v_today, v_from, v_to);
    c := null;
  end loop;
  if c is null then
    raise notice 'No colorist free around now: the Denise fix moment is left out.';
    return;
  end if;

  delete from public.appointments a
  where a.id in (
    select i.appointment_id from public.appointment_items i
    where i.staff_id = c.staff_id
      and i.starts_at < pg_temp.at_local(v_today, v_to) and i.ends_at > pg_temp.at_local(v_today, v_from)
  );

  -- Two regulars with nothing else today, the first one theirs if possible.
  select r.id into v_client from rhythm r
  where not exists (select 1 from public.appointments a where a.client_id = r.id and (a.starts_at at time zone 'America/Chicago')::date = v_today)
  order by r.preferred_staff_id is distinct from c.staff_id, r.id limit 1;
  select r.id into v_next from rhythm r
  where r.id <> v_client and not exists (select 1 from public.appointments a where a.client_id = r.id and (a.starts_at at time zone 'America/Chicago')::date = v_today)
  order by r.id desc limit 1;

  v_appointment := pg_temp.new_appointment(v_client, pg_temp.at_local(v_today, v_from), pg_temp.at_local(v_today, v_mid), 'planted:color');
  perform pg_temp.add_item(v_appointment, c.staff_id, c.color_id, pg_temp.pick_resource(v_chairs, pg_temp.at_local(v_today, v_from), pg_temp.at_local(v_today, v_mid)), pg_temp.at_local(v_today, v_from));
  insert into planted values (v_client, v_appointment, 'checked_in');

  v_appointment := pg_temp.new_appointment(v_next, pg_temp.at_local(v_today, v_mid), pg_temp.at_local(v_today, v_mid + c.next_minutes), 'planted:next');
  perform pg_temp.add_item(v_appointment, c.staff_id, c.next_id,
    pg_temp.pick_resource(v_chairs, pg_temp.at_local(v_today, v_mid), pg_temp.at_local(v_today, v_mid + c.next_minutes)), pg_temp.at_local(v_today, v_mid));
  insert into planted values (v_next, v_appointment, 'confirmed');
end;
$$;

-- Statuses: past visits completed (a few no-shows), today's in progress or
-- done, upcoming ones booked or confirmed. Some, past and future, canceled.
-- (Set updated_at by hand to when each change happened, rather than the
-- reset time.)
alter table public.appointments disable trigger appointments_set_updated_at;
-- (The history's late cancellations and no-shows get their fees below, as
-- the policy would have charged them.)
alter table public.appointments disable trigger appointments_policy_fee;

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
  -- A few clients cancel or miss appointments much more than most.
  select id, case
      when pg_temp.rnd(id::text || ':cancel') % 100 < case when pg_temp.rnd('cx' || client_id) % 100 < 8 then 20 else 4 end then 'canceled'
      when ends_at <= now() and pg_temp.rnd(id::text || ':noshow') % 100 < case when pg_temp.rnd('ns' || client_id) % 100 < 6 then 30 else 2 end then 'no_show'
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

-- The planted moment keeps its statuses (none canceled by chance).
update public.appointments a set status = p.status, canceled_at = null, cancel_reason = null,
  updated_by = case when p.status = 'checked_in' then 'd0000000-0000-4000-8000-000000000003'::uuid else a.created_by end,
  updated_at = case when p.status = 'checked_in' then least(a.starts_at, now()) else a.created_at end
from planted p where a.id = p.appointment_id;

-- ---------------------------------------------------------------------------
-- Actual times for visits that have happened (and today's so far), so
-- Denise has something to learn from: check-in and checkout for every
-- visit, and the services' own taps from the stylists who tap. Each
-- stylist has their own pace on some services (pg_temp.pace), with
-- day-to-day noise and the odd visit that runs long. A few clients are
-- usually late.
-- ---------------------------------------------------------------------------

-- How long a stylist takes compared with the menu: Bridget runs long on
-- lightening, Gil on color, Shae is quick on short cuts but slow on
-- blowouts and getting faster on women's cuts, Nola is brisk, Hannah runs
-- long on styling, Lois on smoothing treatments. days_ago is how long ago
-- the visit was (for Shae's improvement).
create function pg_temp.pace(p_staff uuid, p_category text, p_name text, days_ago int) returns numeric
language sql immutable as $$
  select case
    when p_staff = 'd0000000-0000-4000-8000-000000000004' and p_category in ('Balayage', 'Highlights') then 1.18
    when p_staff = 'd0000000-0000-4000-8000-000000000005' and p_category = 'Color' then 1.15
    when p_staff = 'd0000000-0000-4000-8000-000000000009' and p_name in ('Men''s Cut', 'Kids'' Cut (12 & under)') then 0.8
    when p_staff = 'd0000000-0000-4000-8000-000000000009' and p_name like 'Blowout%' then 1.2
    when p_staff = 'd0000000-0000-4000-8000-000000000009' and p_name = 'Women''s Cut & Style' then 0.95 + least(days_ago, 112) / 112.0 * 0.3
    when p_staff = 'd0000000-0000-4000-8000-000000000007' then 0.88
    when p_staff = 'd0000000-0000-4000-8000-000000000006' and p_category = 'Blowouts & Styling' then 1.15
    when p_staff = 'd0000000-0000-4000-8000-000000000010' and p_name in ('Keratin Smoothing', 'Brazilian Blowout') then 1.12
    else 1.0
  end
$$;

-- Minutes after the booked start the client arrives: a few clients are
-- usually 10 to 20 minutes late; most are on time.
create function pg_temp.arrival(p_client uuid, p_appointment uuid) returns int
language sql immutable as $$
  select case
    when pg_temp.rnd('late' || p_client) % 100 < 12 and pg_temp.rnd('l' || p_appointment) % 100 < 75 then 10 + pg_temp.rnd('lm' || p_appointment) % 11
    else pg_temp.rnd('lm' || p_appointment) % 4
  end
$$;

with timed as (
  select i.id, i.appointment_id, i.starts_at, i.active_minutes, i.processing_minutes, i.finishing_minutes,
         a.status,
         i.starts_at + make_interval(mins => pg_temp.arrival(a.client_id, a.id)) as started,
         -- Pace, noise of about 8% either way, and one visit in 25 running half again as long.
         pg_temp.pace(i.staff_id, sv.category, sv.name, (current_date - (i.starts_at at time zone 'America/Chicago')::date))
           * (0.92 + (pg_temp.rnd(i.id || ':n') % 17) / 100.0)
           * case when pg_temp.rnd(i.id || ':o') % 25 = 0 then 1.5 else 1 end as factor
  from public.appointment_items i
  join public.appointments a on a.id = i.appointment_id
  join public.services sv on sv.id = i.service_id
  where a.business_id = 'b0000000-0000-4000-8000-000000000001' and a.status in ('completed', 'checked_in')
),
times as (
  select t.*,
         t.started + make_interval(mins => round(t.active_minutes * t.factor)::int) as proc_start,
         t.started + make_interval(mins => round(t.active_minutes * t.factor)::int + t.processing_minutes + (pg_temp.rnd(t.id || ':p') % 7) - 2) as proc_end,
         t.started + make_interval(mins => greatest(
           round((t.active_minutes + t.processing_minutes + t.finishing_minutes) * t.factor)::int,
           -- After processing, at least a few minutes at the chair (rinse).
           case when t.processing_minutes > 0 then round(t.active_minutes * t.factor)::int + t.processing_minutes + 5 + round(t.finishing_minutes * t.factor * 0.5)::int else 0 end)) as finished
  from timed t
)
update public.appointment_items i set
  started_at = case when x.started <= now() then x.started end,
  processing_started_at = case when x.processing_minutes > 0 and x.proc_start <= now() then x.proc_start end,
  processing_ended_at = case when x.processing_minutes > 0 and x.proc_end <= now() then x.proc_end end,
  -- A completed visit is done by now, even one that ran long.
  finished_at = case when x.status = 'completed' then least(x.finished, now() - interval '5 minutes') when x.finished <= now() then x.finished end
from times x
where i.id = x.id;

-- Checked in when they arrived, out a few minutes after the last service.
update public.appointments a set
  checked_in_at = least(x.first_start - interval '1 minute', now()),
  checked_out_at = case when a.status = 'completed' then least(x.last_finish + make_interval(mins => 3 + pg_temp.rnd(a.id || ':out') % 8), now()) end
from (
  select appointment_id, min(started_at) as first_start, max(finished_at) as last_finish
  from public.appointment_items group by appointment_id
) x
where x.appointment_id = a.id and a.status in ('completed', 'checked_in') and x.first_start is not null;

-- Tapping times on My day is optional. Bridget, Gil and Shae tap (all but
-- about one visit in ten); Hannah, Nola, Sandra and Lois never do, so
-- Denise learns their times from check-in to checkout instead.
update public.appointment_items i set started_at = null, processing_started_at = null, processing_ended_at = null, finished_at = null
where i.business_id = 'b0000000-0000-4000-8000-000000000001'
  and (i.staff_id not in ('d0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000009')
       or pg_temp.rnd(i.id || ':tap') % 10 = 0);

-- Retail sales at checkout: some clients often buy a product, most rarely.
-- A delivery at the start of the history covers them, so stock stays right.
select private.move_stock('c0000000-0000-4000-8000-000000000001', p.id, 40, 'order_received', 'Opening delivery')
from public.products p
where p.business_id = 'b0000000-0000-4000-8000-000000000001' and p.type = 'retail';
update public.stock_movements set created_at = now() - interval '113 days', created_by = 'd0000000-0000-4000-8000-000000000002'
where reason = 'order_received' and note = 'Opening delivery';

with retail as (
  select array_agg(id order by sku) as ids from public.products
  where business_id = 'b0000000-0000-4000-8000-000000000001' and type = 'retail'
),
buyers as (
  select a.id, a.checked_out_at,
         (select ids[1 + pg_temp.rnd('prod' || a.client_id || a.id) % array_length(ids, 1)] from retail) as product_id
  from public.appointments a
  where a.business_id = 'b0000000-0000-4000-8000-000000000001' and a.status = 'completed'
    and pg_temp.rnd('buy' || a.id) % 100 < case when pg_temp.rnd('retail' || a.client_id) % 100 < 20 then 60 else 5 end
  order by a.checked_out_at
)
select private.move_stock('c0000000-0000-4000-8000-000000000001', b.product_id, -1, 'sale', null, b.id)
from buyers b;
update public.stock_movements m set created_at = a.checked_out_at, created_by = 'd0000000-0000-4000-8000-000000000003'
from public.appointments a
where m.reason = 'sale' and m.appointment_id = a.id;

-- Checkout: retail is taxed (Chicago's 10.25%), services aren't. Every
-- checked-out visit gets its sale: the services at their booked prices,
-- the retail bought then, tips for about 60% of visits, and card or cash.
update public.businesses set tax_rate_retail_bp = 1025, receipt_footer = 'Thank you for visiting Maple & Ash. Book your next visit online anytime.'
where id = 'b0000000-0000-4000-8000-000000000001';

create temp table seed_sales as
select gen_random_uuid() as sale_id, a.id as appointment_id, a.client_id, a.checked_out_at as at,
       (1000 + row_number() over (order by a.checked_out_at, a.id))::int as number
from public.appointments a
where a.business_id = 'b0000000-0000-4000-8000-000000000001' and a.status = 'completed';

insert into public.sales (id, business_id, location_id, number, client_id, appointment_id, subtotal_cents, total_cents, created_by, created_at)
select sale_id, 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', number, client_id, appointment_id, 0, 0,
       'd0000000-0000-4000-8000-000000000003', at
from seed_sales;

insert into public.sale_items (sale_id, business_id, position, kind, service_id, appointment_item_id, staff_id, description, quantity, unit_price_cents, tax_cents, total_cents)
select s.sale_id, 'b0000000-0000-4000-8000-000000000001', row_number() over (partition by s.sale_id order by i.starts_at), 'service',
       i.service_id, i.id, i.staff_id, sv.name, 1, i.price_cents, 0, i.price_cents
from seed_sales s
join public.appointment_items i on i.appointment_id = s.appointment_id
join public.services sv on sv.id = i.service_id;

-- Retail is credited to the visit's (first) stylist, who recommended it.
insert into public.sale_items (sale_id, business_id, position, kind, product_id, staff_id, description, quantity, unit_price_cents, tax_cents, total_cents)
select s.sale_id, 'b0000000-0000-4000-8000-000000000001', 50 + row_number() over (partition by s.sale_id order by m.created_at, m.id), 'product',
       p.id, (select i.staff_id from public.appointment_items i where i.appointment_id = s.appointment_id order by i.starts_at limit 1),
       concat_ws(' ', p.brand, p.line, p.name), (-m.change)::int, p.price_cents,
       round(p.price_cents * (-m.change) * 1025 / 10000.0)::int,
       (p.price_cents * (-m.change))::int + round(p.price_cents * (-m.change) * 1025 / 10000.0)::int
from seed_sales s
join public.stock_movements m on m.appointment_id = s.appointment_id and m.reason = 'sale'
join public.products p on p.id = m.product_id;


-- Promotions used over the history, as checkout applied them: the
-- last-minute special (15%) on the service lines of visits booked within 48
-- hours of starting, in the last 60 days, never Master stylists' color;
-- Welcome 15 on new clients' first visits since it started; and $10 off
-- retail on sales of $60 or more that had neither (those two don't go with
-- other promotions). Each line keeps its discount and its tax on what's
-- left, as complete_sale works them out; every use is recorded.
create temp table seed_redemptions (sale_id uuid, promotion_id uuid, source text, discount_cents int, last_minute boolean);

with special as (select id, name from public.promotions where business_id = 'b0000000-0000-4000-8000-000000000001' and name = 'Last-minute 15%'),
covered as (
  select si.id, s.sale_id
  from seed_sales s
  join public.appointments a on a.id = s.appointment_id
  join public.sale_items si on si.sale_id = s.sale_id and si.kind = 'service'
  join public.services sv on sv.id = si.service_id
  join public.staff st on st.id = si.staff_id
  where a.starts_at - a.created_at <= interval '48 hours' and s.at > now() - interval '60 days'
    and not (st.level = 'master' and sv.category = 'Color')
),
discounted as (
  update public.sale_items si set promo_discount_cents = round(si.unit_price_cents * si.quantity * 0.15)::int,
    line_discount_cents = round(si.unit_price_cents * si.quantity * 0.15)::int, line_discount_reason = sp.name,
    total_cents = si.unit_price_cents * si.quantity - round(si.unit_price_cents * si.quantity * 0.15)::int
  from covered c, special sp
  where si.id = c.id
  returning si.sale_id, si.promo_discount_cents, sp.id as promotion_id
)
insert into seed_redemptions
select sale_id, promotion_id, 'special', sum(promo_discount_cents)::int, true from discounted group by sale_id, promotion_id;

-- New clients: their first visit was in the last three months, and they
-- were added when they first booked.
with welcome as (select id, name, starts_on from public.promotions where business_id = 'b0000000-0000-4000-8000-000000000001' and code = 'WELCOME15'),
firsts as (
  select s.sale_id, a.client_id, a.created_at as booked_at
  from seed_sales s
  join public.appointments a on a.id = s.appointment_id
  cross join welcome w
  where a.starts_at > now() - interval '90 days' and a.created_at::date >= w.starts_on
    and not exists (select 1 from public.appointments p where p.client_id = a.client_id and p.starts_at < a.starts_at and p.status <> 'canceled')
    and not exists (select 1 from public.client_formulas f where f.client_id = a.client_id)
    and not exists (select 1 from seed_redemptions r where r.sale_id = s.sale_id)
    and pg_temp.rnd('welcome' || a.client_id) % 100 < 60
),
added as (
  update public.clients c set created_at = f.booked_at - interval '5 minutes' from firsts f where c.id = f.client_id returning c.id
),
discounted as (
  update public.sale_items si set promo_discount_cents = round(si.unit_price_cents * si.quantity * 0.15)::int,
    line_discount_cents = round(si.unit_price_cents * si.quantity * 0.15)::int, line_discount_reason = w.name,
    total_cents = si.unit_price_cents * si.quantity - round(si.unit_price_cents * si.quantity * 0.15)::int
  from firsts f, welcome w
  where si.sale_id = f.sale_id and si.kind = 'service'
  returning si.sale_id, si.promo_discount_cents, w.id as promotion_id
)
insert into seed_redemptions
select sale_id, promotion_id, 'code', sum(promo_discount_cents)::int, false from discounted group by sale_id, promotion_id;

with retail_promo as (select id, name from public.promotions where business_id = 'b0000000-0000-4000-8000-000000000001' and name = 'Retail $10 off $60'),
lines as (
  select distinct on (si.sale_id) si.id, si.sale_id, least(1000, si.unit_price_cents * si.quantity) as off
  from public.sale_items si
  join seed_sales s on s.sale_id = si.sale_id
  where si.kind = 'product'
    and (select sum(x.unit_price_cents * x.quantity) from public.sale_items x where x.sale_id = si.sale_id) >= 6000
    and not exists (select 1 from seed_redemptions r where r.sale_id = si.sale_id)
  order by si.sale_id, si.position
),
discounted as (
  update public.sale_items si set promo_discount_cents = l.off, line_discount_cents = l.off, line_discount_reason = rp.name,
    tax_cents = round((si.unit_price_cents * si.quantity - l.off) * 1025 / 10000.0)::int,
    total_cents = si.unit_price_cents * si.quantity - l.off + round((si.unit_price_cents * si.quantity - l.off) * 1025 / 10000.0)::int
  from lines l, retail_promo rp
  where si.id = l.id
  returning si.sale_id, si.promo_discount_cents, rp.id as promotion_id
)
insert into seed_redemptions
select sale_id, promotion_id, 'automatic', promo_discount_cents, false from discounted;

insert into public.promotion_redemptions (business_id, promotion_id, sale_id, appointment_id, client_id, source, discount_cents, first_visit, last_minute, applied_by, created_at)
select 'b0000000-0000-4000-8000-000000000001', r.promotion_id, r.sale_id, s.appointment_id, s.client_id, r.source, r.discount_cents,
       not exists (select 1 from public.appointments p join public.appointments a on a.id = s.appointment_id
                   where p.client_id = s.client_id and p.starts_at < a.starts_at and p.status = 'completed'),
       r.last_minute, 'd0000000-0000-4000-8000-000000000003', s.at
from seed_redemptions r join seed_sales s on s.sale_id = r.sale_id;

-- Rebooked at checkout: most visits whose client already has their next
-- one within ten weeks (some stylists rebook more than others).
update public.sales x set rebook_appointment_id = n.id
from seed_sales s
cross join lateral (
  select a2.id from public.appointments a2
  join public.appointments a1 on a1.id = s.appointment_id
  where a2.client_id = s.client_id and a2.starts_at > a1.starts_at and a2.starts_at < a1.starts_at + interval '70 days'
    and a2.status <> 'canceled'
  order by a2.starts_at limit 1
) n
where x.id = s.sale_id
  and abs(hashtext(s.sale_id::text)) % 100 < 45 + 5 * (abs(hashtext((select i.staff_id::text from public.appointment_items i where i.appointment_id = s.appointment_id order by i.starts_at limit 1))) % 8);

update public.stock_movements m set note = 'Sale #' || s.number
from seed_sales s where m.appointment_id = s.appointment_id and m.reason = 'sale';

-- Tips: 15-20% of the services, to the nearest dollar, for the first stylist.
insert into public.sale_tips (sale_id, business_id, staff_id, amount_cents)
select s.sale_id, 'b0000000-0000-4000-8000-000000000001', x.staff_id, x.tip
from seed_sales s
cross join lateral (
  select (select i.staff_id from public.appointment_items i where i.appointment_id = s.appointment_id order by i.starts_at limit 1) as staff_id,
         (round((select sum(i.price_cents) from public.appointment_items i where i.appointment_id = s.appointment_id) * (15 + pg_temp.rnd('tip%' || s.sale_id) % 6) / 10000.0) * 100)::int as tip
) x
where pg_temp.rnd('tip' || s.appointment_id) % 100 < 60 and x.tip > 0;

update public.sales v set
  subtotal_cents = t.subtotal, discount_cents = t.discount, tax_cents = t.tax, tip_cents = t.tips, total_cents = t.subtotal - t.discount + t.tax + t.tips
from (
  select s.sale_id,
         coalesce((select sum(unit_price_cents * quantity) from public.sale_items where sale_id = s.sale_id), 0)::int as subtotal,
         coalesce((select sum(line_discount_cents) from public.sale_items where sale_id = s.sale_id), 0)::int as discount,
         coalesce((select sum(tax_cents) from public.sale_items where sale_id = s.sale_id), 0)::int as tax,
         coalesce((select sum(amount_cents) from public.sale_tips where sale_id = s.sale_id), 0)::int as tips
  from seed_sales s
) t
where v.id = t.sale_id;

-- About one in five pays cash (handing over the next $10 up); the rest card.
insert into public.payments (sale_id, business_id, location_id, method, amount_cents, tendered_cents, change_cents, reference, created_by, created_at)
select v.id, v.business_id, v.location_id,
       case when pg_temp.rnd('cash' || v.id) % 100 < 20 then 'cash' else 'card' end::public.payment_method,
       v.total_cents,
       case when pg_temp.rnd('cash' || v.id) % 100 < 20 then (ceil(v.total_cents / 1000.0) * 1000)::int end,
       case when pg_temp.rnd('cash' || v.id) % 100 < 20 then (ceil(v.total_cents / 1000.0) * 1000)::int - v.total_cents end,
       case when pg_temp.rnd('cash' || v.id) % 100 >= 20 then lpad((pg_temp.rnd('last4' || v.id) % 10000)::text, 4, '0') end,
       v.created_by, v.created_at
from public.sales v
where v.business_id = 'b0000000-0000-4000-8000-000000000001' and v.total_cents > 0;

insert into public.sale_events (sale_id, business_id, kind, amount_cents, staff_id, created_at)
select id, business_id, 'completed', total_cents, created_by, created_at
from public.sales where business_id = 'b0000000-0000-4000-8000-000000000001';

update public.businesses set next_sale_number = (select coalesce(max(number), 1000) + 1 from public.sales where business_id = 'b0000000-0000-4000-8000-000000000001')
where id = 'b0000000-0000-4000-8000-000000000001';

-- Packages on offer, and clients who bought them (some coming in today,
-- so the brief has credit to mention), partly used.
insert into public.package_templates (id, business_id, name, price_cents, expiry_months, levels)
values
  ('e3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '5 Blowouts', 20000, 12, null),
  ('e3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Gloss & Treatment Trio', 33000, 12, null),
  ('e3000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Master Blowouts', 30000, 6, array['master']::public.staff_level[]);
insert into public.package_template_items (template_id, business_id, service_id, quantity)
select t.id::uuid, 'b0000000-0000-4000-8000-000000000001', s.id, t.quantity
from (values
  ('e3000000-0000-4000-8000-000000000001', 'Blowout', 5),
  ('e3000000-0000-4000-8000-000000000002', 'Gloss / Toner', 3),
  ('e3000000-0000-4000-8000-000000000002', 'Deep Conditioning', 3),
  ('e3000000-0000-4000-8000-000000000003', 'Blowout', 5)
) as t (id, service, quantity)
join public.services s on s.business_id = 'b0000000-0000-4000-8000-000000000001' and s.name = t.service;

-- Four of today's clients and eight others.
create temp table seed_package_clients as
(select distinct a.client_id from public.appointments a
 where a.business_id = 'b0000000-0000-4000-8000-000000000001' and a.client_id is not null
   and (a.starts_at at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date
   and a.status in ('booked', 'confirmed', 'checked_in')
   and a.client_id not in (select client_id from planted)
 order by a.client_id limit 4)
union
(select id from (select id from public.clients where business_id = 'b0000000-0000-4000-8000-000000000001' order by id offset 100 limit 8) x
 where id not in (select client_id from planted));

select private.sell_package(
  case when pg_temp.rnd('pkg' || client_id) % 3 = 0 then 'e3000000-0000-4000-8000-000000000002'::uuid else 'e3000000-0000-4000-8000-000000000001'::uuid end,
  client_id, null, case when pg_temp.rnd('pkg' || client_id) % 3 = 0 then 33000 else 20000 end)
from seed_package_clients;
update public.client_packages set created_by = 'd0000000-0000-4000-8000-000000000003', created_at = now() - make_interval(days => 20 + pg_temp.rnd('pkgday' || id) % 60)
where business_id = 'b0000000-0000-4000-8000-000000000001';
update public.client_package_items set used = pg_temp.rnd('used' || id) % total
where business_id = 'b0000000-0000-4000-8000-000000000001';

-- Memberships: a Blowout Club and a Color Club, with members who joined
-- over the last few months (three of them coming in today), a few who
-- left, one paused and one whose last payment failed. Their history is
-- charges and events only (no renewal sales in the demo history).
insert into public.membership_plans (id, business_id, name, description, price_cents, interval_unit, interval_count, service_discount_pct, retail_discount_pct, min_term_periods, cancel_notice_days, allow_pause, max_pause_periods)
values
  ('e4000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Blowout Club', 'Two blowouts a month and member prices on retail.', 8900, 'month', 1, 0, 10, 0, 0, true, 2),
  ('e4000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Color Club', 'A root touch-up every month, member prices on everything.', 14900, 'month', 1, 10, 15, 3, 14, true, 1);
insert into public.membership_plan_services (plan_id, business_id, service_id, quantity, rollover)
select p.id::uuid, 'b0000000-0000-4000-8000-000000000001', s.id, p.quantity, p.rollover
from (values
  ('e4000000-0000-4000-8000-000000000001', 'Blowout', 2, false),
  ('e4000000-0000-4000-8000-000000000002', 'Root Touch-Up', 1, true)
) as p (id, service, quantity, rollover)
join public.services s on s.business_id = 'b0000000-0000-4000-8000-000000000001' and s.name = p.service;

create temp table seed_members as
select row_number() over (order by c.id) as n, c.id as client_id
from (
  (select distinct a.client_id as id from public.appointments a
   where a.business_id = 'b0000000-0000-4000-8000-000000000001' and a.client_id is not null
     and (a.starts_at at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date
     and a.status not in ('canceled', 'no_show')
     and a.client_id not in (select client_id from seed_package_clients)
     and a.client_id not in (select client_id from planted)
   order by a.client_id offset 8 limit 3)
  union
  (select id from (select id from public.clients where business_id = 'b0000000-0000-4000-8000-000000000001' order by id offset 300 limit 31) x
   where id not in (select client_id from planted))
) c;

insert into public.client_memberships (business_id, location_id, client_id, plan_id, name, price_cents, interval_unit, interval_count, service_discount_pct, retail_discount_pct,
  min_term_periods, cancel_notice_days, allow_pause, max_pause_periods, started_on, anchor_on, periods_paid, current_period_start, current_period_end, provider, payment_method_ref, card_label, created_by, created_at)
select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', m.client_id, p.id, p.name, p.price_cents, p.interval_unit, p.interval_count,
       p.service_discount_pct, p.retail_discount_pct, p.min_term_periods, p.cancel_notice_days, p.allow_pause, p.max_pause_periods,
       x.started, x.started, x.months + 1, (x.started + make_interval(months => x.months))::date, (x.started + make_interval(months => x.months + 1))::date,
       'test', 'test_visa_4242', 'Visa …4242', 'd0000000-0000-4000-8000-000000000003', x.started::timestamp at time zone 'America/Chicago' + interval '11 hours'
from seed_members m
join public.membership_plans p on p.id = case when m.n % 3 = 0 then 'e4000000-0000-4000-8000-000000000002'::uuid else 'e4000000-0000-4000-8000-000000000001'::uuid end
cross join lateral (select (now() at time zone 'America/Chicago')::date - (12 + pg_temp.rnd('joined' || m.client_id) % 120) as started) s
cross join lateral (select s.started, (extract(year from age((now() at time zone 'America/Chicago')::date, s.started)) * 12 + extract(month from age((now() at time zone 'America/Chicago')::date, s.started)))::int as months) x;

-- What they've paid, and what's included this month (some used already).
insert into public.membership_charges (business_id, membership_id, period_start, amount_cents, status, attempt, provider, provider_reference, created_at)
select m.business_id, m.id, (m.anchor_on + make_interval(months => k))::date, m.price_cents, 'succeeded', 1,
       case when k = 0 then 'checkout' else 'test' end, case when k > 0 then 'test_ch_seed_' || left(md5(m.id || ':' || k), 16) end,
       (m.anchor_on + make_interval(months => k))::timestamp at time zone 'America/Chicago' + interval '11 hours'
from public.client_memberships m cross join generate_series(0, m.periods_paid - 1) k
where m.business_id = 'b0000000-0000-4000-8000-000000000001';
insert into public.membership_events (business_id, membership_id, kind, staff_id, created_at)
select business_id, membership_id, case when provider = 'checkout' then 'started' else 'renewed' end,
       case when provider = 'checkout' then 'd0000000-0000-4000-8000-000000000003'::uuid end, created_at
from public.membership_charges where business_id = 'b0000000-0000-4000-8000-000000000001';
select private.grant_membership_credits(id) from public.client_memberships where business_id = 'b0000000-0000-4000-8000-000000000001';
update public.membership_credits c set used = least(c.allowance, pg_temp.rnd('mused' || c.id) % (c.allowance + 1))
from seed_members s, public.client_memberships m
where c.membership_id = m.id and m.client_id = s.client_id and s.n > 3;

-- Four who left (two this month), one paused, one whose payment failed
-- yesterday on a card that's declined.
update public.client_memberships m set status = 'canceled', cancel_reason = (array['Moving away', 'Too busy to come in', 'Cost', 'Switching to a package'])[1 + s.n % 4],
  cancels_on = (now() at time zone 'America/Chicago')::date - (2 + 9 * (s.n % 5))::int, canceled_at = now() - make_interval(days => (2 + 9 * (s.n % 5))::int)
from seed_members s where m.client_id = s.client_id and s.n in (5, 13, 21, 29);
insert into public.membership_events (business_id, membership_id, kind, detail, created_at)
select business_id, id, 'canceled', cancel_reason, canceled_at from public.client_memberships
where business_id = 'b0000000-0000-4000-8000-000000000001' and status = 'canceled';
update public.client_memberships m set status = 'paused', pause_from = (now() at time zone 'America/Chicago')::date - 6, resume_on = (now() at time zone 'America/Chicago')::date + 24
from seed_members s where m.client_id = s.client_id and s.n = 8;
update public.client_memberships m set status = 'past_due', failed_attempts = 1, next_retry_at = now() + interval '1 day',
  periods_paid = periods_paid - 1, current_period_start = (current_period_start - interval '1 month')::date,
  current_period_end = (now() at time zone 'America/Chicago')::date - 1,
  payment_method_ref = 'test_visa_0002', card_label = 'Visa …0002'
from seed_members s where m.client_id = s.client_id and s.n = 10;
insert into public.membership_charges (business_id, membership_id, period_start, amount_cents, status, attempt, provider, failure_reason, created_at)
select business_id, id, current_period_end, price_cents, 'failed', 1, 'test', 'The card was declined', now() - interval '20 hours'
from public.client_memberships where business_id = 'b0000000-0000-4000-8000-000000000001' and status = 'past_due';
insert into public.membership_events (business_id, membership_id, kind, detail, created_at)
select business_id, id, 'payment_failed', 'The card was declined', now() - interval '20 hours'
from public.client_memberships where business_id = 'b0000000-0000-4000-8000-000000000001' and status = 'past_due';

-- Birthdays for most clients (three of them today, and some who said yes
-- to texts or emails), and the salon's review pages, for automations.
update public.clients set birth_month = 1 + pg_temp.rnd('bm' || id) % 12, birth_day = 1 + pg_temp.rnd('bd' || id) % 28
where business_id = 'b0000000-0000-4000-8000-000000000001' and pg_temp.rnd('bday' || id) % 5 < 3;
update public.clients set birth_month = extract(month from (now() at time zone 'America/Chicago'))::smallint, birth_day = extract(day from (now() at time zone 'America/Chicago'))::smallint
where id in (select id from public.clients where business_id = 'b0000000-0000-4000-8000-000000000001' and (sms_opt_in or email_opt_in) order by id offset 40 limit 3);
update public.businesses set google_review_url = 'https://g.page/r/maple-and-ash-demo/review', yelp_url = 'https://www.yelp.com/biz/maple-and-ash-hair-studio-demo'
where id = 'b0000000-0000-4000-8000-000000000001';

-- Where the online bookings came from (the tag on the link they followed).
update public.appointments set online_source = (array['google', 'google', 'google', 'google', 'instagram', 'instagram', 'instagram', 'facebook', 'website', 'direct', 'direct', 'rebook'])[1 + pg_temp.rnd('src' || id) % 12]
where business_id = 'b0000000-0000-4000-8000-000000000001' and source = 'online';

-- Gift cards: bought ones with what's left on them, a few promotional and
-- one expired; some belong to today's clients.
create temp table seed_cards as
select row_number() over (order by c.id) as n, c.id as client_id
from (
  (select distinct a.client_id as id from public.appointments a
   where a.business_id = 'b0000000-0000-4000-8000-000000000001' and a.client_id is not null
     and (a.starts_at at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date
     and a.status in ('booked', 'confirmed', 'checked_in')
   order by a.client_id offset 4 limit 3)
  union
  (select id from public.clients where business_id = 'b0000000-0000-4000-8000-000000000001' order by id offset 200 limit 22)
) c;

insert into public.gift_cards (business_id, code, kind, initial_cents, balance_cents, expires_at, client_id, physical, note, created_by, created_at)
select 'b0000000-0000-4000-8000-000000000001', private.new_gift_code('b0000000-0000-4000-8000-000000000001'),
       case when n % 8 = 0 then 'promotional' else 'purchased' end::public.gift_card_kind,
       (array[2500, 5000, 10000, 15000])[1 + pg_temp.rnd('gcamt' || client_id) % 4], 0,
       case when n % 8 = 0 then now() + interval '60 days' when n = 5 then now() - interval '10 days' end,
       client_id, n % 2 = 0, case when n % 8 = 0 then 'Referral reward' end,
       'd0000000-0000-4000-8000-000000000003', now() - make_interval(days => 5 + pg_temp.rnd('gcday' || client_id) % 90)
from seed_cards;

select private.move_gift_card(g, case when g.kind = 'promotional' then 'issued' else 'sold' end, g.initial_cents, null, g.note)
from public.gift_cards g where g.business_id = 'b0000000-0000-4000-8000-000000000001';
select private.move_gift_card(g, 'redeemed', -((g.initial_cents * (pg_temp.rnd('spent' || g.id) % 3)) / 4), null, null)
from public.gift_cards g where g.business_id = 'b0000000-0000-4000-8000-000000000001' and pg_temp.rnd('spent' || g.id) % 3 > 0;
update public.gift_card_events e set created_at = g.created_at + case when e.kind = 'redeemed' then interval '3 days' else interval '0' end, staff_id = 'd0000000-0000-4000-8000-000000000003'
from public.gift_cards g where e.card_id = g.id;

alter table public.appointments enable trigger appointments_set_updated_at;
alter table public.appointments enable trigger appointments_policy_fee;

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

-- The cancellation policy: a card for new clients, 48 hours' notice, $40
-- to cancel late, half the visit for a no-show, and repeat offenders (2 in
-- 6 months) pay a 50% deposit. Gil is stricter: 72 hours, and $80 for a
-- no-show.
insert into public.policy_settings (business_id, card_required, cancel_window_hours, late_cancel_fee_kind, late_cancel_fee_amount, no_show_fee_kind, no_show_fee_amount,
  repeat_count, repeat_months, repeat_action, repeat_deposit_percent, updated_by)
values ('b0000000-0000-4000-8000-000000000001', 'new_clients', 48, 'fixed', 4000, 'percent', 50, 2, 6, 'deposit', 50, 'd0000000-0000-4000-8000-000000000001');
insert into public.staff_policies (staff_id, business_id, cancel_window_hours, no_show_fee_kind, no_show_fee_amount)
values ('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 72, 'fixed', 8000);

-- Cards on file: about two clients in three who've been in, each with the
-- policy they agreed to (online, or by a link from the desk). A few cards
-- get declined.
with agreed as (
  insert into public.policy_consents (business_id, client_id, policy_text, terms, channel, agreed_at)
  select c.business_id, c.id,
    E'Please give Maple & Ash Hair Studio at least 2 days'' notice if you need to cancel.\nCanceling with less notice costs $40.\nNot showing up costs 50% of the visit.\nYour card is saved securely with the payment provider and only charged under this policy. You''ll get a receipt if it is.',
    '{"windowHours": 48, "lateCancel": {"kind": "fixed", "amount": 4000}, "noShow": {"kind": "percent", "amount": 50}}',
    case when pg_temp.rnd('ch' || c.id) % 3 = 0 then 'link' else 'online' end,
    now() - make_interval(days => 100 + pg_temp.rnd('agreed' || c.id) % 60)
  from public.clients c
  where c.business_id = 'b0000000-0000-4000-8000-000000000001' and pg_temp.rnd('card' || c.id) % 100 < 66
    and exists (select 1 from public.appointments a where a.client_id = c.id and a.status = 'completed')
  returning id, business_id, client_id, agreed_at
)
insert into public.client_cards (business_id, client_id, provider, payment_method_ref, label, consent_id, created_at)
select business_id, client_id, 'test',
  case when pg_temp.rnd('declines' || client_id) % 100 < 6 then 'test_visa_0002' else 'test_visa_4242' end,
  case when pg_temp.rnd('declines' || client_id) % 100 < 6 then 'Visa …0002' else 'Visa …4242' end,
  id, agreed_at
from agreed;

-- The history's no-shows, and late cancellations by the client (inside 48
-- hours), with the fee the policy charged: from the card on file, waived by
-- a manager now and then, declined on a few cards, or waiting for a card.
with incidents as (
  select a.id as appointment_id, a.business_id, a.location_id, a.client_id, a.updated_at as at,
    case when a.status = 'no_show' then 'no_show' else 'late_cancel' end as kind,
    (select coalesce(sum(i.price_cents), 0) from public.appointment_items i where i.appointment_id = a.id)::int as visit,
    exists (select 1 from public.appointment_items i where i.appointment_id = a.id and i.staff_id = 'd0000000-0000-4000-8000-000000000005') as with_gil,
    cc.label as card
  from public.appointments a
  left join public.client_cards cc on cc.client_id = a.client_id and cc.removed_at is null and cc.created_at <= a.updated_at
  where a.business_id = 'b0000000-0000-4000-8000-000000000001' and a.client_id is not null and a.starts_at < now()
    and (a.status = 'no_show'
      or (a.status = 'canceled' and a.cancel_reason in ('Client canceled', 'Client is sick') and pg_temp.rnd(a.id || ':late') % 100 < 40))
),
priced as (
  select *,
    case when kind = 'no_show' then case when with_gil then greatest(8000, round(visit * 0.5)::int) else round(visit * 0.5)::int end
         else least(4000, visit) end as fee,
    case
      when card is null then 'no_card'
      when card = 'Visa …0002' then 'failed'
      when pg_temp.rnd(appointment_id || ':waive') % 100 < 15 then 'waived'
      else 'charged' end as status
  from incidents
),
fees as (
  insert into public.policy_fees (business_id, location_id, appointment_id, client_id, kind, fee_cents, status, attempts, provider, provider_reference, card_label,
    failure_reason, charged_at, waived_at, waived_by, waive_reason, receipt_sent_at, created_at, updated_at)
  select business_id, location_id, appointment_id, client_id, kind, fee, status,
    case when status in ('charged', 'failed') then 1 else 0 end,
    case when status = 'charged' then 'test' end,
    case when status = 'charged' then 'test_ch_seed' || substr(md5(appointment_id::text), 1, 16) end,
    card,
    case when status = 'failed' then 'The card was declined' end,
    case when status = 'charged' then at + interval '10 minutes' end,
    case when status = 'waived' then at + interval '2 hours' end,
    case when status = 'waived' then 'd0000000-0000-4000-8000-000000000002'::uuid end,
    case when status = 'waived' then (array['Family emergency', 'First time, let it go', 'Our booking mix-up', 'Car accident on the way'])[1 + pg_temp.rnd(appointment_id || ':why') % 4] end,
    case when status = 'charged' then at + interval '10 minutes' end,
    at, at
  from priced
  returning id, business_id, status, fee_cents, card_label, waive_reason, created_at, charged_at, waived_at, failure_reason
)
insert into public.policy_fee_events (business_id, fee_id, kind, amount_cents, detail, staff_id, created_at)
select business_id, id, 'assessed', fee_cents, null, 'd0000000-0000-4000-8000-000000000003'::uuid, created_at from fees
union all
select business_id, id, 'charged', fee_cents, card_label, null, charged_at from fees where status = 'charged'
union all
select business_id, id, 'receipt', null, null, null, charged_at from fees where status = 'charged'
union all
select business_id, id, 'failed', fee_cents, failure_reason, null, created_at + interval '10 minutes' from fees where status = 'failed'
union all
select business_id, id, 'waived', fee_cents, waive_reason, 'd0000000-0000-4000-8000-000000000002'::uuid, waived_at from fees where status = 'waived';

-- Goals: the owner set Bridget a monthly service revenue goal and Gil a
-- weekly retail one; Bridget set herself a 70% rebooking goal, and Shae a
-- quarter's new clients. Denise's check-ins: daily, Gil weekly.
insert into public.staff_goals (business_id, staff_id, metric, period, target, set_by_owner, created_by, updated_by)
values
  ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'service_revenue', 'month', 900000, true, 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'rebooking_rate', 'month', 70, false, 'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004'),
  ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'retail_revenue', 'week', 30000, true, 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000009', 'new_clients', 'quarter', 12, false, 'd0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000009');
update public.staff set goal_alerts = 'weekly' where id = 'd0000000-0000-4000-8000-000000000005';

-- Openings this afternoon: a client of Shae's and one of Hannah's canceled
-- a couple of days ago (one each, so their days still look busy), leaving
-- open time for the last-minute special and Denise's ideas.
with picked as (
  select a.id, row_number() over (partition by i.staff_id order by a.starts_at) as n
  from public.appointments a
  join public.appointment_items i on i.appointment_id = a.id
  where a.business_id = 'b0000000-0000-4000-8000-000000000001' and a.status in ('booked', 'confirmed')
    and i.staff_id in ('d0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000006')
    and a.starts_at >= now() + interval '2 hours'
    and (a.starts_at at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date
    and a.group_id is null and a.series_id is null
    and not exists (select 1 from public.appointment_items j where j.appointment_id = a.id and j.staff_id <> i.staff_id)
)
update public.appointments a set status = 'canceled', cancel_reason = 'Client canceled', canceled_at = now() - interval '2 days'
from picked p
where a.id = p.id and p.n = 1;

-- ---------------------------------------------------------------------------
-- Bridal and events at every stage, made the way the app makes them: the
-- desk (Sam) saves each one with save_event, sends the proposal, the client
-- agrees (accept_event_proposal, with a test card), and the past ones are
-- moved back to their day afterwards (a proposal can only be sent ahead).
--   Rossi: on location this coming Sunday, a party of 6, trial done, the
--     balance didn't go through (Denise's brief flags it).
--   Okafor: in the salon on a Saturday three to four weeks out, trial not
--     booked, and Nola, on the team, has since taken the day off.
--   Patel: proposal sent, waiting on the deposit. Alvarez: Denise drafted
--     it from one line. Nguyen: an inquiry from the booking site.
--   Brooks: last Sunday, paid in full, waiting to be completed (Event day).
--   Harper: three weeks ago, completed (its sale is in payroll).
--   Chen: lost to another salon.
-- ---------------------------------------------------------------------------

create function pg_temp.at(d date, m integer) returns text language sql as $$
  select to_char((d + make_interval(mins => m)) at time zone 'America/Chicago', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- A task: the member's place in the party (null for touch-ups), what, whose lane, from and to (minutes).
create function pg_temp.task(d date, member integer, kind text, role text, lane integer, staff text, s integer, e integer) returns jsonb language sql as $$
  select jsonb_build_object('member', member::text, 'kind', kind, 'role', role, 'lane', lane, 'staff_id', staff, 'starts_at', pg_temp.at(d, s), 'ends_at', pg_temp.at(d, e))
$$;

create function pg_temp.member(name text, role text, package integer) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'party_role', role, 'package_id', 'ee000000-0000-4000-8000-00000000000' || package)
$$;

-- Sent, then agreed by the client with a test card, booked `ago` days ago.
create function pg_temp.book(p_event uuid, p_name text, p_ago integer) returns void language plpgsql as $$
declare
  v_link uuid;
  v_event public.events;
begin
  v_link := public.send_event_proposal(p_event, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'email', 'client@example.test', 14);
  select * into v_event from public.events where id = p_event;
  perform public.accept_event_proposal(v_link, jsonb_build_object(
    'typed_name', p_name, 'total_cents', v_event.total_cents,
    'deposit', jsonb_build_object('amount_cents', v_event.deposit_cents, 'provider', 'test', 'reference', 'test_seed_' || left(p_event::text, 8)),
    'card', jsonb_build_object('provider', 'test', 'ref', 'tok_test_4242', 'label', 'Visa …4242')));
  update public.events set booked_at = now() - make_interval(days => p_ago), status_changed_at = now() - make_interval(days => p_ago),
    created_at = now() - make_interval(days => p_ago + 9)
  where id = p_event;
  update public.event_payments set paid_at = now() - make_interval(days => p_ago), created_at = now() - make_interval(days => p_ago),
    due_on = (now() - make_interval(days => p_ago))::date
  where event_id = p_event and kind = 'deposit';
  update public.event_history set created_at = now() - make_interval(days => p_ago) where event_id = p_event and kind in ('proposal_sent', 'booked');
  update public.event_history set created_at = now() - make_interval(days => p_ago + 9) where event_id = p_event and kind = 'created';
  update public.event_agreements set agreed_at = now() - make_interval(days => p_ago) where event_id = p_event;
  -- The schedule again, from the day it was booked (no trace of the first).
  perform private.schedule_event_payments(p_event);
  delete from public.event_payments where event_id = p_event and status = 'canceled';
end;
$$;

do $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  -- This coming Sunday (a week today on a Sunday), last Sunday, and three weeks before that.
  v_rossi date := v_today + (7 - extract(isodow from v_today)::int % 7);
  v_brooks date := v_today - extract(isodow from v_today)::int;
  v_harper date := v_today - extract(isodow from v_today)::int - 21;
  -- A Saturday three to four weeks out.
  v_okafor date := v_today + 22 + (13 - extract(isodow from v_today + 22)::int) % 7;
  v_patel date := v_today + 75;
  v_ahead date := v_today + 30;
  bridget text := 'd0000000-0000-4000-8000-000000000004';
  hannah text := 'd0000000-0000-4000-8000-000000000006';
  nola text := 'd0000000-0000-4000-8000-000000000007';
  shae text := 'd0000000-0000-4000-8000-000000000009';
  lois text := 'd0000000-0000-4000-8000-000000000010';
  v_id uuid;
begin
  -- As Sam at the front desk.
  perform set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);

  -- Rossi: on location, a party of 6, four artists.
  v_id := public.save_event(null, jsonb_build_object(
    'title', 'Rossi wedding', 'event_date', v_rossi, 'ready_by', pg_temp.at(v_rossi, 840),
    'new_client', jsonb_build_object('first_name', 'Mia', 'last_name', 'Rossi', 'phone', '(312) 555-0181', 'email', 'mia.rossi@example.test'),
    'venue_name', 'The Langford Hotel', 'venue_address', '400 N Lake Shore Dr, Chicago, IL', 'on_location', true, 'travel_miles', 12, 'travel_minutes', 30,
    'notes', 'Getting ready in the bridal suite on the 12th floor. Photographer arrives at 1pm.',
    'members', jsonb_build_array(pg_temp.member('Mia Rossi', 'bride', 1), pg_temp.member('Rae Rossi', 'maid_of_honor', 3), pg_temp.member('Lu Chen', 'bridesmaid', 3),
      pg_temp.member('Ana Diaz', 'bridesmaid', 3), pg_temp.member('Joy Park', 'bridesmaid', 2), pg_temp.member('Carla Rossi', 'mother', 4)),
    'tasks', jsonb_build_array(
      pg_temp.task(v_rossi, 5, 'hair', 'hair', 1, bridget, 545, 590), pg_temp.task(v_rossi, 6, 'hair', 'hair', 1, bridget, 595, 640), pg_temp.task(v_rossi, 1, 'hair', 'hair', 1, bridget, 645, 735),
      pg_temp.task(v_rossi, 2, 'hair', 'hair', 2, shae, 595, 640), pg_temp.task(v_rossi, 3, 'hair', 'hair', 2, shae, 645, 690), pg_temp.task(v_rossi, 4, 'hair', 'hair', 2, shae, 695, 740),
      pg_temp.task(v_rossi, 2, 'makeup', 'makeup', 1, hannah, 645, 690), pg_temp.task(v_rossi, 6, 'makeup', 'makeup', 1, hannah, 695, 740), pg_temp.task(v_rossi, 1, 'makeup', 'makeup', 1, hannah, 745, 820),
      pg_temp.task(v_rossi, 3, 'makeup', 'makeup', 2, lois, 695, 740), pg_temp.task(v_rossi, 4, 'makeup', 'makeup', 2, lois, 745, 790),
      pg_temp.task(v_rossi, null, 'touch_up', 'hair', 1, bridget, 825, 840), pg_temp.task(v_rossi, null, 'touch_up', 'hair', 2, shae, 825, 840),
      pg_temp.task(v_rossi, null, 'touch_up', 'makeup', 1, hannah, 825, 840), pg_temp.task(v_rossi, null, 'touch_up', 'makeup', 2, lois, 825, 840))));
  perform pg_temp.book(v_id, 'Mia Rossi', 70);
  perform public.set_event_status(v_id, 'trial_done', null);
  perform public.save_event_look(v_id, 'Soft romantic waves, half up, pinned with the pearl comb from the trial. Warm neutral eyes, a rosy lip; lashes for Mia only.');
  -- The second payment went through a month ago; the balance was declined.
  update public.event_payments set status = 'paid', paid_at = now() - interval '28 days', due_on = v_rossi - 30, provider = 'test', provider_reference = 'test_seed_second', card_label = 'Visa …4242', attempts = 1
  where event_id = v_id and kind = 'second' and status = 'scheduled';
  update public.event_payments set status = 'failed', failure_reason = 'The card was declined.', attempts = 1, due_on = least(due_on, v_today)
  where event_id = v_id and kind = 'final' and status = 'scheduled';

  -- Okafor: in the salon, a party of 3; Nola has since taken the day off.
  v_id := public.save_event(null, jsonb_build_object(
    'title', 'Okafor wedding', 'event_date', v_okafor, 'ready_by', pg_temp.at(v_okafor, 900),
    'new_client', jsonb_build_object('first_name', 'Grace', 'last_name', 'Okafor', 'phone', '(312) 555-0144', 'email', 'grace.okafor@example.test'),
    'members', jsonb_build_array(pg_temp.member('Grace Okafor', 'bride', 1), pg_temp.member('Ella Okafor', 'maid_of_honor', 3), pg_temp.member('Ivy Okafor', 'flower_girl', 5)),
    'tasks', jsonb_build_array(
      pg_temp.task(v_okafor, 2, 'hair', 'hair', 1, nola, 610, 655), pg_temp.task(v_okafor, 3, 'hair', 'hair', 1, nola, 660, 680), pg_temp.task(v_okafor, 1, 'hair', 'hair', 1, nola, 700, 790),
      pg_temp.task(v_okafor, 2, 'makeup', 'makeup', 1, lois, 660, 705), pg_temp.task(v_okafor, 1, 'makeup', 'makeup', 1, lois, 800, 875),
      pg_temp.task(v_okafor, null, 'touch_up', 'hair', 1, nola, 885, 900), pg_temp.task(v_okafor, null, 'touch_up', 'makeup', 1, lois, 885, 900))));
  perform pg_temp.book(v_id, 'Grace Okafor', 20);
  update public.event_payments set status = 'paid', paid_at = now() - interval '6 days', due_on = v_okafor - 30, provider = 'test', provider_reference = 'test_seed_second', card_label = 'Visa …4242', attempts = 1
  where event_id = v_id and kind = 'second' and status = 'scheduled';
  insert into public.staff_time_off (business_id, staff_id, starts_on, ends_on, reason, note, status, requested_by, decided_by, decided_at)
  values ('b0000000-0000-4000-8000-000000000001', nola::uuid, v_okafor, v_okafor, 'personal', 'Family wedding', 'approved', nola::uuid, 'd0000000-0000-4000-8000-000000000001', now() - interval '3 days');

  -- Patel: the proposal's out, waiting on the deposit.
  v_id := public.save_event(null, jsonb_build_object(
    'title', 'Patel wedding', 'event_date', v_patel, 'ready_by', pg_temp.at(v_patel, 960),
    'new_client', jsonb_build_object('first_name', 'Priya', 'last_name', 'Patel', 'phone', '(312) 555-0102', 'email', 'priya.patel@example.test'),
    'members', jsonb_build_array(pg_temp.member('Priya Patel', 'bride', 1), pg_temp.member('Anika Shah', 'bridesmaid', 3), pg_temp.member('Meera Patel', 'bridesmaid', 3),
      pg_temp.member('Riya Desai', 'bridesmaid', 3), pg_temp.member('Tara Patel', 'flower_girl', 5)),
    'tasks', jsonb_build_array(
      pg_temp.task(v_patel, 2, 'hair', 'hair', 1, bridget, 640, 685), pg_temp.task(v_patel, 3, 'hair', 'hair', 1, bridget, 690, 735), pg_temp.task(v_patel, 1, 'hair', 'hair', 1, bridget, 740, 830),
      pg_temp.task(v_patel, 5, 'hair', 'hair', 2, shae, 670, 690), pg_temp.task(v_patel, 4, 'hair', 'hair', 2, shae, 695, 740),
      pg_temp.task(v_patel, 2, 'makeup', 'makeup', 1, hannah, 690, 735), pg_temp.task(v_patel, 4, 'makeup', 'makeup', 1, hannah, 745, 790), pg_temp.task(v_patel, 1, 'makeup', 'makeup', 1, hannah, 835, 910),
      pg_temp.task(v_patel, 3, 'makeup', 'makeup', 2, lois, 740, 785),
      pg_temp.task(v_patel, null, 'touch_up', 'hair', 1, bridget, 945, 960), pg_temp.task(v_patel, null, 'touch_up', 'hair', 2, shae, 945, 960),
      pg_temp.task(v_patel, null, 'touch_up', 'makeup', 1, hannah, 945, 960), pg_temp.task(v_patel, null, 'touch_up', 'makeup', 2, lois, 945, 960))));
  perform public.send_event_proposal(v_id, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'email', 'priya.patel@example.test', 14);
  update public.event_history set created_at = now() - interval '2 days' where event_id = v_id;
  update public.events set created_at = now() - interval '4 days', status_changed_at = now() - interval '2 days' where id = v_id;

  -- Alvarez: Denise drafted it from one line; nobody's chosen yet.
  v_id := public.save_event(null, jsonb_build_object(
    'title', 'Alvarez quinceañera', 'event_date', v_today + 150, 'ready_by', pg_temp.at(v_today + 150, 840), 'source', 'denise',
    'described', 'Quinceañera, ready by 2pm, Sofia hair and makeup plus 3 friends hair',
    'new_client', jsonb_build_object('first_name', 'Sofia', 'last_name', 'Alvarez', 'phone', '(312) 555-0167'),
    'members', jsonb_build_array(pg_temp.member('Sofia Alvarez', 'guest', 1), pg_temp.member('Guest 2', 'guest', 2), pg_temp.member('Guest 3', 'guest', 2), pg_temp.member('Guest 4', 'guest', 2)),
    'tasks', jsonb_build_array(
      pg_temp.task(v_today + 150, 4, 'hair', 'hair', 1, null, 590, 635), pg_temp.task(v_today + 150, 1, 'hair', 'hair', 1, null, 640, 730),
      pg_temp.task(v_today + 150, 2, 'hair', 'hair', 2, null, 720, 765), pg_temp.task(v_today + 150, 3, 'hair', 'hair', 2, null, 770, 815),
      pg_temp.task(v_today + 150, 1, 'makeup', 'makeup', 1, null, 735, 810),
      pg_temp.task(v_today + 150, null, 'touch_up', 'hair', 1, null, 825, 840), pg_temp.task(v_today + 150, null, 'touch_up', 'hair', 2, null, 825, 840),
      pg_temp.task(v_today + 150, null, 'touch_up', 'makeup', 1, null, 825, 840))));
  update public.events set created_at = now() - interval '1 day' where id = v_id;

  -- Brooks: last Sunday, on location, paid in full: Event day until it's completed.
  v_id := public.save_event(null, jsonb_build_object(
    'title', 'Brooks wedding', 'event_date', v_ahead, 'ready_by', pg_temp.at(v_brooks, 660),
    'new_client', jsonb_build_object('first_name', 'Zoe', 'last_name', 'Brooks', 'phone', '(312) 555-0129', 'email', 'zoe.brooks@example.test'),
    'venue_name', 'Lincoln Park Conservatory', 'on_location', true, 'travel_miles', 6, 'travel_minutes', 20,
    'members', jsonb_build_array(pg_temp.member('Zoe Brooks', 'bride', 1), pg_temp.member('Tess Brooks', 'bridesmaid', 2), pg_temp.member('Bea Lang', 'bridesmaid', 2)),
    'tasks', jsonb_build_array(
      pg_temp.task(v_brooks, 1, 'hair', 'hair', 1, shae, 470, 560), pg_temp.task(v_brooks, 2, 'hair', 'hair', 2, nola, 500, 545), pg_temp.task(v_brooks, 3, 'hair', 'hair', 2, nola, 550, 595),
      pg_temp.task(v_brooks, 1, 'makeup', 'makeup', 1, hannah, 565, 640),
      pg_temp.task(v_brooks, null, 'touch_up', 'hair', 1, shae, 645, 660), pg_temp.task(v_brooks, null, 'touch_up', 'hair', 2, nola, 645, 660),
      pg_temp.task(v_brooks, null, 'touch_up', 'makeup', 1, hannah, 645, 660))));
  perform pg_temp.book(v_id, 'Zoe Brooks', 90);
  update public.events set event_date = v_brooks, status = 'trial_done', look_notes = 'Sleek low bun with a middle part. Fresh, dewy skin.' where id = v_id;
  update public.event_payments set status = 'paid', paid_at = (v_brooks - 7 + time '10:00') at time zone 'America/Chicago', due_on = v_brooks - 7,
    provider = 'test', provider_reference = 'test_seed_' || kind, card_label = 'Visa …4242', attempts = 1
  where event_id = v_id and status = 'scheduled';
  perform private.sync_event_blocks(v_id);

  -- Harper: three weeks ago, in the salon, completed: its sale goes to payroll.
  v_id := public.save_event(null, jsonb_build_object(
    'title', 'Harper wedding', 'event_date', v_ahead, 'ready_by', pg_temp.at(v_harper, 780),
    'new_client', jsonb_build_object('first_name', 'Emma', 'last_name', 'Harper', 'phone', '(312) 555-0193', 'email', 'emma.harper@example.test'),
    'members', jsonb_build_array(pg_temp.member('Emma Harper', 'bride', 1), pg_temp.member('Ann Harper', 'bridesmaid', 3), pg_temp.member('Kay Moss', 'bridesmaid', 6), pg_temp.member('Lynn Harper', 'mother', 4)),
    'tasks', jsonb_build_array(
      pg_temp.task(v_harper, 4, 'hair', 'hair', 1, bridget, 480, 525), pg_temp.task(v_harper, 2, 'hair', 'hair', 1, bridget, 530, 575), pg_temp.task(v_harper, 1, 'hair', 'hair', 1, bridget, 580, 670),
      pg_temp.task(v_harper, 1, 'makeup', 'makeup', 1, hannah, 675, 750),
      pg_temp.task(v_harper, 3, 'makeup', 'makeup', 2, lois, 540, 585), pg_temp.task(v_harper, 4, 'makeup', 'makeup', 2, lois, 590, 635), pg_temp.task(v_harper, 2, 'makeup', 'makeup', 2, lois, 640, 685),
      pg_temp.task(v_harper, null, 'touch_up', 'hair', 1, bridget, 765, 780), pg_temp.task(v_harper, null, 'touch_up', 'makeup', 1, hannah, 765, 780),
      pg_temp.task(v_harper, null, 'touch_up', 'makeup', 2, lois, 765, 780))));
  perform pg_temp.book(v_id, 'Emma Harper', 120);
  update public.events set event_date = v_harper, status = 'trial_done' where id = v_id;
  update public.event_payments set status = 'paid', paid_at = (v_harper - 7 + time '10:00') at time zone 'America/Chicago', due_on = v_harper - 7,
    provider = 'test', provider_reference = 'test_seed_' || kind, card_label = 'Visa …4242', attempts = 1
  where event_id = v_id and status = 'scheduled';
  perform private.sync_event_blocks(v_id);
  perform public.complete_event(v_id);
  update public.sales set created_at = (v_harper + time '14:00') at time zone 'America/Chicago' where id = (select sale_id from public.events where id = v_id);
  update public.events set status_changed_at = (v_harper + time '14:00') at time zone 'America/Chicago' where id = v_id;
  update public.event_history set created_at = (v_harper + time '14:00') at time zone 'America/Chicago' where event_id = v_id and kind = 'completed';

  -- Chen: a prom, lost to another salon.
  v_id := public.save_event(null, jsonb_build_object(
    'title', 'Chen prom', 'event_date', v_today + 40, 'ready_by', pg_temp.at(v_today + 40, 1020),
    'new_client', jsonb_build_object('first_name', 'Lily', 'last_name', 'Chen', 'phone', '(312) 555-0155'),
    'members', jsonb_build_array(pg_temp.member('Lily Chen', 'guest', 2), pg_temp.member('Jade Wu', 'guest', 2)),
    'tasks', jsonb_build_array(pg_temp.task(v_today + 40, 1, 'hair', 'hair', 1, shae, 910, 955), pg_temp.task(v_today + 40, 2, 'hair', 'hair', 1, shae, 960, 1005),
      pg_temp.task(v_today + 40, null, 'touch_up', 'hair', 1, shae, 1005, 1020))));
  perform public.set_event_status(v_id, 'lost', 'Went with another salon');
  update public.events set created_at = now() - interval '12 days', status_changed_at = now() - interval '5 days' where id = v_id;
end $$;

-- Nguyen: an inquiry from the booking site (as save_event_inquiry makes it).
with client as (
  insert into public.clients (business_id, first_name, last_name, phone, email)
  values ('b0000000-0000-4000-8000-000000000001', 'Linh', 'Nguyen', '(312) 555-0110', 'linh.nguyen@example.test')
  returning id
), event as (
  insert into public.events (business_id, location_id, client_id, title, event_date, venue_name, on_location, notes, source, inquiry_party_size, inquiry_services, created_at, status_changed_at)
  select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', client.id, 'Linh''s wedding',
    (now() at time zone 'America/Chicago')::date + 120, 'Morton Arboretum', true,
    'Outdoor ceremony at 4pm. Loves a soft, natural look.', 'online', 5, 'Hair and makeup for me and 4 bridesmaids', now() - interval '6 hours', now() - interval '6 hours'
  from client
  returning id
)
insert into public.event_history (business_id, event_id, kind, detail, created_at)
select 'b0000000-0000-4000-8000-000000000001', id, 'inquiry', 'Sent from the booking site', now() - interval '6 hours' from event;

-- Phone booking (the calendar's Phone booking panel, docs/help/take-a-phone-booking.md):
-- "Maria Lopez, balayage + cut with Bridget next week, afternoons" finds a
-- real regular. The client with the most balayage visits with Bridget
-- (among those with a card on file that no test looks up by id) is
-- renamed Maria Lopez, with a latex allergy, so the panel shows both alerts.
do $$
declare
  v_client uuid;
begin
  select c.id into v_client
  from public.clients c
  join public.appointments a on a.client_id = c.id and a.status = 'completed'
  join public.appointment_items i on i.appointment_id = a.id
  join public.services s on s.id = i.service_id
  where c.business_id = 'b0000000-0000-4000-8000-000000000001'
    and i.staff_id = 'd0000000-0000-4000-8000-000000000004'
    and c.id not in (
      'e0000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-0000000000fb', 'e0000000-0000-4000-8000-0000000000a8',
      'e0000000-0000-4000-8000-00000000009a', 'e0000000-0000-4000-8000-00000000014a', 'e0000000-0000-4000-8000-000000000088',
      'e0000000-0000-4000-8000-00000000007c', 'e0000000-0000-4000-8000-00000000000d', 'e0000000-0000-4000-8000-000000000008',
      'e0000000-0000-4000-8000-00000000018b', 'e0000000-0000-4000-8000-000000000135', 'e0000000-0000-4000-8000-000000000099',
      'e0000000-0000-4000-8000-000000000093', 'e0000000-0000-4000-8000-00000000008d', 'e0000000-0000-4000-8000-00000000009e')
    and not exists (select 1 from public.client_memberships m where m.client_id = c.id)
    and exists (select 1 from public.client_cards cc where cc.client_id = c.id and cc.removed_at is null)
  group by c.id
  order by count(distinct a.id) filter (where s.category = 'Balayage') desc, count(distinct a.id) desc, c.id
  limit 1;
  if v_client is null then return; end if;
  update public.clients set first_name = 'Maria', last_name = 'Lopez', email = 'maria.lopez@example.com', allergies = 'Latex allergy: use nitrile gloves.'
  where id = v_client;
end $$;

-- Sick-day rescue (/calendar/rescue): a few regulars of each stylist only
-- book with them (their preferred stylist), so a rescue offers them their
-- stylist's next openings instead of someone else. Two per stylist, among
-- those with a visit booked with them in the next nine days.
with ranked as (
  select c.id, row_number() over (partition by c.preferred_staff_id order by c.id) as n
  from public.clients c
  where c.business_id = 'b0000000-0000-4000-8000-000000000001'
    and c.preferred_staff_id is not null
    and exists (
      select 1 from public.appointments a join public.appointment_items i on i.appointment_id = a.id
      where a.client_id = c.id and i.staff_id = c.preferred_staff_id and a.status in ('booked', 'confirmed') and a.starts_at > now()
    )
)
update public.clients c set only_sees_preferred = true from ranked r where r.id = c.id and r.n <= 2;

-- Rewards (Settings → Rewards): a point a dollar on services and retail,
-- bonuses, three tiers by spend (VIP gets half as many points again, a
-- free hydrating mask and first place on the waitlist), a catalog, and
-- points earned on every past sale (backfill_reward_points, oldest
-- first). Then two planted moments: Linda, coming in on the next day with
-- visits, 40 points from a free gloss (Denise says so at checkout), and a
-- referral that paid both clients when the friend's first visit was
-- checked out, and another friend who hasn't come in yet.
do $$
declare
  v_business uuid := 'b0000000-0000-4000-8000-000000000001';
  v_gloss uuid := (select id from public.services where business_id = v_business and name = 'Gloss / Toner');
  v_mask uuid := (select id from public.services where business_id = v_business and name = 'Hydrating Mask Add-On');
  v_vip uuid;
  v_linda uuid;
  v_friend uuid;
  v_referrer uuid;
  v_waiting uuid;
  v_tz text := (select timezone from public.locations where business_id = v_business limit 1);
  v_day date;
begin
  insert into public.reward_programs (business_id, enabled, service_points_per_dollar, retail_points_per_dollar, birthday_points, referral_points, rebook_points, first_visit_points, expiry_months, min_redeem_points, tier_basis)
  values (v_business, true, 1, 1, 100, 200, 25, 50, 12, 200, 'spend');
  insert into public.reward_tiers (business_id, name, threshold, bonus_pct) values (v_business, 'Silver', 30000, 0), (v_business, 'Gold', 60000, 25);
  insert into public.reward_tiers (business_id, name, threshold, bonus_pct, free_addon_service_id, priority_booking)
  values (v_business, 'VIP', 100000, 50, v_mask, true) returning id into v_vip;
  insert into public.rewards (business_id, name, points, kind, amount_cents, applies_services, applies_retail) values (v_business, '$10 off', 200, 'amount', 1000, true, true), (v_business, '$25 off', 500, 'amount', 2500, true, true);
  insert into public.rewards (business_id, name, points, kind, service_ids, max_per_year, applies_services, applies_retail) values (v_business, 'Free gloss', 400, 'free_service', array[v_gloss], 2, true, false);
  insert into public.rewards (business_id, name, points, kind, percent, applies_services, applies_retail, max_per_year) values (v_business, '20% off retail', 300, 'percent', 20, false, true, 4);

  -- A completed referral: a client whose first visit was in the last month
  -- came from a regular's link.
  select c.id into v_friend from public.clients c
  where c.business_id = v_business and c.referred_by is null
    and (select count(*) from public.appointments a where a.client_id = c.id and a.status = 'completed') = 1
    and exists (select 1 from public.appointments a where a.client_id = c.id and a.status = 'completed' and a.checked_out_at > now() - interval '30 days')
  order by c.id limit 1;
  select c.id into v_referrer from public.clients c
  where c.business_id = v_business and c.id <> v_friend
    and (select count(*) from public.appointments a where a.client_id = c.id and a.status = 'completed') >= 4
  order by c.id limit 1;
  update public.clients set referred_by = v_referrer where id = v_friend;
  -- And one who hasn't been in yet.
  select c.id into v_waiting from public.clients c
  where c.business_id = v_business and c.referred_by is null and c.id <> v_referrer
    and not exists (select 1 from public.appointments a where a.client_id = c.id and a.status = 'completed')
  order by c.id limit 1;
  update public.clients set referred_by = v_referrer where id = v_waiting;

  perform public.backfill_reward_points(v_business);

  -- Linda: on the next day with visits, with no package or membership,
  -- 40 points short of a free gloss.
  select min((a.starts_at at time zone v_tz)::date) into v_day from public.appointments a
  where a.business_id = v_business and a.status in ('booked', 'confirmed') and (a.starts_at at time zone v_tz)::date >= (now() at time zone v_tz)::date;
  select a.client_id into v_linda from public.appointments a
  join public.clients c on c.id = a.client_id
  where a.business_id = v_business and a.status in ('booked', 'confirmed') and (a.starts_at at time zone v_tz)::date = v_day
    and not (c.id = any (array_remove(array[v_friend, v_referrer, v_waiting], null)))
    and not exists (select 1 from public.client_memberships m where m.client_id = c.id)
    and not exists (select 1 from public.client_packages p where p.client_id = c.id)
    and c.allergies is null
    and exists (select 1 from public.appointments p where p.client_id = c.id and p.status = 'completed')
    and private.points_balance(c.id) < 360
  order by a.starts_at, c.id limit 1;
  if v_linda is not null then
    update public.clients set first_name = 'Linda', last_name = 'Park' where id = v_linda;
    insert into public.reward_points (business_id, client_id, delta, kind, reason, staff_id, created_at)
    select v_business, v_linda, 360 - private.points_balance(v_linda), 'adjust', 'Points from the old punch card', 'd0000000-0000-4000-8000-000000000002', now() - interval '20 days'
    where private.points_balance(v_linda) <> 360;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The team schedule: this week published by Daniel on Saturday, and a
-- draft for next week he hasn't published (Sandra picking up a Saturday).
-- ---------------------------------------------------------------------------
insert into public.schedule_publishes (business_id, location_id, week_start, published_by, published_at, days_changed, people_notified)
select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', w.monday,
       'd0000000-0000-4000-8000-000000000002', ((w.monday - 2)::timestamp + time '16:30') at time zone 'America/Chicago', 0, 0
from (select (now() at time zone 'America/Chicago')::date - (extract(isodow from (now() at time zone 'America/Chicago')::date)::int - 1) as monday) w;

insert into public.schedule_drafts (business_id, location_id, staff_id, on_date, shifts, updated_by)
select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000008',
       w.monday + 12, '[{"start": 540, "end": 900}]'::jsonb, 'd0000000-0000-4000-8000-000000000002'
from (select (now() at time zone 'America/Chicago')::date - (extract(isodow from (now() at time zone 'America/Chicago')::date)::int - 1) as monday) w;

-- Sandra doesn't work Saturdays, so on the coming one Shae is using her
-- chair (Chair 4) for her shift.
insert into public.station_assignments (business_id, location_id, resource_id, staff_id, on_date, start_minute, end_minute, created_by)
select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000004',
       'd0000000-0000-4000-8000-000000000009', t.today + ((6 - extract(isodow from t.today)::int + 7) % 7), 8 * 60, 16 * 60,
       'd0000000-0000-4000-8000-000000000002'
from (select (now() at time zone 'America/Chicago')::date as today) t;
