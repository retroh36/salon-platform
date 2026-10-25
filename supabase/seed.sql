-- Local development seed: one fake salon with a clear calendar. Runs on
-- `npx supabase db reset`. The team, services, schedules, clients,
-- products, forms and settings are here, with no appointments, waitlist,
-- walk-ins, groups, time off or blocked time, so you can book freely.
-- `npm run seed:demo` adds a busy month on top (supabase/seed-demo.sql).
--
-- All people, emails and phone numbers are made up. Never put real client
-- or staff data here.
--
-- Logins (password for all: password123)
--   owner@mapleandash.test       owner
--   manager@mapleandash.test     manager
--   frontdesk@mapleandash.test   front desk
--   bridget@mapleandash.test     stylist, Master
--   gil@mapleandash.test         stylist, Master
--   sandra@mapleandash.test      stylist, Master
--   nola@mapleandash.test        stylist, Senior
--   lois@mapleandash.test        stylist, Senior
--   shae@mapleandash.test        stylist, Artisan
--   hannah@mapleandash.test      stylist, Artisan
--   ari@mapleandash.test         assistant (to Bridget)
--
-- PINs for the shared front-desk iPad (Settings → Shared devices):
-- owner 2580, manager 3691, front desk 4826, Bridget 5937, Ari 7193.

-- ---------------------------------------------------------------------------
-- Auth users
-- ---------------------------------------------------------------------------

