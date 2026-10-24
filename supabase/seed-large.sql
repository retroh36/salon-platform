-- A second, larger demo salon, added by `npm run seed:demo` after
-- seed-demo.sql: Harbor & Vine Salon and Spa, with 35 stylists across
-- hair, color, nails and skin, open seven days, so the calendar can be
-- tried (and tested, e2e/large-salon.spec.ts) with many columns and
-- about ten people off on any given day. Appointments run from three
-- days back to a week ahead. Online booking, memberships and automations
-- stay off here. All people are made up.
--
-- Logins (password for all: password123)
--   owner@harborvine.test       owner
--   manager@harborvine.test     manager
--   frontdesk@harborvine.test   front desk
-- The stylists have no logins.

-- ---------------------------------------------------------------------------
-- Auth users, business, location
-- ---------------------------------------------------------------------------

with seed_users (id, email) as (
  values
    ('a1000000-0000-4000-8000-000000000001'::uuid, 'owner@harborvine.test'),
    ('a1000000-0000-4000-8000-000000000002'::uuid, 'manager@harborvine.test'),
    ('a1000000-0000-4000-8000-000000000003'::uuid, 'frontdesk@harborvine.test')
),
inserted_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  from seed_users
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email', jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from inserted_users;

insert into public.businesses (id, name, plan) values
  ('b1000000-0000-4000-8000-000000000001', 'Harbor & Vine Salon and Spa', 'trial');

insert into public.locations (id, business_id, name, address_line1, city, region, postal_code, country, phone, timezone) values
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Harbor & Vine Riverside',
   '400 Example Avenue', 'Springfield', 'IL', '62702', 'US', '(555) 010-0200', 'America/Chicago');

-- Open seven days: 9 to 8, Sundays 10 to 5.
insert into public.location_hours (business_id, location_id, weekday, start_minute, end_minute)
select 'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', d,
       case when d = 7 then 600 else 540 end, case when d = 7 then 1020 else 1200 end
from generate_series(1, 7) d;

-- ---------------------------------------------------------------------------
-- Staff: the owner, a manager and the front desk, then 35 stylists:
-- 11 on hair, 9 on color, 8 on nails and 7 on skin.
-- ---------------------------------------------------------------------------

