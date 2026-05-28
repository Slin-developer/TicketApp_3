do $$
declare
  v_org_id        uuid := '11111111-1111-1111-1111-111111111111';
  v_event_id      uuid := '22222222-2222-2222-2222-222222222222';
  v_tier_id       uuid := '44444444-4444-4444-4444-444444444444';

  v_owner_uid     uuid := '00000000-0000-0000-0000-0000000000a1';
  v_admin_uid     uuid := '00000000-0000-0000-0000-0000000000a2';
  v_scanner_uid   uuid := '00000000-0000-0000-0000-0000000000a3';
  v_attendee_uid  uuid := '00000000-0000-0000-0000-0000000000a4';

  v_users jsonb := jsonb_build_array(
    jsonb_build_object('id', v_owner_uid,    'email', 'owner@test.local'),
    jsonb_build_object('id', v_admin_uid,    'email', 'admin@test.local'),
    jsonb_build_object('id', v_scanner_uid,  'email', 'scanner@test.local'),
    jsonb_build_object('id', v_attendee_uid, 'email', 'attendee@test.local')
  );
  v_user jsonb;
  v_uid uuid;
  v_email text;
begin
  -- 1. Create or ensure Auth Users
  for v_user in sel  for v_user in sel  for v_user in sel  for v_user in sel  for v_user in sel  for v_user iem il := v_user->>'email';

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_me      raw_app_meta_data, raw_user_me      raw_app_meta_data, raw email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated', 'authenticated',
      v_email,
      crypt('password123', gen_salt('bf')),
      now(),      now(),      now(),      now(),      now(),      now(),     ::jsonb,
                                                                         lict (id) do nothing;

    insert into auth.identities (
      id, user_id, prov      id, user_id, prov      id, user_id, prov      id, user_id, prov      d_at
             (
               m_     ), v_uid, v_uid::               m_     ), v_uid('sub', v_uid::text, 'email', v_email),
      'email', now(), now(), now()
    ) on conflict do nothing;
  end loop;

  -- The auth trigger should already have populated pu  -- The auth trigger should already have populated pu  -- rt  -- The auth trigger should already have populated pu  -  va  -- The auth trigger should already have populated pu  -- The auth trigger should already have populated pu  -- rt  -- The auth trigger should already r_  -- The authal  -- The auth trigger should already have po  (v_org_id, v_admin_uid, 'admin'),
    (v_org_id, v_scanner_uid, 'sca    (v_org_id, v_scanner_uid, 'sca    (v_oup    (v_org_id, v_scanner_uid, 'sca    (v_org_id, v_scanner_uid, 'sca    (v_oup    (veeded.

  -- 4. Test Event
  insert into public.events (id, org_id, name, description, starts_at,   insert into public.events (id_id,
    v_org_id,
    'Phase 2 Smoke Test Event',
    'Seeded event for exercising scanner and ticket flows.',
    now()    now()    now()    now()    now()    now()    now()    now()    now()    now()    now()    now()    now(t Tier
  insert into public.ticket_ti  insert into public.ticketice  inse, capacity, reserved_count, sold_count)
  values (
    v_tier_id,
    v_event_id,
    'General Admission',
    2500,
    100,
    0,
    3
  ) on conflict (id) do update set sold_count = 3;

  -- 6. Paid order setup
  insert into public.orders (id, org_id, event_id, attendee_id, status, amount_cents)
  values (
    '33333333-3333-3333-3333-333333333333',
    v_org_id,
    v_event_id,
    v_attendee_uid,
    'paid',
    7500
  )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )dee  )   )   )   )  tu  )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   '  )   aa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'valid'  )   )   )   )   )   )   )   )   )   )   )   )   )   )   )3-  )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )   )  d, '33333333-3333-3333-3333-333333333333', v_attendee_uid, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'valid')
  on conflict (qr_hash) do  on conflict  $$;