with seed_users (id, email) as (
  values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'owner@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'manager@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000003'::uuid, 'frontdesk@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'bridget@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'gil@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000006'::uuid, 'hannah@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000007'::uuid, 'nola@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000008'::uuid, 'sandra@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000009'::uuid, 'shae@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000010'::uuid, 'lois@mapleandash.test'),
    ('a0000000-0000-4000-8000-000000000011'::uuid, 'ari@mapleandash.test')
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
  -- Seven stylists, each with a login.
  ('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000004', 'Bridget', 'Callahan', 'bridget@mapleandash.test', '(555) 010-0104', 'stylist', '#db2777', true),
  ('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000005', 'Gil', 'Navarro', 'gil@mapleandash.test', '(555) 010-0105', 'stylist', '#059669', true),
  ('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000006', 'Hannah', 'Novak', 'hannah@mapleandash.test', '(555) 010-0106', 'stylist', '#ea580c', true),
  ('d0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000007', 'Nola', 'Brennan', 'nola@mapleandash.test', '(555) 010-0107', 'stylist', '#0891b2', true),
  ('d0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000008', 'Sandra', 'Whitfield', 'sandra@mapleandash.test', '(555) 010-0108', 'stylist', '#ca8a04', true),
  ('d0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000009', 'Shae', 'Morgan', 'shae@mapleandash.test', '(555) 010-0109', 'stylist', '#4f46e5', true),
  ('d0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000010', 'Lois', 'Park', 'lois@mapleandash.test', '(555) 010-0110', 'stylist', '#be185d', true),
  -- Bridget's assistant: sees her day and clients, no prices or pay.
  ('d0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000011', 'Ari', 'Delgado', 'ari@mapleandash.test', '(555) 010-0111', 'assistant', null, true);

update public.staff set assists_staff_id = 'd0000000-0000-4000-8000-000000000004'
where id = 'd0000000-0000-4000-8000-000000000011';

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

-- By level: Masters take the advanced color and correction work, Seniors
-- the full menu in their specialty, and Artisans everyday cuts, blowouts
-- and finishing.
with stylist (staff_id, categories, extra_services, except_services) as (
  values
    -- Bridget (Master): cuts and all color work
    ('d0000000-0000-4000-8000-000000000004'::uuid,
     array['Color', 'Highlights', 'Balayage'],
     array['Women''s Cut & Style', 'Curly Cut', 'Restyle / Big Chop', 'Bang Trim', 'Blowout', 'Bond Repair Treatment', 'Deep Conditioning'],
     array[]::text[]),
    -- Gil (Master): precision cutting plus everyday color
    ('d0000000-0000-4000-8000-000000000005'::uuid,
     array['Cuts'],
     array['Root Touch-Up', 'All-Over Color', 'Gloss / Toner', 'Men''s Gray Blending', 'Color Consultation', 'Blowout'],
     array[]::text[]),
    -- Hannah (Artisan): blowouts, styling and add-on treatments
    ('d0000000-0000-4000-8000-000000000006'::uuid,
     array['Blowouts & Styling', 'Treatments'],
     array['Women''s Cut & Style', 'Bang Trim'],
     array['Bridal Trial', 'Keratin Smoothing', 'Brazilian Blowout']),
    -- Nola (Senior): barbering
    ('d0000000-0000-4000-8000-000000000007'::uuid,
     array[]::text[],
     array['Men''s Cut', 'Skin Fade', 'Beard Trim', 'Kids'' Cut (12 & under)', 'Men''s Gray Blending', 'Scalp Treatment'],
     array[]::text[]),
    -- Sandra (Master): color specialist, corrections included
    ('d0000000-0000-4000-8000-000000000008'::uuid,
     array['Color', 'Highlights', 'Balayage'],
     array['Gloss / Toner', 'Bond Repair Treatment', 'Deep Conditioning', 'Hydrating Mask Add-On'],
     array[]::text[]),
    -- Shae (Artisan): everyday cuts and blowouts
    ('d0000000-0000-4000-8000-000000000009'::uuid,
     array[]::text[],
     array['Women''s Cut & Style', 'Men''s Cut', 'Kids'' Cut (12 & under)', 'Bang Trim', 'Blowout', 'Blowout (Long/Thick Hair)', 'Curls / Beach Waves', 'Deep Conditioning', 'Gloss / Toner'],
     array[]::text[]),
    -- Lois (Senior): highlights, smoothing and bridal
    ('d0000000-0000-4000-8000-000000000010'::uuid,
     array['Highlights'],
     array['Women''s Cut & Style', 'Curly Cut', 'Bang Trim', 'Root Touch-Up', 'Gloss / Toner', 'Blowout', 'Blowout (Long/Thick Hair)',
           'Silk Press', 'Updo', 'Bridal Trial', 'Keratin Smoothing', 'Brazilian Blowout', 'Bond Repair Treatment'],
     array[]::text[])
)
insert into public.staff_services (business_id, staff_id, service_id)
select distinct sv.business_id, st.staff_id, sv.id
from stylist st
join public.services sv
  on sv.business_id = 'b0000000-0000-4000-8000-000000000001'
 and sv.archived_at is null
 and (sv.category = any (st.categories) or sv.name = any (st.extra_services))
 and sv.name <> all (st.except_services);

-- Prices by level: Seniors charge the menu price, Masters about 15% more
-- and Artisans about 20% less, rounded to $5.
insert into public.service_level_prices (service_id, business_id, level, price_cents)
select sv.id, sv.business_id, l.level::public.staff_level, round(sv.price_cents * l.factor / 500) * 500
from public.services sv
cross join (values ('artisan', 0.8), ('senior', 1.0), ('master', 1.15)) as l (level, factor)
where sv.business_id = 'b0000000-0000-4000-8000-000000000001' and sv.price_cents > 0;

-- A stylist's own price still overrides their level's: Gil's skin fade.
update public.staff_services ss
set price_cents = 5500
from public.services sv
where sv.id = ss.service_id and sv.name = 'Skin Fade'
  and ss.staff_id = 'd0000000-0000-4000-8000-000000000005';

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
-- colorists (Bridget, Sandra, Gil), roughly every 6 to 8 weeks.
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
  ('d0000000-0000-4000-8000-000000000004', 'master'),  -- Bridget
  ('d0000000-0000-4000-8000-000000000005', 'master'),  -- Gil
  ('d0000000-0000-4000-8000-000000000006', 'artisan'), -- Hannah
  ('d0000000-0000-4000-8000-000000000007', 'senior'),  -- Nola
  ('d0000000-0000-4000-8000-000000000008', 'master'),  -- Sandra
  ('d0000000-0000-4000-8000-000000000009', 'artisan'), -- Shae
  ('d0000000-0000-4000-8000-000000000010', 'senior')   -- Lois
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
  -- Bridget: split shifts with a lunch break, short Saturday
  ('d0000000-0000-4000-8000-000000000004', 2, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000004', 2, '14:00', '18:00'),
  ('d0000000-0000-4000-8000-000000000004', 3, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000004', 3, '14:00', '18:00'),
  ('d0000000-0000-4000-8000-000000000004', 5, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000004', 5, '14:00', '18:00'),
  ('d0000000-0000-4000-8000-000000000004', 6, '08:00', '14:00'),
  -- Gil: Wednesday to Saturday
  ('d0000000-0000-4000-8000-000000000005', 3, '10:00', '19:00'),
  ('d0000000-0000-4000-8000-000000000005', 4, '10:00', '19:00'),
  ('d0000000-0000-4000-8000-000000000005', 5, '10:00', '19:00'),
  ('d0000000-0000-4000-8000-000000000005', 6, '08:00', '17:00'),
  -- Hannah: late shifts and Saturday (busy for blowouts and updos)
  ('d0000000-0000-4000-8000-000000000006', 4, '12:00', '20:00'),
  ('d0000000-0000-4000-8000-000000000006', 5, '12:00', '20:00'),
  ('d0000000-0000-4000-8000-000000000006', 6, '08:00', '17:00'),
  -- Nola: Tuesday to Saturday, late on Thursday
  ('d0000000-0000-4000-8000-000000000007', 2, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000007', 3, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000007', 4, '11:00', '20:00'),
  ('d0000000-0000-4000-8000-000000000007', 5, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000007', 6, '08:00', '15:00'),
  -- Sandra: color days, split Friday, no Saturdays
  ('d0000000-0000-4000-8000-000000000008', 2, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000008', 3, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000008', 4, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000008', 5, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000008', 5, '14:00', '20:00'),
  -- Shae: full week with a half-hour lunch
  ('d0000000-0000-4000-8000-000000000009', 2, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000009', 2, '13:30', '17:30'),
  ('d0000000-0000-4000-8000-000000000009', 3, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000009', 3, '13:30', '17:30'),
  ('d0000000-0000-4000-8000-000000000009', 4, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000009', 4, '13:30', '17:30'),
  ('d0000000-0000-4000-8000-000000000009', 5, '09:00', '13:00'),
  ('d0000000-0000-4000-8000-000000000009', 5, '13:30', '17:30'),
  ('d0000000-0000-4000-8000-000000000009', 6, '08:00', '16:00'),
  -- Lois: Wednesday to Saturday, early on Friday and Saturday
  ('d0000000-0000-4000-8000-000000000010', 3, '11:00', '19:00'),
  ('d0000000-0000-4000-8000-000000000010', 4, '11:00', '20:00'),
  ('d0000000-0000-4000-8000-000000000010', 5, '09:00', '17:00'),
  ('d0000000-0000-4000-8000-000000000010', 6, '08:00', '14:00')
) as h (staff_id, weekday, starts, ends);

-- Commission for stylists, by level.
insert into public.staff_compensation (staff_id, business_id, service_commission_pct, retail_commission_pct)
select s.id, s.business_id,
       case s.level when 'master' then 50 when 'senior' then 45 else 35 end,
       case s.level when 'artisan' then 10 else 15 end
from public.staff s
where s.business_id = 'b0000000-0000-4000-8000-000000000001' and s.role = 'stylist';

-- The front desk and the manager are paid by the hour.
insert into public.staff_compensation (staff_id, business_id, hourly_rate_cents) values
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 2600),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 1800),
  ('d0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001', 1600);

-- Commission plans (Settings → Commission): Gil is on marginal tiers that
-- start again each month, with a back-bar fee. Everyone else stays on
-- their own rates above.
insert into public.commission_plans (id, business_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Senior tiers');
insert into public.commission_plan_versions (id, business_id, plan_id, rules, created_at) values
  ('e2000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
   '{"mode": "commission", "service": [{"from_cents": 0, "pct": 40}, {"from_cents": 400000, "pct": 45}, {"from_cents": 800000, "pct": 50}],
     "retail": [{"from_cents": 0, "pct": 15}], "tier_period": "month", "tier_style": "marginal", "backbar": {"kind": "fixed", "value": 300}}', now() - interval '2 years');
update public.commission_plans set current_version_id = ('e2' || substr(id::text, 3))::uuid where business_id = 'b0000000-0000-4000-8000-000000000001';
update public.staff_compensation set plan_id = 'e1000000-0000-4000-8000-000000000001' where staff_id = 'd0000000-0000-4000-8000-000000000005';
-- On it from the start, like everyone's first rates.
delete from public.staff_compensation_history where staff_id = 'd0000000-0000-4000-8000-000000000005' and effective_from <> '-infinity';
update public.staff_compensation_history set plan_id = 'e1000000-0000-4000-8000-000000000001' where staff_id = 'd0000000-0000-4000-8000-000000000005';

-- Demo PINs for the shared iPad (see the top of this file).
insert into public.staff_pins (staff_id, business_id, pin_hash)
select p.staff_id, 'b0000000-0000-4000-8000-000000000001', extensions.crypt(p.pin, extensions.gen_salt('bf', 8))
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, '2580'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, '3691'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, '4826'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, '5937'),
  ('d0000000-0000-4000-8000-000000000011'::uuid, '7193')
) as p (staff_id, pin);

-- ---------------------------------------------------------------------------
-- Resources: seven chairs, Nola's barber station and a treatment room for
-- smoothing treatments.
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

-- Services that need a patch test: color, lightener and toner.
update public.services set requires_patch_test = true
where business_id = 'b0000000-0000-4000-8000-000000000001'
  and (category ~* '(colou?r|highlight|balayage)' or name ~* '(colou?r|gloss|toner|bleach)')
  and name <> 'Color Consultation';

-- Patch tests for most color clients (those with a formula): recent ones
-- that pass, a few older than six months, and one reaction.
insert into public.client_patch_tests (business_id, client_id, tested_at, products, result, performed_by, notes)
select f.business_id, f.client_id,
       now() - make_interval(days => case when abs(hashtext('pt' || f.client_id)) % 10 < 7 then 30 + abs(hashtext('pt' || f.client_id)) % 60 else 200 + abs(hashtext('pt' || f.client_id)) % 100 end),
       'Goldwell Topchic 6N + 20 vol behind the ear',
       case when abs(hashtext('ptr' || f.client_id)) % 40 = 0 then 'reaction' else 'no_reaction' end::public.patch_test_result,
       f.staff_id, null
from (select distinct on (client_id) client_id, business_id, staff_id from public.client_formulas order by client_id, visit_date desc) f
where abs(hashtext('has-pt' || f.client_id)) % 100 < 85;

-- Forms: a consultation before a client's first visit, and color consent
-- before color services.
insert into public.form_templates (id, business_id, name, intro, fields, required, service_ids)
values
  ('e3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'New client consultation',
   'Welcome! A few questions so your stylist knows your hair and any sensitivities.',
   '[{"id": "history", "type": "text", "label": "What has been done to your hair in the last year?", "required": false},
     {"id": "sensitive", "type": "yes_no", "label": "Do you have a sensitive scalp or skin allergies?", "required": true},
     {"id": "pregnant", "type": "yes_no", "label": "Are you pregnant or breastfeeding?", "required": true},
     {"id": "photos", "type": "checkbox", "label": "The salon may take before and after photos of my hair.", "required": false},
     {"id": "sign", "type": "signature", "label": "Signature", "required": true}]',
   'first_visit', '{}'),
  ('e3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Color consent',
   'Hair color can cause allergic reactions. Please read and sign before your color service.',
   '[{"id": "patch", "type": "yes_no", "label": "Have you had a patch test in the last six months?", "required": true},
     {"id": "reaction", "type": "yes_no", "label": "Have you ever reacted to hair dye?", "required": true},
     {"id": "understand", "type": "checkbox", "label": "I understand that color results can vary and that I should tell my stylist about any itching or burning.", "required": true},
     {"id": "sign", "type": "signature", "label": "Signature", "required": true}]',
   'services',
   (select array_agg(id) from public.services where business_id = 'b0000000-0000-4000-8000-000000000001' and requires_patch_test));

-- Most returning clients signed the consultation on their first visit.
insert into public.client_forms (business_id, client_id, template_id, template_name, fields, answers, signature, signed_at, collected_by)
select c.business_id, c.id, t.id, t.name, t.fields,
       '{"history": "", "sensitive": "no", "pregnant": "no", "photos": true, "sign": true}',
       'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
       c.created_at, 'd0000000-0000-4000-8000-000000000003'
from public.clients c, public.form_templates t
where t.id = 'e3000000-0000-4000-8000-000000000001' and c.business_id = t.business_id
  and abs(hashtext('form' || c.id)) % 100 < 80;


-- ---------------------------------------------------------------------------
-- Online booking: the salon's site at /book/maple-and-ash. Color
-- corrections and vivids need a consultation first (which books the Color
-- Consultation); bang trims are for existing clients between cuts, so not
-- online. Longer lightening and smoothing services take a deposit.
-- ---------------------------------------------------------------------------

update public.businesses set slug = 'maple-and-ash' where id = 'b0000000-0000-4000-8000-000000000001';

insert into public.online_booking_settings (
  business_id, enabled, window_days, notice_minutes, allow_new_clients, cancel_cutoff_hours,
  cancellation_policy, consultation_service_id, accent_color, welcome
)
select 'b0000000-0000-4000-8000-000000000001', true, 60, 120, true, 24,
       'Plans change, we understand. You can cancel or reschedule online, with the link in your confirmation, or by phone.',
       (select id from public.services where business_id = 'b0000000-0000-4000-8000-000000000001' and name = 'Color Consultation'),
       '#6b3f2a', 'Book your next visit with our team. We can''t wait to see you.';

update public.services set online_booking = 'consultation'
where business_id = 'b0000000-0000-4000-8000-000000000001' and name in ('Color Correction', 'Vivid / Fashion Color');

update public.services set online_booking = 'off'
where business_id = 'b0000000-0000-4000-8000-000000000001' and name = 'Bang Trim';

update public.services set deposit_kind = 'percent', deposit_amount = 25
where business_id = 'b0000000-0000-4000-8000-000000000001'
  and name in ('Balayage', 'Foilayage', 'Lived-In Color', 'Babylights', 'Keratin Smoothing', 'Brazilian Blowout');

update public.services set deposit_kind = 'fixed', deposit_amount = 5000
where business_id = 'b0000000-0000-4000-8000-000000000001' and name in ('Bridal Trial', 'Double Process (Bleach & Tone)');
