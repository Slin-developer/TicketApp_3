-- Phase 8 (guest checkout): let anonymous buyers reserve + pay without an account.
--
-- WHY: ordering no longer requires a Supabase Auth user. Orders bind to a
-- buyer-supplied email and a secret order_reference (the bearer key the buyer
-- uses to retrieve their tickets). Door staff still authenticate; only the
-- buyer flow goes anonymous.
--
-- Ticket token model is UNCHANGED at rest: the DB still stores only token_hash.
-- The raw QR token is DERIVED as HMAC_SHA256(TICKET_TOKEN_SECRET, ticket_id) in
-- the edge functions (stripe-webhook mints, get-tickets re-derives), so nothing
-- secret is persisted. That is why fulfill_paid_order now receives explicit
-- ticket ids: the tokens must be re-derivable from a stable, stored id.

-- 1. Orders: guest identity + bearer reference + reservation expiry.
alter table public.orders
  add column if not exists buyer_email text,
  add column if not exists order_reference uuid not null default gen_random_uuid(),
  add column if not exists expires_at timestamptz;

-- attendee_id was NOT NULL (0002); guests have none.
alter table public.orders alter column attendee_id drop not null;

create unique index if not exists orders_order_reference_key
  on public.orders (order_reference);

-- 2. reserve_tickets: guest variant. New signature drops p_buyer_id (auth.uid)
-- in favour of p_buyer_email, so the old (uuid,int,uuid) overload is removed.
drop function if exists public.reserve_tickets(uuid, int, uuid);

create or replace function public.reserve_tickets(
  p_tier_id uuid,
  p_quantity int,
  p_buyer_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier         public.ticket_tiers%rowtype;
  v_event_org    uuid;
  v_event_id     uuid;
  v_amount_cents int;
  v_order_id     uuid;
  v_order_ref    uuid;
  v_available    int;
  v_reclaimed    int;
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object('result', 'invalid_quantity');
  end if;

  -- Lock the tier row. Concurrent reservers / fulfilments serialize here.
  select * into v_tier
    from public.ticket_tiers
   where id = p_tier_id
   for update;

  if not found then
    return jsonb_build_object('result', 'tier_not_found');
  end if;

  -- Lazy reclaim: release inventory held by pending orders on THIS tier whose
  -- hold has expired (abandoned anonymous reservations). Done under the tier
  -- lock so counts stay consistent; self-healing, no cron needed.
  with reclaimed as (
    update public.orders
       set status = 'expired'
     where tier_id = p_tier_id
       and status = 'pending'
       and expires_at is not null
       and expires_at < now()
    returning quantity
  )
  select coalesce(sum(quantity), 0) into v_reclaimed from reclaimed;

  if v_reclaimed > 0 then
    update public.ticket_tiers
       set reserved_count = greatest(0, reserved_count - v_reclaimed)
     where id = p_tier_id;
  end if;

  -- Availability against the reclaimed reserved_count (capacity/sold unchanged).
  v_available := v_tier.capacity - (v_tier.reserved_count - v_reclaimed) - v_tier.sold_count;
  if v_available < p_quantity then
    return jsonb_build_object('result', 'sold_out', 'available', v_available);
  end if;

  select org_id, id into v_event_org, v_event_id
    from public.events
   where id = v_tier.event_id;

  if v_event_id is null then
    return jsonb_build_object('result', 'tier_not_found');
  end if;

  v_amount_cents := v_tier.price_cents * p_quantity;

  -- Hold expiry is 5 min past Stripe's 30-min minimum session lifetime, so a
  -- still-payable checkout session can never be reclaimed out from under a
  -- buyer (eliminates the paid-but-expired race).
  insert into public.orders
    (org_id, event_id, attendee_id, status, amount_cents, tier_id, quantity, buyer_email, expires_at)
  values
    (v_event_org, v_event_id, null, 'pending', v_amount_cents, p_tier_id, p_quantity,
     p_buyer_email, now() + interval '35 minutes')
  returning id, order_reference into v_order_id, v_order_ref;

  update public.ticket_tiers
     set reserved_count = reserved_count + p_quantity
   where id = p_tier_id;

  return jsonb_build_object(
    'result',          'success',
    'order_id',        v_order_id,
    'order_reference', v_order_ref,
    'amount_cents',    v_amount_cents,
    'quantity',        p_quantity
  );
end;
$$;

-- Callable by anyone (guest checkout) and by authenticated staff.
revoke all     on function public.reserve_tickets(uuid, int, text) from public;
grant  execute on function public.reserve_tickets(uuid, int, text) to anon, authenticated;

-- 3. fulfill_paid_order: take explicit ticket ids so the derived HMAC tokens are
-- re-derivable later by get-tickets. Old (uuid,text,text[]) overload removed.
drop function if exists public.fulfill_paid_order(uuid, text, text[]);

create or replace function public.fulfill_paid_order(
  p_order_id uuid,
  p_payment_intent_id text,
  p_ticket_ids uuid[],
  p_token_hashes text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_count int := coalesce(array_length(p_ticket_ids, 1), 0);
  i int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('result', 'order_not_found');
  end if;

  if v_order.status in ('paid', 'fulfilled') then
    return jsonb_build_object('result', 'already_paid', 'order_id', v_order.id);
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('result', 'order_not_pending', 'status', v_order.status);
  end if;

  if v_order.tier_id is null or v_order.quantity is null then
    return jsonb_build_object('result', 'order_missing_tier_or_quantity');
  end if;
  if v_count <> v_order.quantity or v_count <> coalesce(array_length(p_token_hashes, 1), 0) then
    return jsonb_build_object('result', 'quantity_mismatch',
      'expected', v_order.quantity, 'received', v_count);
  end if;

  for i in 1..v_count loop
    insert into public.tickets
      (id, org_id, event_id, tier_id, order_id, attendee_id, token_hash, status)
    values
      (p_ticket_ids[i], v_order.org_id, v_order.event_id, v_order.tier_id, v_order.id,
       v_order.attendee_id, p_token_hashes[i], 'valid');
  end loop;

  update public.ticket_tiers
     set reserved_count = greatest(0, reserved_count - v_order.quantity),
         sold_count     = sold_count + v_order.quantity
   where id = v_order.tier_id;

  update public.orders
     set status = 'paid',
         stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
   where id = v_order.id;

  return jsonb_build_object('result', 'fulfilled', 'order_id', v_order.id,
    'tickets_issued', v_count);
end;
$$;

revoke all on function public.fulfill_paid_order(uuid, text, uuid[], text[]) from public;
grant execute on function public.fulfill_paid_order(uuid, text, uuid[], text[]) to service_role;