insert into public.staff (id, business_id, location_id, user_id, first_name, last_name, email, phone, role, color) values
  ('d1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'Renata', 'Albright', 'owner@harborvine.test', '(555) 010-0201', 'owner', '#7c3aed'),
  ('d1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000002', 'Marcus', 'Ilunga', 'manager@harborvine.test', '(555) 010-0202', 'manager', '#2563eb'),
  ('d1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000003', 'Toni', 'Haskell', 'frontdesk@harborvine.test', '(555) 010-0203', 'front_desk', null);

create temp table team (n int, first_name text, last_name text, dept text, level text, color text, shift text);
insert into team values
  -- Hair
  (11, 'Ada', 'Okonkwo', 'hair', 'master', '#db2777', 'day'),
  (12, 'Beau', 'Lindqvist', 'hair', 'senior', '#059669', 'late'),
  (13, 'Celia', 'Marchetti', 'hair', 'senior', '#ea580c', 'day'),
  (14, 'Dev', 'Raman', 'hair', 'artisan', '#0891b2', 'mid'),
  (15, 'Elena', 'Petrova', 'hair', 'master', '#ca8a04', 'day'),
  (16, 'Finn', 'Gallagher', 'hair', 'artisan', '#4f46e5', 'late'),
  (17, 'Gemma', 'Castellanos', 'hair', 'senior', '#be185d', 'mid'),
  (18, 'Hugo', 'Achterberg', 'hair', 'artisan', '#0d9488', 'part'),
  (19, 'Iris', 'Nakamura', 'hair', 'senior', '#9333ea', 'day'),
  (20, 'Jude', 'Mensah', 'hair', 'artisan', '#b45309', 'late'),
  (21, 'Kira', 'Solberg', 'hair', 'master', '#1d4ed8', 'mid'),
  -- Color
  (22, 'Lena', 'Varga', 'color', 'master', '#c2410c', 'day'),
  (23, 'Milo', 'Ferreira', 'color', 'senior', '#15803d', 'mid'),
  (24, 'Noor', 'Haddad', 'color', 'master', '#a21caf', 'day'),
  (25, 'Odette', 'Brandt', 'color', 'senior', '#0369a1', 'late'),
  (26, 'Pia', 'Rasmussen', 'color', 'artisan', '#b91c1c', 'mid'),
  (27, 'Quinn', 'Delacroix', 'color', 'senior', '#4d7c0f', 'day'),
  (28, 'Rosa', 'Iglesias', 'color', 'master', '#7e22ce', 'late'),
  (29, 'Soren', 'Whitlock', 'color', 'artisan', '#0f766e', 'part'),
  (30, 'Tess', 'Abernathy', 'color', 'senior', '#be123c', 'mid'),
  -- Nails
  (31, 'Uma', 'Kowalczyk', 'nails', null, '#e11d48', 'day'),
  (32, 'Vera', 'Lindgren', 'nails', null, '#0284c7', 'mid'),
  (33, 'Wren', 'Oyelaran', 'nails', null, '#65a30d', 'late'),
  (34, 'Xia', 'Tran', 'nails', null, '#c026d3', 'day'),
  (35, 'Yara', 'Benedetti', 'nails', null, '#ea580c', 'mid'),
  (36, 'Zoe', 'Fairbanks', 'nails', null, '#0891b2', 'part'),
  (37, 'Amara', 'Diallo', 'nails', null, '#9333ea', 'late'),
  (38, 'Bianca', 'Moreau', 'nails', null, '#16a34a', 'day'),
  -- Skin
  (39, 'Cleo', 'Varadi', 'skin', null, '#db2777', 'day'),
  (40, 'Daria', 'Kimura', 'skin', null, '#2563eb', 'mid'),
  (41, 'Esme', 'Rourke', 'skin', null, '#ca8a04', 'late'),
  (42, 'Faye', 'Mbeki', 'skin', null, '#0d9488', 'day'),
  (43, 'Greta', 'Holm', 'skin', null, '#7c3aed', 'part'),
  (44, 'Hana', 'Sato', 'skin', null, '#dc2626', 'mid'),
  (45, 'Ines', 'Carvalho', 'skin', null, '#0369a1', 'late');

insert into public.staff (id, business_id, location_id, first_name, last_name, email, role, level, color, calendar_position)
select ('d1000000-0000-4000-8000-0000000000' || n)::uuid, 'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
       first_name, last_name, lower(first_name) || '@harborvine.test', 'stylist', level::public.staff_level, color,
       -- The salon's calendar order: by department, as listed.
       n - 10
from team;

-- ---------------------------------------------------------------------------
-- Services by department
-- ---------------------------------------------------------------------------

insert into public.services (business_id, category, name, active_minutes, processing_minutes, finishing_minutes, price_cents)
select 'b1000000-0000-4000-8000-000000000001', category, name, active, processing, finishing, price
from (values
  ('Cuts', 'Women''s Cut & Style', 60, 0, 0, 9000),
  ('Cuts', 'Men''s Cut', 30, 0, 0, 5000),
  ('Cuts', 'Kids'' Cut', 30, 0, 0, 3500),
  ('Cuts', 'Curly Cut', 75, 0, 0, 11500),
  ('Blowouts & Styling', 'Blowout', 45, 0, 0, 6000),
  ('Blowouts & Styling', 'Updo', 60, 0, 0, 12000),
  ('Treatments', 'Deep Conditioning', 10, 15, 5, 3500),
  ('Color', 'Root Touch-Up', 30, 35, 20, 10000),
  ('Color', 'All-Over Color', 45, 35, 25, 14000),
  ('Color', 'Gloss / Toner', 15, 20, 15, 6000),
  ('Highlights', 'Partial Highlights', 45, 35, 30, 16000),
  ('Highlights', 'Full Highlights', 75, 35, 30, 21000),
  ('Balayage', 'Balayage', 75, 40, 40, 26000),
  ('Nails', 'Classic Manicure', 30, 0, 0, 3500),
  ('Nails', 'Gel Manicure', 45, 0, 0, 5000),
  ('Nails', 'Classic Pedicure', 50, 0, 0, 5500),
  ('Nails', 'Gel Pedicure', 60, 0, 0, 7000),
  ('Nails', 'Acrylic Full Set', 75, 0, 0, 8500),
  ('Nails', 'Nail Art (per set)', 15, 0, 0, 2000),
  ('Skin', 'Signature Facial', 60, 0, 0, 12000),
  ('Skin', 'Express Facial', 30, 0, 0, 6500),
  ('Skin', 'Dermaplaning', 45, 0, 0, 9500),
  ('Skin', 'Chemical Peel', 45, 0, 0, 11000),
  ('Brows & Lashes', 'Brow Shape & Wax', 15, 0, 0, 2800),
  ('Brows & Lashes', 'Lash Lift & Tint', 45, 0, 0, 8500)
) as s (category, name, active, processing, finishing, price);

insert into public.staff_services (business_id, staff_id, service_id)
select 'b1000000-0000-4000-8000-000000000001', ('d1000000-0000-4000-8000-0000000000' || t.n)::uuid, sv.id
from team t
join public.services sv on sv.business_id = 'b1000000-0000-4000-8000-000000000001'
 and case t.dept
   when 'hair' then sv.category in ('Cuts', 'Blowouts & Styling', 'Treatments')
   when 'color' then sv.category in ('Color', 'Highlights', 'Balayage') or sv.name = 'Blowout'
   when 'nails' then sv.category = 'Nails'
   else sv.category in ('Skin', 'Brows & Lashes')
 end;

-- ---------------------------------------------------------------------------
-- Weekly hours: five days a week each, two days off spread so about ten
-- people are off any day. Shifts: day 9–5, mid 10–6, late 12–8; part
-- timers work mornings, 9–1. Sundays are 10–5 for everyone working.
-- ---------------------------------------------------------------------------

insert into public.staff_working_hours (business_id, staff_id, weekday, start_minute, end_minute)
select 'b1000000-0000-4000-8000-000000000001', ('d1000000-0000-4000-8000-0000000000' || t.n)::uuid, d,
       case when d = 7 then 600 when t.shift = 'mid' then 600 when t.shift = 'late' then 720 else 540 end,
       case when d = 7 then 1020 when t.shift = 'part' then 780 when t.shift = 'mid' then 1080 when t.shift = 'late' then 1200 else 1020 end
from team t
cross join generate_series(1, 7) d
where d <> (t.n % 7) + 1 and d <> ((t.n + 3) % 7) + 1;

-- Time off around today, so the "off today" list has more than days off:
-- someone sick today, a week's vacation, a personal day tomorrow, and a
-- dentist this afternoon (that one still shows, greyed for those hours).
with d as (select (now() at time zone 'America/Chicago')::date as today)
insert into public.staff_time_off (business_id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status, requested_by, decided_by, decided_at)
select 'b1000000-0000-4000-8000-000000000001', s.staff_id::uuid, s.starts_on, s.ends_on, s.start_minute, s.end_minute, s.reason::public.time_off_reason, s.note,
       'approved', 'd1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', now()
from d, lateral (values
  -- Whoever's on the day shift today with the lowest number, out sick.
  ((select 'd1000000-0000-4000-8000-0000000000' || t.n from team t
    where extract(isodow from d.today) not in ((t.n % 7) + 1, ((t.n + 3) % 7) + 1) and t.dept = 'hair' order by t.n limit 1),
   d.today, d.today, null::int, null::int, 'sick', null::text),
  ((select 'd1000000-0000-4000-8000-0000000000' || t.n from team t
    where extract(isodow from d.today) not in ((t.n % 7) + 1, ((t.n + 3) % 7) + 1) and t.dept = 'color' order by t.n limit 1),
   d.today - 2, d.today + 4, null, null, 'vacation', 'Lisbon'),
  ((select 'd1000000-0000-4000-8000-0000000000' || t.n from team t
    where extract(isodow from d.today + 1) not in ((t.n % 7) + 1, ((t.n + 3) % 7) + 1) and t.dept = 'nails' order by t.n limit 1),
   d.today + 1, d.today + 1, null, null, 'personal', 'Moving house'),
  ((select 'd1000000-0000-4000-8000-0000000000' || t.n from team t
    where extract(isodow from d.today) not in ((t.n % 7) + 1, ((t.n + 3) % 7) + 1) and t.dept = 'skin' and t.shift in ('day', 'mid') order by t.n limit 1),
   d.today, d.today, 14 * 60, 16 * 60, 'personal', 'Dentist')
) as s (staff_id, starts_on, ends_on, start_minute, end_minute, reason, note);

-- ---------------------------------------------------------------------------
-- Clients (400), made up.
-- ---------------------------------------------------------------------------

insert into public.clients (id, business_id, first_name, last_name, phone, email, sms_opt_in, email_opt_in)
select ('e1000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, 'b1000000-0000-4000-8000-000000000001',
       (array['Alice','Bea','Carmen','Dana','Eve','Farah','Gia','Hope','Ivy','Jada','Kai','Lola','Maren','Nina','Opal','Paige','Rae','Sage','Tara','Uri','Val','Wes','Yael','Zara'])[i % 24 + 1],
       (array['Abbott','Banks','Choi','Doyle','Ellis','Frost','Grant','Hayes','Ito','Joyce','Khan','Lowe','Mora','Nash','Ortiz','Pryce','Quill','Reyes','Shaw','Tate','Underwood','Vance','Wolfe','Young','Zhou'])[(i / 24) % 25 + 1],
       '(217) 555-' || lpad((1000 + i)::text, 4, '0'),
       'client' || i || '@example.com', true, i % 3 = 0
from generate_series(0, 399) i;

-- ---------------------------------------------------------------------------
-- Appointments, three days back to a week ahead: each stylist's shifts
-- filled about two thirds, one visit after another (so nothing overlaps),
-- with services they offer, around approved time off.
-- ---------------------------------------------------------------------------

create function pg_temp.rnd(key text) returns int
language sql immutable as $$ select abs(hashtext(key)) % 10000 $$;

do $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_business uuid := 'b1000000-0000-4000-8000-000000000001';
  v_location uuid := 'c1000000-0000-4000-8000-000000000001';
  v_desk uuid := 'd1000000-0000-4000-8000-000000000003';
  d date;
  st record;
  svc record;
  cur int;
  shift_end int;
  key text;
  v_start timestamptz;
  v_end timestamptz;
  v_appointment uuid;
  v_status public.appointment_status;
  n int := 0;
begin
  for d in select generate_series(v_today - 3, v_today + 7, interval '1 day')::date loop
    for st in
      select s.id, w.start_minute, w.end_minute
      from public.staff s
      join public.staff_working_hours w on w.staff_id = s.id and w.weekday = extract(isodow from d)
      where s.business_id = v_business and s.role = 'stylist'
        and not exists (
          select 1 from public.staff_time_off t
          where t.staff_id = s.id and t.status = 'approved' and d between t.starts_on and t.ends_on and t.start_minute is null
        )
      order by s.calendar_position
    loop
      cur := st.start_minute;
      shift_end := least(st.end_minute, case when extract(isodow from d) = 7 then 1020 else 1200 end);
      while cur < shift_end loop
        key := d || ':' || st.id || ':' || cur;
        if pg_temp.rnd(key || ':idle') % 100 < 30 then
          cur := cur + 15 * (1 + pg_temp.rnd(key || ':gap') % 3);
          continue;
        end if;
        select sv.id, sv.duration_minutes into svc
        from public.staff_services ss
        join public.services sv on sv.id = ss.service_id
        where ss.staff_id = st.id and cur + sv.duration_minutes <= shift_end
          -- Clear of part-day time off (the dentist).
          and not exists (
            select 1 from public.staff_time_off t
            where t.staff_id = st.id and t.status = 'approved' and d between t.starts_on and t.ends_on
              and t.start_minute < cur + sv.duration_minutes and cur < t.end_minute
          )
        order by pg_temp.rnd(key || sv.id)
        limit 1;
        if not found then
          cur := cur + 15;
          continue;
        end if;
        v_start := (d + make_interval(mins => cur)) at time zone 'America/Chicago';
        v_end := v_start + make_interval(mins => svc.duration_minutes);
        v_status := case
          when v_end <= now() then (case when pg_temp.rnd(key || ':ns') % 100 < 3 then 'no_show' else 'completed' end)::public.appointment_status
          when v_start <= now() then 'checked_in'
          when pg_temp.rnd(key || ':c') % 100 < 50 then 'confirmed'
          else 'booked'
        end;
        insert into public.appointments (business_id, location_id, client_id, starts_at, ends_at, status, source, created_by, updated_by, created_at,
                                         checked_in_at, checked_out_at)
        values (v_business, v_location, ('e1000000-0000-4000-8000-' || lpad(to_hex(pg_temp.rnd(key || ':client') % 400), 12, '0'))::uuid,
                v_start, v_end, v_status, 'front_desk', v_desk, v_desk, least(v_start - interval '5 days', now()),
                case when v_status in ('completed', 'checked_in') then v_start - make_interval(mins => pg_temp.rnd(key || ':early') % 10) end,
                case when v_status = 'completed' then v_end + make_interval(mins => pg_temp.rnd(key || ':late') % 8) end)
        returning id into v_appointment;
        insert into public.appointment_items (business_id, location_id, appointment_id, service_id, staff_id, starts_at, ends_at,
                                              active_minutes, processing_minutes, finishing_minutes, price_cents)
        select v_business, v_location, v_appointment, sv.id, st.id, v_start, v_end, sv.active_minutes, sv.processing_minutes, sv.finishing_minutes,
               private.stylist_price(st.id, sv.id)
        from public.services sv where sv.id = svc.id;
        n := n + 1;
        cur := cur + svc.duration_minutes;
      end loop;
    end loop;
  end loop;
  raise notice 'Harbor & Vine: % appointments', n;
end;
$$;

-- Two saved views to start with, shared with everyone: the color team,
-- and nails and skin together.
insert into public.calendar_views (business_id, location_id, owner_staff_id, name, staff_ids, created_by)
select 'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', null, v.name,
       (select array_agg(('d1000000-0000-4000-8000-0000000000' || t.n)::uuid order by t.n) from team t where t.dept = any (v.depts)),
       'd1000000-0000-4000-8000-000000000001'
from (values ('Color team', array['color']), ('Nails & skin', array['nails', 'skin'])) as v (name, depts);
