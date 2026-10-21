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
  id, business_id, name, address_line1, city, region, postal_code, country, phone, timezone, hours
) values (
  'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'Maple & Ash Downtown',
  '123 Example Street', 'Springfield', 'IL', '62701', 'US', '(555) 010-0100',
  'America/Chicago',
  '{
    "mon": [],
    "tue": [{"open": "09:00", "close": "19:00"}],
    "wed": [{"open": "09:00", "close": "19:00"}],
    "thu": [{"open": "09:00", "close": "20:00"}],
    "fri": [{"open": "09:00", "close": "20:00"}],
    "sat": [{"open": "08:00", "close": "17:00"}],
    "sun": []
  }'::jsonb
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
