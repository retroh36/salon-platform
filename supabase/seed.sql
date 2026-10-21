-- Local development seed: one fake salon. Runs on `npx supabase db reset`.
-- All people, emails and phone numbers are made up. Never put real client
-- or staff data here.
--
-- Logins (password for all: password123)
--   owner@mapleandash.test       owner
--   manager@mapleandash.test     manager
--   frontdesk@mapleandash.test   front desk
--   priya@mapleandash.test       stylist
--   marcus@mapleandash.test      stylist

-- ---------------------------------------------------------------------------
-- Auth users
-- ---------------------------------------------------------------------------

with seed_users (id, email) as (
  values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'owner@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'manager@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000003'::uuid, 'frontdesk@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'priya@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'marcus@mapleandash.test')
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
insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  now(), now(), now()
from inserted_users;

-- ---------------------------------------------------------------------------
-- Business and location
-- ---------------------------------------------------------------------------

insert into public.businesses (id, name, plan) values
  ('b0000000-0000-4000-8000-000000000001', 'Maple & Ash Hair Studio', 'trial');

insert into public.locations (
  id, business_id, name, address_line1, city, region, postal_code, country, phone, timezone
) values (
  'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'Maple & Ash Downtown',
  '123 Example Street', 'Springfield', 'IL', '62701', 'US', '(555) 010-0100',
  'America/Chicago'
);

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

insert into public.staff (
  id, business_id, location_id, user_id, first_name, last_name, email, phone, role, color, is_active
) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'Olivia', 'Bennett', 'owner@mapleandash.test', '(555) 010-0101', 'owner', '#7c3aed', true),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', 'Daniel', 'Okafor', 'manager@mapleandash.test', '(555) 010-0102', 'manager', '#2563eb', true),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000003', 'Sam', 'Rivera', 'frontdesk@mapleandash.test', '(555) 010-0103', 'front_desk', null, true),
  -- Six stylists; two have logins.
  ('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000004', 'Priya', 'Shah', 'priya@mapleandash.test', '(555) 010-0104', 'stylist', '#db2777', true),
  ('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000005', 'Marcus', 'Lee', 'marcus@mapleandash.test', '(555) 010-0105', 'stylist', '#059669', true),
  ('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   null, 'Hannah', 'Novak', 'hannah@mapleandash.test', '(555) 010-0106', 'stylist', '#ea580c', true),
  ('d0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   null, 'Jamal', 'Carter', 'jamal@mapleandash.test', '(555) 010-0107', 'stylist', '#0891b2', true),
  ('d0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   null, 'Sofia', 'Moreno', 'sofia@mapleandash.test', '(555) 010-0108', 'stylist', '#ca8a04', true),
  ('d0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   null, 'Ethan', 'Brooks', 'ethan@mapleandash.test', '(555) 010-0109', 'stylist', '#4f46e5', true);

-- ---------------------------------------------------------------------------
-- Services
-- active / processing / finishing minutes; price in cents.
-- ---------------------------------------------------------------------------

insert into public.services (
  business_id, category, name, active_minutes, processing_minutes, finishing_minutes, price_cents, description
)
select 'b0000000-0000-4000-8000-000000000001', category, name, active, processing, finishing, price, description
from (values
  ('Cuts', 'Women''s Cut & Style',        60,  0,  0,  8500, 'Consultation, shampoo, cut and blow-dry.'),
  ('Cuts', 'Men''s Cut',                  30,  0,  0,  4500, null),
  ('Cuts', 'Skin Fade',                   45,  0,  0,  5000, null),
  ('Cuts', 'Beard Trim',                  15,  0,  0,  2000, null),
  ('Cuts', 'Kids'' Cut (12 & under)',     30,  0,  0,  3500, null),
  ('Cuts', 'Bang Trim',                   15,  0,  0,  1500, 'Complimentary between cuts for existing clients.'),
  ('Cuts', 'Curly Cut',                   75,  0,  0, 11000, 'Dry cut, curl by curl, with diffused finish.'),
  ('Cuts', 'Restyle / Big Chop',          90,  0,  0, 12500, 'Major length or shape change.'),

  ('Color', 'Color Consultation',         15,  0,  0,     0, 'Required before first color service.'),
  ('Color', 'Root Touch-Up',              30, 35, 20,  9500, 'Up to 1 inch of regrowth.'),
  ('Color', 'All-Over Color',             45, 35, 25, 13000, null),
  ('Color', 'Gloss / Toner',              15, 20, 15,  5500, null),
  ('Color', 'Gray Blending',              30, 25, 20, 10500, null),
  ('Color', 'Men''s Gray Blending',       15, 15, 15,  4500, null),
  ('Color', 'Vivid / Fashion Color',      60, 30, 30, 18000, 'Pre-lightening priced separately.'),
  ('Color', 'Double Process (Bleach & Tone)', 60, 45, 45, 22000, null),
  ('Color', 'Color Correction',           60, 45, 60, 25000, 'Starting price; final quote after consultation.'),

  ('Highlights', 'Face-Frame Highlights', 30, 30, 20,  9500, null),
  ('Highlights', 'Partial Highlights',    45, 35, 30, 15000, null),
  ('Highlights', 'Full Highlights',       75, 35, 30, 19500, null),
  ('Highlights', 'Babylights',            90, 35, 30, 23000, null),
  ('Highlights', 'Lowlights',             45, 30, 25, 13500, null),
  ('Highlights', 'Highlight & Lowlight Combo', 90, 35, 30, 21500, null),

  ('Balayage', 'Root Smudge',             15, 20, 15,  6000, 'Add-on to any lightening service.'),
  ('Balayage', 'Mini Balayage',           45, 35, 30, 16500, null),
  ('Balayage', 'Balayage',                75, 40, 40, 25000, 'Includes toner and blow-dry.'),
  ('Balayage', 'Foilayage',               90, 40, 40, 27000, null),
  ('Balayage', 'Lived-In Color',          90, 40, 40, 28500, 'Balayage with root smudge and toner.'),

  ('Blowouts & Styling', 'Blowout',               45, 0, 0,  5500, null),
  ('Blowouts & Styling', 'Blowout (Long/Thick Hair)', 60, 0, 0, 7000, null),
  ('Blowouts & Styling', 'Silk Press',            90, 0, 0,  9500, null),
  ('Blowouts & Styling', 'Curls / Beach Waves',   45, 0, 0,  6000, null),
  ('Blowouts & Styling', 'Updo',                  60, 0, 0, 11000, null),
  ('Blowouts & Styling', 'Bridal Trial',          90, 0, 0, 15000, null),

  ('Treatments', 'Hydrating Mask Add-On',  5, 10,  5,  2500, null),
  ('Treatments', 'Deep Conditioning',     10, 15,  5,  3500, null),
  ('Treatments', 'Bond Repair Treatment', 10, 20, 10,  5000, null),
  ('Treatments', 'Scalp Treatment',       30,  0,  0,  4500, null),
  ('Treatments', 'Keratin Smoothing',     60, 30, 60, 30000, 'Lasts up to 4 months.'),
  ('Treatments', 'Brazilian Blowout',     45, 30, 60, 27500, null),
  ('Treatments', 'Perm',                  45, 30, 30, 14000, null)
) as s (category, name, active, processing, finishing, price, description);

-- No longer on the menu, to show how archived services look.
update public.services set archived_at = now()
where business_id = 'b0000000-0000-4000-8000-000000000001' and name = 'Perm';

-- ---------------------------------------------------------------------------
-- Who offers what
-- ---------------------------------------------------------------------------

with stylist (staff_id, categories, extra_services) as (
  values
    -- Priya: senior stylist, cuts and all color work
    ('d0000000-0000-4000-8000-000000000004'::uuid,
     array['Color', 'Highlights', 'Balayage'],
     array['Women''s Cut & Style', 'Curly Cut', 'Restyle / Big Chop', 'Bang Trim', 'Blowout', 'Bond Repair Treatment', 'Deep Conditioning']),
    -- Marcus: all-round cuts plus everyday color
    ('d0000000-0000-4000-8000-000000000005'::uuid,
     array['Cuts'],
     array['Root Touch-Up', 'All-Over Color', 'Gloss / Toner', 'Men''s Gray Blending', 'Color Consultation', 'Blowout']),
    -- Hannah: blowouts, styling and treatments
    ('d0000000-0000-4000-8000-000000000006'::uuid,
     array['Blowouts & Styling', 'Treatments'],
     array['Women''s Cut & Style', 'Bang Trim']),
    -- Jamal: barber
    ('d0000000-0000-4000-8000-000000000007'::uuid,
     array[]::text[],
     array['Men''s Cut', 'Skin Fade', 'Beard Trim', 'Kids'' Cut (12 & under)', 'Men''s Gray Blending', 'Scalp Treatment']),
    -- Sofia: color specialist
    ('d0000000-0000-4000-8000-000000000008'::uuid,
     array['Color', 'Highlights', 'Balayage'],
     array['Gloss / Toner', 'Bond Repair Treatment', 'Deep Conditioning', 'Hydrating Mask Add-On']),
    -- Ethan: junior stylist
    ('d0000000-0000-4000-8000-000000000009'::uuid,
     array[]::text[],
     array['Women''s Cut & Style', 'Men''s Cut', 'Kids'' Cut (12 & under)', 'Bang Trim', 'Blowout', 'Blowout (Long/Thick Hair)', 'Curls / Beach Waves', 'Deep Conditioning', 'Gloss / Toner'])
)
insert into public.staff_services (business_id, staff_id, service_id)
select distinct sv.business_id, st.staff_id, sv.id
from stylist st
join public.services sv
  on sv.business_id = 'b0000000-0000-4000-8000-000000000001'
 and sv.archived_at is null
 and (sv.category = any (st.categories) or sv.name = any (st.extra_services));

-- Per-stylist prices: Priya and Sofia charge senior rates for color; Ethan
-- charges junior rates.
update public.staff_services ss
set price_cents = round(sv.price_cents * 1.15 / 500) * 500
from public.services sv
where sv.id = ss.service_id
  and ss.staff_id in ('d0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000008')
  and sv.category in ('Color', 'Highlights', 'Balayage')
  and sv.price_cents > 0;

update public.staff_services ss
set price_cents = round(sv.price_cents * 0.8 / 500) * 500
from public.services sv
where sv.id = ss.service_id
  and ss.staff_id = 'd0000000-0000-4000-8000-000000000009'
  and sv.price_cents > 0;

-- ---------------------------------------------------------------------------
-- Clients (500). Deterministic: values are picked by hashing the row number,
-- so every reset gives the same clients. Phone numbers use the 555-0100 to
-- 555-0199 range reserved for fiction; emails use example.com.
-- ---------------------------------------------------------------------------

with
first_names (a) as (select array[
  'Emma','Olivia','Ava','Sophia','Isabella','Mia','Charlotte','Amelia','Harper','Evelyn',
  'Abigail','Emily','Ella','Elizabeth','Camila','Luna','Sofia','Avery','Mila','Aria',
  'Scarlett','Penelope','Layla','Chloe','Victoria','Madison','Eleanor','Grace','Nora','Riley',
  'Zoey','Hannah','Hazel','Lily','Ellie','Violet','Lillian','Zoe','Stella','Aurora',
  'Natalie','Emilia','Everly','Leah','Aubrey','Willow','Addison','Lucy','Audrey','Bella',
  'Liam','Noah','Oliver','Elijah','James','William','Benjamin','Lucas','Henry','Theodore',
  'Mateo','Daniel','Michael','Jackson','Sebastian','Aiden','Samuel','Jayden','Carter','Wyatt',
  'Maya','Priyanka','Aisha','Fatima','Mei','Yuki','Ananya','Leilani','Ximena','Valentina'
]),
last_names (a) as (select array[
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
  'Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin',
  'Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson',
  'Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores',
  'Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts',
  'Patel','Kim','Chen','Singh','Okafor','Kowalski','Novak','Haddad','Yamamoto','O''Brien'
]),
area_codes (a) as (select array['312', '773', '630', '708', '847']),
preferences (a) as (select array[
  'Prefers a quiet appointment.', 'Likes sparkling water.', 'Morning appointments only.',
  'Sensitive scalp; gentle shampoo.', 'Prefers text reminders over calls.', 'Likes to chat; ask about her dogs.',
  'Runs late often; book a 10-minute buffer.', 'Wants low-maintenance styles.', 'Always books the next visit at checkout.',
  'Prefers fragrance-free products.', 'Saturday appointments only.', 'Likes a scalp massage during the wash.'
]),
notes (a) as (select array[
  'Referred by a friend.', 'Wedding in June; plan a trial in April.', 'Growing out bangs.',
  'Moving to blonde gradually over several visits.', 'Uses a sulfate-free shampoo at home.',
  'Swims regularly; recommend a clarifying treatment.', 'Hair is fine and breaks easily; avoid high heat.',
  'Interested in a keratin smoothing treatment.', 'Gift card holder.', 'Bought a Bond Repair kit last visit.'
]),
allergies (a) as (select array[
  'PPD sensitivity: patch test 48 hours before any color.', 'Latex allergy: use nitrile gloves.',
  'Fragrance sensitivity.', 'Nickel allergy: avoid metal clips.', 'Reacted to ammonia color in the past.',
  'Eczema on scalp; avoid harsh products.'
]),
stylists (a) as (select array[
  'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000005',
  'd0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000007',
  'd0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000009'
]::uuid[]),
rows as (
  select
    i,
    -- Stable pseudo-random number 0..9999 per row and purpose.
    (abs(hashtext('client' || i || ':' || p)) % 10000) as h,
    p
  from generate_series(0, 499) as i, unnest(array['first','last','email','phone','pref','prefv','note','notev','allergy','allergyv','stylist','stylistv','consent','consentd','sms','mail','created']) as p
),
r as (
  select i, jsonb_object_agg(p, h) as h from rows group by i
)
insert into public.clients (
  id, business_id, first_name, last_name, email, phone, preferred_staff_id, preferences, notes, allergies,
  sms_opt_in, email_opt_in, consent_signed_on, created_at
)
select
  ('e0000000-0000-4000-8000-' || lpad(to_hex(r.i), 12, '0'))::uuid,
  'b0000000-0000-4000-8000-000000000001',
  f.first_name,
  l.last_name,
  case when (r.h->>'email')::int % 100 < 80
    then lower(regexp_replace(f.first_name || '.' || l.last_name, '[^A-Za-z.]', '', 'g')) || r.i || '@example.com' end,
  case when (r.h->>'phone')::int % 100 < 95
    then '(' || (select a from area_codes)[r.i / 100 + 1] || ') 555-01' || lpad((r.i % 100)::text, 2, '0') end,
  case when (r.h->>'stylist')::int % 100 < 50
    then (select a from stylists)[(r.h->>'stylistv')::int % 6 + 1] end,
  case when (r.h->>'pref')::int % 100 < 40
    then (select a from preferences)[(r.h->>'prefv')::int % 12 + 1] end,
  case when (r.h->>'note')::int % 100 < 30
    then (select a from notes)[(r.h->>'notev')::int % 10 + 1] end,
  case when (r.h->>'allergy')::int % 100 < 8
    then (select a from allergies)[(r.h->>'allergyv')::int % 6 + 1] end,
  (r.h->>'sms')::int % 100 < 70,
  (r.h->>'mail')::int % 100 < 55,
  case when (r.h->>'consent')::int % 100 < 60
    then current_date - ((r.h->>'consentd')::int % 700) end,
  now() - make_interval(days => (r.h->>'created')::int % 1000)
from r
cross join lateral (select (select a from first_names)[(r.h->>'first')::int % 80 + 1] as first_name) f
cross join lateral (select (select a from last_names)[(r.h->>'last')::int % 60 + 1] as last_name) l;

-- ---------------------------------------------------------------------------
-- Color formula history for about a third of clients, written by the
-- colorists (Priya, Sofia, Marcus), roughly every 6 to 8 weeks.
-- ---------------------------------------------------------------------------

with
formulas (a) as (select array[
  'Roots: Redken Shades EQ 6N + 6NB (1:1), 20 vol, 35 min.',
  'All over: Wella Koleston 7/0 + 7/1 (2:1), 20 vol, 35 min. Gloss ends: Shades EQ 09V, 20 min.',
  'Partial foils: Blondor + 20 vol, 40 min. Tone: Shades EQ 09T + 09V (1:1), 20 min.',
  'Balayage: Lightener + 20 vol, open-air 45 min. Root smudge: Shades EQ 07N, 15 min.',
  'Gray blending: Goldwell Topchic 6NN + 7NN (1:1), 20 vol, 30 min.',
  'Gloss: Shades EQ 08GI, processing solution, 20 min.',
  'Full highlights: Blondor + 30 vol, 40 min. Tone: Wella T18, 15 min.',
  'Lowlights: Shades EQ 06NB, 20 min, in alternating foils.',
  'Vivid: Pre-lighten to level 9. Pulp Riot Mercury + Clear (1:3), 25 min.',
  'Root touch-up: L''Oréal Majirel 5.0 + 6.3 (1:1), 20 vol, 35 min.',
  'Face frame: Blondor + 20 vol, 35 min. Toner: Shades EQ 010P, 15 min.',
  'Bond repair added to lightener (Olaplex No.1). Gloss: Shades EQ 09N, 20 min.'
]),
form_notes (a) as (select array[
  null, null, null, 'Lifted fast; check at 30 minutes next time.', 'Client wants it a touch cooler next visit.',
  'Patch test done; no reaction.', 'Used extra toner on the crown.', 'Happy with result.'
]),
colorists (a) as (select array[
  'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000008',
  'd0000000-0000-4000-8000-000000000005'
]::uuid[]),
color_clients as (
  select c.id, abs(hashtext('formula' || c.id)) as h
  from public.clients c
  where c.business_id = 'b0000000-0000-4000-8000-000000000001'
    and abs(hashtext('has-formula' || c.id)) % 100 < 35
)
insert into public.client_formulas (business_id, client_id, staff_id, visit_date, formula, notes, created_at)
select
  'b0000000-0000-4000-8000-000000000001',
  cc.id,
  (select a from colorists)[(cc.h + n) % 3 + 1],
  current_date - (n * (42 + cc.h % 15) + cc.h % 20),
  (select a from formulas)[(cc.h / 7 + n * 5) % 12 + 1],
  (select a from form_notes)[(cc.h / 3 + n) % 8 + 1],
  now() - make_interval(days => n * (42 + cc.h % 15) + cc.h % 20)
from color_clients cc
cross join lateral generate_series(0, cc.h % 5) as n;

-- ---------------------------------------------------------------------------
-- Opening hours and staff schedules. Times are local to the location
-- (America/Chicago). Weekdays: 1 = Monday ... 7 = Sunday.
-- ---------------------------------------------------------------------------

-- Closed Mondays and Sundays.
insert into public.location_hours (business_id, location_id, weekday, start_minute, end_minute)
select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', weekday,
       extract(epoch from opens::time) / 60, extract(epoch from closes::time) / 60
from (values
  (2, '09:00', '19:00'),
  (3, '09:00', '19:00'),
  (4, '09:00', '20:00'),
  (5, '09:00', '20:00'),
  (6, '08:00', '17:00')
) as h (weekday, opens, closes);

update public.staff s set level = l.level::public.staff_level
from (values
  ('d0000000-0000-4000-8000-000000000004', 'master'), -- Priya
  ('d0000000-0000-4000-8000-000000000005', 'senior'), -- Marcus
  ('d0000000-0000-4000-8000-000000000006', 'senior'), -- Hannah
  ('d0000000-0000-4000-8000-000000000007', 'senior'), -- Jamal
  ('d0000000-0000-4000-8000-000000000008', 'senior'), -- Sofia
  ('d0000000-0000-4000-8000-000000000009', 'junior')  -- Ethan
) as l (id, level)
where s.id = l.id::uuid;

-- Weekly hours. Two rows on the same day make a split shift.
insert into public.staff_working_hours (business_id, staff_id, weekday, start_minute, end_minute)
select 'b0000000-0000-4000-8000-000000000001', staff_id::uuid, weekday,
       extract(epoch from starts::time) / 60, extract(epoch from ends::time) / 60
from (values
  -- Olivia (owner): mid-week, mostly admin
  ('d0000000-0000-4000-8000-000000000001', 2, '10:00', '16:00'),
  ('d0000000-0000-4000-8000-000000000001', 3, '10:00', '16:00'),
  ('d0000000-0000-4000-8000-000000000001', 4, '10:00', '16:00'),
  -- Daniel (manager)
  ('d0000000-0000-4000-8000-000000000002', 2, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000002', 3, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000002', 4, '11:00', '20:00'),
  ('d0000000-0000-4000-8000-000000000002', 5, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000002', 6, '08:00', '14:00'),
  -- Sam (front desk)
  ('d0000000-0000-4000-8000-000000000003', 2, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000003', 3, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000003', 5, '12:00', '20:00'),
  ('d0000000-0000-4000-8000-000000000003', 6, '08:00', '17:00'),
  -- Priya (master): split shifts with a lunch break, short Saturday
  ('d0000000-0000-4000-8000-000000000004', 2, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000004', 2, '14:00', '18:00'),
  ('d0000000-0000-4000-8000-000000000004', 3, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000004', 3, '14:00', '18:00'),
  ('d0000000-0000-4000-8000-000000000004', 5, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000004', 5, '14:00', '18:00'),
  ('d0000000-0000-4000-8000-000000000004', 6, '08:00', '14:00'),
  -- Marcus: Wednesday to Saturday
  ('d0000000-0000-4000-8000-000000000005', 3, '10:00', '19:00'),
  ('d0000000-0000-4000-8000-000000000005', 4, '10:00', '19:00'),
  ('d0000000-0000-4000-8000-000000000005', 5, '10:00', '19:00'),
  ('d0000000-0000-4000-8000-000000000005', 6, '08:00', '17:00'),
  -- Hannah: late shifts and Saturday (busy for blowouts and updos)
  ('d0000000-0000-4000-8000-000000000006', 4, '12:00', '20:00'),
  ('d0000000-0000-4000-8000-000000000006', 5, '12:00', '20:00'),
  ('d0000000-0000-4000-8000-000000000006', 6, '08:00', '17:00'),
  -- Jamal: Tuesday to Saturday, late on Thursday
  ('d0000000-0000-4000-8000-000000000007', 2, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000007', 3, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000007', 4, '11:00', '20:00'),
  ('d0000000-0000-4000-8000-000000000007', 5, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000007', 6, '08:00', '15:00'),
  -- Sofia: color days, split Friday, no Saturdays
  ('d0000000-0000-4000-8000-000000000008', 2, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000008', 3, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000008', 4, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000008', 5, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000008', 5, '14:00', '20:00'),
  -- Ethan (junior): full week with a half-hour lunch
  ('d0000000-0000-4000-8000-000000000009', 2, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000009', 2, '13:30', '17:30'),
  ('d0000000-0000-4000-8000-000000000009', 3, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000009', 3, '13:30', '17:30'),
  ('d0000000-0000-4000-8000-000000000009', 4, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000009', 4, '13:30', '17:30'),
  ('d0000000-0000-4000-8000-000000000009', 5, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000009', 5, '13:30', '17:30'),
  ('d0000000-0000-4000-8000-000000000009', 6, '08:00', '16:00')
) as h (staff_id, weekday, starts, ends);

-- Commission for stylists, by level.
insert into public.staff_compensation (staff_id, business_id, service_commission_pct, retail_commission_pct)
select s.id, s.business_id,
       case s.level when 'master' then 50 when 'senior' then 45 else 35 end,
       case s.level when 'junior' then 10 else 15 end
from public.staff s
where s.business_id = 'b0000000-0000-4000-8000-000000000001' and s.role = 'stylist';

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
  -- Sofia: a week's vacation, the week after next (approved by Olivia)
  ('d0000000-0000-4000-8000-000000000008', d.next_monday + 7, d.next_monday + 13, null::int, null::int,
   'vacation', 'Family trip', 'approved', 'd0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000001'),
  -- Marcus: called in sick yesterday (entered by Daniel)
  ('d0000000-0000-4000-8000-000000000005', d.today - 1, d.today - 1, null, null,
   'sick', null, 'approved', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002'),
  -- Hannah: dentist next Thursday afternoon
  ('d0000000-0000-4000-8000-000000000006', d.next_monday + 3, d.next_monday + 3, 14 * 60, 16 * 60,
   'personal', 'Dentist', 'approved', 'd0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000002'),
  -- Ethan: a pending request for the Friday after next
  ('d0000000-0000-4000-8000-000000000009', d.next_monday + 11, d.next_monday + 11, null, null,
   'personal', 'Sister''s graduation', 'requested', 'd0000000-0000-4000-8000-000000000009', null),
  -- Priya: a declined request (shows the history)
  ('d0000000-0000-4000-8000-000000000004', d.next_monday + 5, d.next_monday + 5, null, null,
   'personal', 'Long weekend', 'declined', 'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001')
) as t (staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status, requested_by, decided_by);

-- Jamal covers a late Friday next week, 12:00 to 20:00 instead of 9 to 5.
insert into public.staff_schedule_overrides (business_id, staff_id, on_date, start_minute, end_minute)
select 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000007',
       (now() at time zone 'America/Chicago')::date
         + (8 - extract(isodow from (now() at time zone 'America/Chicago')::date))::int + 4,
       12 * 60, 20 * 60;
