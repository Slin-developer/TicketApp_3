-- Phase 2 seed: 4 test users (one per role), 1 organizer "tenant",
-- 1 test event, scanner assignment, and 3 valid tickets with known
-- token secrets so the scanner UI can be exercised end-to-end in Phase 5.
--
-- Known scan secrets (raw text — paste into scan UI or encode as QR):
--   TEST_TOKEN_001
--   TEST_TOKEN_002
--   TEST_TOKEN_003
--
-- Login credentials for all test users (password is the same):
--   admin@test.local      / password123
--   organizer@test.local  / password123
--   scanner@test.local    / password123
--   attendee@test.local   / password123
--
-- The auth.users insert pattern below mirrors the Supabase docs' recommended
-- seed shape (bcrypted password + matching auth.identities row).
-- Designed to be idempotent for repeated `supabase db reset` runs.

do $$
declare
  v_org_id        uuid := '11111111-1111-1111-1111-111111111111';
  v_event_id      uuid := '22222222-2222-2222-2222-222222222222';

  v_admin_uid     uuid := '00000000-0000-0000-0000-0000000000a1';
  v_organizer_uid uuid := '00000000-0000-0000-0000-0000000000a2';
  v_scanner_uid   uuid := '00000000-0000-0000-0000-0000000000a3';
  v_attendee_uid  uuid := '00000000-0000-0000-0000-0000000000a4';

  v_users jsonb := jsonb_build_array(
    jsonb_build_object('id', v_admin_uid,     'email', 'admin@test.local'),
    jsonb_build_object('id', v_organizer_uid, 'email', 'organizer@test.local'),
    jsonb_build_object('id', v_scanner_uid,   'email', 'scanner@test.local'),
    jsonb_build_object('id', v_attendee_uid,  'email', 'attendee@test.local')
  );
  v_user jsonb;
  v_uid uuid;
  v_email text;
begin
  for v_user in select * from jsonb_array_elements(v_users) loop
    v_uid   := (v_user->>'id')::uuid;
    v_email := v_user->>'email';

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated', 'authenticated',
      v_email,
      crypt('password123', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(), now(),
      '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid, v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_email),
      'email', now(), now(), now()
    ) on conflict do nothing;
  end loop;
end $$;

-- Assign roles + organizer membership. The trigger inserted these rows
-- with default role 'attendee' and a null organizer_id.
update public.profiles set role = 'admin'
  where id = '00000000-0000-0000-0000-0000000000a1';

update public.profiles
  set role = 'organizer',
      organizer_id = '11111111-1111-1111-1111-111111111111'
  where id = '00000000-0000-0000-0000-0000000000a2';

update public.profiles
  set role = 'scanner',
      organizer_id = '11111111-1111-1111-1111-111111111111'
  where id = '00000000-0000-0000-0000-0000000000a3';

update public.profiles set role = 'attendee'
  where id = '00000000-0000-0000-0000-0000000000a4';

-- Test event owned by the organizer tenant
insert into public.events (id, organizer_id, name, description, starts_at, ends_at)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Phase 2 Smoke Test Event',
  'Seeded event for exercising scanner and ticket flows.',
  now() + interval '7 days',
  now() + interval '7 days 4 hours'
) on conflict (id) do nothing;

-- Scanner assignment for the test event
insert into public.event_scanners (event_id, scanner_id, organizer_id)
values (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-0000000000a3',
  '11111111-1111-1111-1111-111111111111'
) on conflict do nothing;

-- A paid order for the attendee (so the seeded tickets have a parent).
insert into public.orders (id, organizer_id, event_id, attendee_id, status, amount_cents)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-0000000000a4',
  'paid',
  2500
) on conflict (id) do nothing;

-- Three valid tickets keyed by sha256(secret). Raw secrets live in the
-- comment header of this file — never in any column.
insert into public.tickets (organizer_id, event_id, order_id, attendee_id, token_hash, status)
values
  ('11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333',
   '00000000-0000-0000-0000-0000000000a4',
   encode(digest('TEST_TOKEN_001', 'sha256'), 'hex'),
   'valid'),
  ('11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333',
   '00000000-0000-0000-0000-0000000000a4',
   encode(digest('TEST_TOKEN_002', 'sha256'), 'hex'),
   'valid'),
  ('11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333',
   '00000000-0000-0000-0000-0000000000a4',
   encode(digest('TEST_TOKEN_003', 'sha256'), 'hex'),
   'valid')
on conflict (token_hash) do nothing;
