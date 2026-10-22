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
  'Roots: Redken Shades EQ 06NB + 07N (1:1), processing solution, 20 min.',
  'All over: Goldwell Topchic 7N + 7G (2:1), 20 vol, 35 min. Gloss ends: Shades EQ 09V, 20 min.',
  'Partial foils: Blondor + 20 vol, 40 min. Tone: Shades EQ 09T + 09V (1:1), 20 min.',
  'Balayage: Blondor + 20 vol, open-air 45 min. Root smudge: Shades EQ 07N, 15 min.',
  'Gray blending: Goldwell Topchic 6NN + 7NN (1:1), 20 vol, 30 min.',
  'Gloss: Shades EQ 08GI, processing solution, 20 min.',
  'Full highlights: Blondor + 30 vol, 40 min. Tone: Color Charm T18, 15 min.',
  'Lowlights: Shades EQ 06NB, 20 min, in alternating foils.',
  'Vivid: Pre-lighten to level 9. Pulp Riot Mercury + Clear (1:3), 25 min.',
  'Root touch-up: Goldwell Topchic 5N + 6N (1:1), 20 vol, 35 min.',
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

-- ---------------------------------------------------------------------------
-- Resources: a chair for each stylist plus two spares, Jamal's barber
-- station and a treatment room for smoothing treatments.
-- ---------------------------------------------------------------------------

