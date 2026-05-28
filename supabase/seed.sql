-- =============================================================================
-- Phase 5 seed: one org with all four roles, one event, one tier, one paid
-- order, three tickets (valid / scanned / void) suitable for exercising the
-- scan_ticket RPC end-to-end.
--
-- Test logins (password = 'password123' for all):
--   owner@test.local
--   admin@test.local
--   scanner@test.local
--   attendee@test.local
--
-- Raw scan tokens (paste these into the Scanner UI to test each branch):
--   seed-token-valid-0001     -> success
--   seed-token-scanned-0002   -> already_scanned
--   seed-token-void-0003      -> not_found  (void tickets must not leak)
--   <anything else>           -> not_found
--
-- The DB stores only sha256(token) in tickets.token_hash; raw tokens never
-- leave this file.
--
-- Re-runnable: every insert is guarded with ON CONFLICT.
-- =============================================================================

do $$
declare
  v_org_id             uuid := '11111111-1111-1111-1111-111111111111';
  v_event_id           uuid := '22222222-2222-2222-2222-222222222222';
  v_order_id           uuid := '33333333-3333-3333-3333-333333333333';
  v_tier_id            uuid := '44444444-4444-4444-4444-444444444444';

  v_ticket_valid_id    uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_ticket_scanned_id  uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_ticket_void_id     uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  v_owner_uid          uuid := '00000000-0000-0000-0000-0000000000a1';
  v_admin_uid          uuid := '00000000-0000-0000-0000-0000000000a2';
  v_scanner_uid        uuid := '00000000-0000-0000-0000-0000000000a3';
  v_attendee_uid       uuid := '00000000-0000-0000-0000-0000000000a4';

  v_users jsonb := jsonb_build_array(
    jsonb_build_object('id', v_owner_uid,    'email', 'owner@test.local'),
    jsonb_build_object('id', v_admin_uid,    'email', 'admin@test.local'),
    jsonb_build_object('id', v_scanner_uid,  'email', 'scanner@test.local'),
    jsonb_build_object('id', v_attendee_uid, 'email', 'attendee@test.local')
  );
  v_user  jsonb;
  v_uid   uuid;
  v_email text;

  -- Raw tokens (see header comment).
  v_token_valid   text := 'seed-token-valid-0001';
  v_token_scanned text := 'seed-token-scanned-0002';
  v_token_void    text := 'seed-token-void-0003';
begin
  -- 1. Auth users + identities.
  for v_user in select * from jsonb_array_elements(v_users)
  loop
    v_uid := (v_user->>'id')::uuid;
    v_email := v_user->>'email';

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
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
      gen_random_uuid(),
      v_uid,
      v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_email),
      'email',
      now(), now(), now()
    ) on conflict do nothing;
  end loop;

  -- 2. Organization. handle_new_user() should have populated profiles already.
  insert into public.organizations (id, name)
  values (v_org_id, 'Acme Events')
  on conflict (id) do nothing;

  -- 3. Membership. Attendee deliberately has no membership row.
  insert into public.organization_members (org_id, user_id, role) values
    (v_org_id, v_owner_uid,   'owner'),
    (v_org_id, v_admin_uid,   'admin'),
    (v_org_id, v_scanner_uid, 'scanner')
  on conflict (org_id, user_id) do update set role = excluded.role;

  -- 4. Event.
  insert into public.events (id, org_id, name, description, starts_at, ends_at)
  values (
    v_event_id,
    v_org_id,
    'Phase 5 Smoke Test Event',
    'Seeded event for exercising the scanner RPC.',
    now() + interval '1 day',
    now() + interval '1 day 4 hours'
  ) on conflict (id) do nothing;

  -- 5. Ticket tier. sold_count tracks the three seeded tickets.
  insert into public.ticket_tiers (id, event_id, name, price_cents, capacity, reserved_count, sold_count)
  values (v_tier_id, v_event_id, 'General Admission', 2500, 100, 0, 3)
  on conflict (id) do update set sold_count = 3;

  -- 6. Paid order backing the seeded tickets.
  insert into public.orders (id, org_id, event_id, attendee_id, status, amount_cents)
  values (v_order_id, v_org_id, v_event_id, v_attendee_uid, 'paid', 7500)
  on conflict (id) do nothing;

  -- 7. Tickets. token_hash = sha256(raw_token).
  -- The check constraint requires scanned_at IS NOT NULL iff status='scanned',
  -- so set scanned_at inline for the scanned row.
  insert into public.tickets (
    id, org_id, event_id, tier_id, order_id, attendee_id,
    token_hash, status, scanned_at
  ) values
    (v_ticket_valid_id,   v_org_id, v_event_id, v_tier_id, v_order_id, v_attendee_uid,
     encode(digest(v_token_valid,   'sha256'), 'hex'), 'valid',   null),
    (v_ticket_scanned_id, v_org_id, v_event_id, v_tier_id, v_order_id, v_attendee_uid,
     encode(digest(v_token_scanned, 'sha256'), 'hex'), 'scanned', now()),
    (v_ticket_void_id,    v_org_id, v_event_id, v_tier_id, v_order_id, v_attendee_uid,
     encode(digest(v_token_void,    'sha256'), 'hex'), 'void',    null)
  on conflict (id) do nothing;
end;
$$;
