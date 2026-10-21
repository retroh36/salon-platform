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