insert into public.resources (id, business_id, location_id, name, kind, sort_order)
select ('f0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', name, kind::public.resource_kind, n
from (values
  (1, 'Chair 1', 'chair'), (2, 'Chair 2', 'chair'), (3, 'Chair 3', 'chair'), (4, 'Chair 4', 'chair'),
  (5, 'Chair 5', 'chair'), (6, 'Chair 6', 'chair'), (7, 'Chair 7', 'chair'),
  (8, 'Barber Station', 'station'), (9, 'Treatment Room', 'room')
) as r (n, name, kind);

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
        ('d0000000-0000-4000-8000-000000000009'::uuid, 'f0000000-0000-4000-8000-000000000005'::uuid, 6)
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

-- ---------------------------------------------------------------------------
-- Inventory: three suppliers, back-bar color (by weight or volume, so
-- partly used tubes count) and retail (by unit). Stock was last counted
-- three weeks ago; a few things are already low.
-- ---------------------------------------------------------------------------

insert into public.suppliers (id, business_id, name, email, phone, account_number, lead_time_days, notes) values
  ('e1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Northline Beauty Supply',
   'orders@northline.example.com', '(555) 010-0201', 'NBS-20417', 2, 'Color, developer and lightener. Order by 2pm for delivery in two days.'),
  ('e1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Prairie Pro Distributors',
   'salon@prairiepro.example.com', '(555) 010-0202', 'PPD-8812', 4, 'Olaplex and Redken retail. Free shipping over $300.'),
  ('e1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Lakeshore Salon Wholesale',
   'hello@lakeshore.example.com', '(555) 010-0203', null, 3, 'Back-bar liters, toners and styling.');

with items (supplier, brand, line, name, type, unit, size, cost, price, shelf, sku, containers, reorder_containers, reorder_qty) as (values
  -- Permanent color: 60 g tubes.
  (1, 'Goldwell', 'Topchic', '4N',  'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-4N',  3.5, 2, 4),
  (1, 'Goldwell', 'Topchic', '5N',  'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-5N',  4.25, 2, 4),
  (1, 'Goldwell', 'Topchic', '6N',  'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-6N',  5.5, 3, 6),
  (1, 'Goldwell', 'Topchic', '6NN', 'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-6NN', 3.0, 2, 4),
  (1, 'Goldwell', 'Topchic', '7N',  'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-7N',  2.4, 3, 6),
  (1, 'Goldwell', 'Topchic', '7NN', 'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-7NN', 2.75, 2, 4),
  (1, 'Goldwell', 'Topchic', '8N',  'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-8N',  4.0, 2, 4),
  (1, 'Goldwell', 'Topchic', '9N',  'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-9N',  3.6, 2, 4),
  (1, 'Goldwell', 'Topchic', '10N', 'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-10N', 2.0, 1, 3),
  (1, 'Goldwell', 'Topchic', '6RR', 'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-6RR', 1.5, 1, 2),
  (1, 'Goldwell', 'Topchic', '7G',  'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-7G',  2.2, 1, 3),
  (1, 'Goldwell', 'Topchic', '8A',  'back_bar', 'g', 60, 950, null, 'Color bar A', 'GW-TC-8A',  1.8, 1, 3),
  -- Demi-permanent gloss: 60 ml bottles.
  (1, 'Redken', 'Shades EQ', '06NB',  'back_bar', 'ml', 60, 1125, null, 'Color bar B', 'RK-EQ-06NB', 3.0, 2, 4),
  (1, 'Redken', 'Shades EQ', '07N',   'back_bar', 'ml', 60, 1125, null, 'Color bar B', 'RK-EQ-07N',  2.5, 2, 4),
  (1, 'Redken', 'Shades EQ', '08GI',  'back_bar', 'ml', 60, 1125, null, 'Color bar B', 'RK-EQ-08GI', 3.4, 2, 4),
  (1, 'Redken', 'Shades EQ', '09N',   'back_bar', 'ml', 60, 1125, null, 'Color bar B', 'RK-EQ-09N',  2.8, 2, 4),
  (1, 'Redken', 'Shades EQ', '09T',   'back_bar', 'ml', 60, 1125, null, 'Color bar B', 'RK-EQ-09T',  1.6, 2, 4),
  (1, 'Redken', 'Shades EQ', '09V',   'back_bar', 'ml', 60, 1125, null, 'Color bar B', 'RK-EQ-09V',  4.5, 2, 4),
  (1, 'Redken', 'Shades EQ', '010P',  'back_bar', 'ml', 60, 1125, null, 'Color bar B', 'RK-EQ-010P', 2.3, 1, 3),
  (1, 'Redken', 'Shades EQ', 'Clear', 'back_bar', 'ml', 60, 1125, null, 'Color bar B', 'RK-EQ-CLR',  3.0, 2, 4),
  (1, 'Redken', 'Shades EQ', 'Processing Solution', 'back_bar', 'ml', 1000, 1600, null, 'Developer shelf', 'RK-EQ-PS', 1.4, 1, 2),
  -- Developers, one per volume: 1 liter bottles.
  (1, 'Goldwell', 'Topchic', '10 Vol Developer (3%)', 'back_bar', 'ml', 1000, 1400, null, 'Developer shelf', 'GW-DEV-10', 1.6, 1, 2),
  (1, 'Goldwell', 'Topchic', '20 Vol Developer (6%)', 'back_bar', 'ml', 1000, 1400, null, 'Developer shelf', 'GW-DEV-20', 2.3, 2, 4),
  (1, 'Goldwell', 'Topchic', '30 Vol Developer (9%)', 'back_bar', 'ml', 1000, 1400, null, 'Developer shelf', 'GW-DEV-30', 1.2, 1, 2),
  (1, 'Goldwell', 'Topchic', '40 Vol Developer (12%)', 'back_bar', 'ml', 1000, 1400, null, 'Developer shelf', 'GW-DEV-40', 0.8, 0.5, 1),
  -- Lighteners.
  (1, 'Wella', 'Blondor', 'Multi Blonde Powder', 'back_bar', 'g', 800, 3800, null, 'Lightener shelf', 'WE-BLD-800', 1.3, 1, 2),
  (1, 'Redken', 'Flash Lift', 'Bonder Inside Lightener', 'back_bar', 'g', 500, 3400, null, 'Lightener shelf', 'RK-FL-500', 0.9, 1, 2),
  -- Toners: 42 ml bottles.
  (3, 'Wella', 'Color Charm', 'T18 Lightest Ash Blonde', 'back_bar', 'ml', 42, 650, null, 'Color bar B', 'WE-CC-T18', 3.0, 2, 6),
  (3, 'Wella', 'Color Charm', 'T14 Pale Ash Blonde',     'back_bar', 'ml', 42, 650, null, 'Color bar B', 'WE-CC-T14', 2.5, 2, 6),
  (3, 'Wella', 'Color Charm', 'T11 Lightest Beige Blonde', 'back_bar', 'ml', 42, 650, null, 'Color bar B', 'WE-CC-T11', 1.0, 1, 4),
  -- Back-bar treatments and wash.
  (2, 'Olaplex', null, 'No.1 Bond Multiplier', 'back_bar', 'ml', 525, 9500, null, 'Back bar', 'OLX-1-525', 0.7, 0.5, 1),
  (2, 'Olaplex', null, 'No.2 Bond Perfector', 'back_bar', 'ml', 2000, 16500, null, 'Back bar', 'OLX-2-2000', 0.6, 0.25, 1),
  (3, 'Redken', 'All Soft', 'Shampoo (back bar)', 'back_bar', 'ml', 1000, 2800, null, 'Back bar', 'RK-AS-SH-1L', 2.2, 1, 3),
  (3, 'Redken', 'All Soft', 'Conditioner (back bar)', 'back_bar', 'ml', 1000, 3000, null, 'Back bar', 'RK-AS-CO-1L', 1.8, 1, 3),
  (3, 'Redken', 'Acidic Bonding Concentrate', 'Intensive Treatment (back bar)', 'back_bar', 'ml', 500, 3600, null, 'Back bar', 'RK-ABC-TR-500', 0.4, 0.5, 2),
  -- Retail.
  (2, 'Olaplex', null, 'No.3 Hair Perfector 100 ml',     'retail', 'unit', 1, 1500, 3000, 'Retail wall', 'OLX-3-100', 9, 4, 12),
  (2, 'Olaplex', null, 'No.4 Bond Maintenance Shampoo 250 ml', 'retail', 'unit', 1, 1500, 3000, 'Retail wall', 'OLX-4-250', 6, 4, 12),
  (2, 'Olaplex', null, 'No.5 Bond Maintenance Conditioner 250 ml', 'retail', 'unit', 1, 1500, 3000, 'Retail wall', 'OLX-5-250', 3, 4, 12),
  (2, 'Olaplex', null, 'No.7 Bonding Oil 30 ml',         'retail', 'unit', 1, 1500, 3000, 'Retail wall', 'OLX-7-30', 7, 3, 6),
  (2, 'Redken', 'All Soft', 'Shampoo 300 ml',            'retail', 'unit', 1, 1400, 2800, 'Retail wall', 'RK-AS-SH-300', 8, 4, 8),
  (2, 'Redken', 'All Soft', 'Conditioner 300 ml',        'retail', 'unit', 1, 1500, 2900, 'Retail wall', 'RK-AS-CO-300', 5, 4, 8),
  (2, 'Redken', 'Acidic Bonding Concentrate', 'Shampoo 300 ml', 'retail', 'unit', 1, 1600, 3200, 'Retail wall', 'RK-ABC-SH-300', 4, 3, 6),
  (2, 'Redken', 'Acidic Bonding Concentrate', 'Conditioner 300 ml', 'retail', 'unit', 1, 1600, 3200, 'Retail wall', 'RK-ABC-CO-300', 2, 3, 6),
  (2, 'Redken', null, 'Pillow Proof Blowdry Primer 170 ml', 'retail', 'unit', 1, 1300, 2600, 'Styling shelf', 'RK-PP-170', 6, 3, 6),
  (2, 'Redken', null, 'Shape Control 9 Hairspray 250 ml', 'retail', 'unit', 1, 1200, 2400, 'Styling shelf', 'RK-SC9-250', 5, 3, 6),
  (3, 'Bumble and bumble', null, 'Thickening Dryspun Finish 150 ml', 'retail', 'unit', 1, 1900, 3800, 'Styling shelf', 'BB-TDF-150', 1, 2, 4),
  (3, 'Bumble and bumble', null, 'Surf Spray 125 ml', 'retail', 'unit', 1, 1700, 3400, 'Styling shelf', 'BB-SURF-125', 4, 2, 4)
),
inserted as (
  insert into public.products (business_id, supplier_id, brand, line, name, sku, barcode, type, unit, size, cost_cents, price_cents, shelf)
  select 'b0000000-0000-4000-8000-000000000001',
         ('e1000000-0000-4000-8000-00000000000' || i.supplier)::uuid,
         i.brand, i.line, i.name, i.sku,
         -- In-store (GS1 prefix 2) codes, so they can't clash with real products.
         '2' || lpad((abs(hashtext(i.sku)) % 100000000000)::text, 11, '0'),
         i.type::public.product_type, i.unit::public.product_unit, i.size, i.cost, i.price, i.shelf
  from items i
  returning id, sku, size, unit
),
levels as (
  insert into public.stock_levels (business_id, location_id, product_id, on_hand, reorder_point, reorder_quantity)
  select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', p.id,
         round(i.containers * p.size, 2), round(i.reorder_containers * p.size, 2), i.reorder_qty
  from inserted p join items i on i.sku = p.sku
  returning product_id, on_hand
)
-- The last count, three weeks ago (entered by Daniel).
insert into public.stock_movements (business_id, location_id, product_id, change, on_hand_after, reason, note, created_by, created_at)
select 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', l.product_id, l.on_hand, l.on_hand,
       'count', 'Opening count', 'd0000000-0000-4000-8000-000000000002', now() - interval '21 days'
from levels l
where l.on_hand <> 0;

-- The products and amounts in the seeded formulas (the vivid uses a brand
-- the salon doesn't stock, so it has none).
with lines (formula, sku, amount, n) as (values
  ('Roots: Redken Shades EQ 06NB%', 'RK-EQ-06NB', 30, 1), ('Roots: Redken Shades EQ 06NB%', 'RK-EQ-07N', 30, 2), ('Roots: Redken Shades EQ 06NB%', 'RK-EQ-PS', 60, 3),
  ('All over: Goldwell Topchic 7N%', 'GW-TC-7N', 40, 4), ('All over: Goldwell Topchic 7N%', 'GW-TC-7G', 20, 5), ('All over: Goldwell Topchic 7N%', 'GW-DEV-20', 60, 6),
  ('All over: Goldwell Topchic 7N%', 'RK-EQ-09V', 30, 7), ('All over: Goldwell Topchic 7N%', 'RK-EQ-PS', 30, 8),
  ('Partial foils%', 'WE-BLD-800', 40, 9), ('Partial foils%', 'GW-DEV-20', 80, 10), ('Partial foils%', 'RK-EQ-09T', 20, 11), ('Partial foils%', 'RK-EQ-09V', 20, 12), ('Partial foils%', 'RK-EQ-PS', 40, 13),
  ('Balayage: Blondor%', 'WE-BLD-800', 50, 14), ('Balayage: Blondor%', 'GW-DEV-20', 100, 15), ('Balayage: Blondor%', 'RK-EQ-07N', 30, 16), ('Balayage: Blondor%', 'RK-EQ-PS', 30, 17),
  ('Gray blending%', 'GW-TC-6NN', 30, 18), ('Gray blending%', 'GW-TC-7NN', 30, 19), ('Gray blending%', 'GW-DEV-20', 60, 20),
  ('Gloss: Shades EQ 08GI%', 'RK-EQ-08GI', 60, 21), ('Gloss: Shades EQ 08GI%', 'RK-EQ-PS', 60, 22),
  ('Full highlights%', 'WE-BLD-800', 60, 23), ('Full highlights%', 'GW-DEV-30', 120, 24), ('Full highlights%', 'WE-CC-T18', 42, 25),
  ('Lowlights%', 'RK-EQ-06NB', 40, 26), ('Lowlights%', 'RK-EQ-PS', 40, 27),
  ('Root touch-up%', 'GW-TC-5N', 30, 28), ('Root touch-up%', 'GW-TC-6N', 30, 29), ('Root touch-up%', 'GW-DEV-20', 60, 30),
  ('Face frame%', 'WE-BLD-800', 30, 31), ('Face frame%', 'GW-DEV-20', 60, 32), ('Face frame%', 'RK-EQ-010P', 30, 33), ('Face frame%', 'RK-EQ-PS', 30, 34),
  ('Bond repair added%', 'WE-BLD-800', 40, 35), ('Bond repair added%', 'GW-DEV-20', 80, 36), ('Bond repair added%', 'OLX-1-525', 7.5, 37),
  ('Bond repair added%', 'RK-EQ-09N', 60, 38), ('Bond repair added%', 'RK-EQ-PS', 60, 39)
)
insert into public.formula_products (business_id, formula_id, product_id, amount, position)
select f.business_id, f.id, p.id, l.amount, row_number() over (partition by f.id order by l.n)
from public.client_formulas f
join lines l on f.formula like l.formula
join public.products p on p.sku = l.sku and p.business_id = f.business_id;

-- Default product recipes, for services without a formula.
with recipes (service, sku, amount) as (values
  ('Root Touch-Up', 'GW-TC-6N', 40), ('Root Touch-Up', 'GW-DEV-20', 40),
  ('All-Over Color', 'GW-TC-6N', 60), ('All-Over Color', 'GW-DEV-20', 60),
  ('Gloss / Toner', 'RK-EQ-09V', 60), ('Gloss / Toner', 'RK-EQ-PS', 60),
  ('Gray Blending', 'GW-TC-7NN', 40), ('Gray Blending', 'GW-DEV-10', 40),
  ('Men''s Gray Blending', 'GW-TC-6NN', 20), ('Men''s Gray Blending', 'GW-DEV-10', 20),
  ('Double Process (Bleach & Tone)', 'WE-BLD-800', 60), ('Double Process (Bleach & Tone)', 'GW-DEV-30', 120), ('Double Process (Bleach & Tone)', 'WE-CC-T18', 42),
  ('Face-Frame Highlights', 'WE-BLD-800', 20), ('Face-Frame Highlights', 'GW-DEV-20', 40),
  ('Partial Highlights', 'WE-BLD-800', 40), ('Partial Highlights', 'GW-DEV-20', 80),
  ('Full Highlights', 'WE-BLD-800', 60), ('Full Highlights', 'GW-DEV-20', 120),
  ('Babylights', 'WE-BLD-800', 50), ('Babylights', 'GW-DEV-20', 100),
  ('Lowlights', 'RK-EQ-06NB', 60), ('Lowlights', 'RK-EQ-PS', 60),
  ('Root Smudge', 'RK-EQ-07N', 40), ('Root Smudge', 'RK-EQ-PS', 40),
  ('Mini Balayage', 'WE-BLD-800', 30), ('Mini Balayage', 'GW-DEV-20', 60),
  ('Balayage', 'WE-BLD-800', 50), ('Balayage', 'GW-DEV-20', 100),
  ('Foilayage', 'WE-BLD-800', 50), ('Foilayage', 'GW-DEV-20', 100),
  ('Lived-In Color', 'WE-BLD-800', 40), ('Lived-In Color', 'GW-DEV-20', 80), ('Lived-In Color', 'RK-EQ-07N', 30), ('Lived-In Color', 'RK-EQ-PS', 30),
  ('Bond Repair Treatment', 'OLX-2-2000', 30),
  ('Deep Conditioning', 'RK-ABC-TR-500', 30),
  ('Women''s Cut & Style', 'RK-AS-SH-1L', 15), ('Women''s Cut & Style', 'RK-AS-CO-1L', 15),
  ('Curly Cut', 'RK-AS-SH-1L', 20), ('Curly Cut', 'RK-AS-CO-1L', 25),
  ('Restyle / Big Chop', 'RK-AS-SH-1L', 15), ('Restyle / Big Chop', 'RK-AS-CO-1L', 15)
)
insert into public.service_products (business_id, service_id, product_id, amount)
select s.business_id, s.id, p.id, r.amount
from recipes r
join public.services s on s.name = r.service and s.business_id = 'b0000000-0000-4000-8000-000000000001'
join public.products p on p.sku = r.sku and p.business_id = s.business_id;

-- An order from Lakeshore sent two days ago, on its way.
with po as (
  insert into public.purchase_orders (business_id, location_id, supplier_id, status, notes, created_by, sent_by, sent_at, created_at)
  values ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003',
          'sent', 'Toner restock', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002',
          now() - interval '2 days', now() - interval '2 days')
  returning id
)
insert into public.purchase_order_lines (business_id, purchase_order_id, product_id, quantity, unit_cost_cents)
select 'b0000000-0000-4000-8000-000000000001', po.id, p.id, l.quantity, p.cost_cents
from po, (values ('WE-CC-T11', 4), ('WE-CC-T18', 6), ('RK-AS-SH-1L', 2)) as l (sku, quantity)
join public.products p on p.sku = l.sku;
