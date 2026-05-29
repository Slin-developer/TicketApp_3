-- Phase 6 (real Stripe): atomic, idempotent fulfilment + void RPCs called by the
-- stripe-webhook Edge Function.
--
-- WHY RPCs instead of doing it in the Edge Function: the trust boundary (RULES.md
-- Rule 8) must be race-safe. The stub flipped tier counters with a read-then-write
-- (reserved_count = <value read earlier>), which races under concurrent webhook
-- retries and across orders on the same tier. Doing the whole thing in one
-- plpgsql function lets us lock the order row (FOR UPDATE) for idempotency and
-- mutate counters with relative expressions (sold_count = sold_count + n) that
-- never lose updates.
--
-- The Edge Function generates the high-entropy raw tokens and passes only their
-- SHA-256 hashes here, so raw secrets never travel to the DB (ARCHITECTURE.md §5).

-- fulfill_paid_order: pending -> paid. Inserts one ticket per supplied hash,
-- moves the tier's inventory reserved -> sold, records the PaymentIntent id.
-- Idempotent: a replayed webhook for an already-paid order returns 'already_paid'
-- without issuing duplicate tickets.
create or replace function public.fulfill_paid_order(
  p_order_id uuid,
  p_payment_intent_id text,
  p_token_hashes text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_count int := coalesce(array_length(p_token_hashes, 1), 0);
  v_hash  text;
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
  if v_count <> v_order.quantity then
    return jsonb_build_object('result', 'quantity_mismatch',
      'expected', v_order.quantity, 'received', v_count);
  end if;

  foreach v_hash in array p_token_hashes loop
    insert into public.tickets (org_id, event_id, tier_id, order_id, attendee_id, token_hash, status)
    values (v_order.org_id, v_order.event_id, v_order.tier_id, v_order.id,
            v_order.attendee_id, v_hash, 'valid');
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

-- void_order_by_payment_intent: refund/dispute handling. Voids every ticket on
-- the matching order, restores tier inventory, and marks the order 'failed'
-- (order_status has no 'refunded' value and ALTER TYPE ... ADD VALUE can't run
-- in a migration transaction; 'failed' is the available terminal state).
-- Idempotent: re-running once tickets are already void is a no-op returning 0.
create or replace function public.void_order_by_payment_intent(
  p_payment_intent_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders%rowtype;
  v_voided  int;
begin
  if p_payment_intent_id is null then
    return jsonb_build_object('result', 'missing_payment_intent');
  end if;

  select * into v_order
    from public.orders
   where stripe_payment_intent_id = p_payment_intent_id
   for update;
  if not found then
    return jsonb_build_object('result', 'order_not_found');
  end if;

  -- Void all not-yet-void tickets. Clear scanned_at to satisfy the
  -- (status='scanned') = (scanned_at is not null) consistency constraint.
  with voided as (
    update public.tickets
       set status = 'void', scanned_at = null
     where order_id = v_order.id
       and status <> 'void'
    returning 1
  )
  select count(*) into v_voided from voided;

  if v_voided > 0 and v_order.tier_id is not null then
    update public.ticket_tiers
       set sold_count = greatest(0, sold_count - v_voided)
     where id = v_order.tier_id;
  end if;

  update public.orders set status = 'failed' where id = v_order.id;

  return jsonb_build_object('result', 'voided', 'order_id', v_order.id,
    'tickets_voided', v_voided);
end;
$$;

-- Service-role only: these are invoked exclusively by the stripe-webhook Edge
-- Function. Never callable from the browser (authenticated/anon/public).
revoke all on function public.fulfill_paid_order(uuid, text, text[]) from public;
revoke all on function public.void_order_by_payment_intent(text) from public;
grant execute on function public.fulfill_paid_order(uuid, text, text[]) to service_role;
grant execute on function public.void_order_by_payment_intent(text) to service_role;
