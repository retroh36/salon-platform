-- The public demo only (npm run demo:db -- reset, after seed.sql and before
-- seed-demo.sql): Maple & Ash opens on Sundays and Mondays too, so a tester
-- never lands on "The salon is closed today". seed-demo.sql books visits
-- within the salon's and each stylist's hours, so these days fill up like
-- the rest. Harbor & Vine (seed-large.sql) is open every day already.
-- Never loaded locally or by the tests, which rely on the real hours
-- (closed Sundays and Mondays).

insert into public.location_hours (business_id, location_id, weekday, start_minute, end_minute)
select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', weekday,
       extract(epoch from opens::time) / 60, extract(epoch from closes::time) / 60
from (values
  (1, '09:00', '18:00'),
  (7, '10:00', '17:00')
) as h (weekday, opens, closes);

-- A smaller crew on those days, Bridget (the demo's stylist login) on both.
insert into public.staff_working_hours (business_id, staff_id, weekday, start_minute, end_minute)
select 'b0000000-0000-4000-8000-000000000001', staff_id::uuid, weekday,
       extract(epoch from starts::time) / 60, extract(epoch from ends::time) / 60
from (values
  -- Monday
  ('d0000000-0000-4000-8000-000000000002', 1, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000003', 1, '09:00', '18:00'),
  ('d0000000-0000-4000-8000-000000000004', 1, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000004', 1, '14:00', '18:00'),
  ('d0000000-0000-4000-8000-000000000005', 1, '10:00', '18:00'),
  ('d0000000-0000-4000-8000-000000000007', 1, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000008', 1, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000009', 1, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000009', 1, '13:00', '17:00'),
  -- Sunday
  ('d0000000-0000-4000-8000-000000000003', 7, '10:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000004', 7, '10:00', '16:00'),
  ('d0000000-0000-4000-8000-000000000005', 7, '10:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000006', 7, '10:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000009', 7, '10:00', '16:00'),
  ('d0000000-0000-4000-8000-000000000010', 7, '11:00', '17:00')
) as w (staff_id, weekday, starts, ends);
