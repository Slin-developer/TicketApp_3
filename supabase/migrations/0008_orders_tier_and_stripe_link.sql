-- Phase 6 (real Stripe): give orders a reliable link to the tier they reserved,
-- the quantity, and the Stripe PaymentIntent that paid for them.
--
-- WHY: the stub stripe-webhook had to *guess* which tier an order belonged to
-- (most-expensive tier on the event) and derive quantity from amount_cents /
-- price_cents. That is unreliable once events have multiple same-priced or
-- overlapping tiers. reserve_tickets already knows the exact tier + quantity;
-- it just wasn't persisting them. We store them on the order so the webhook can
-- fulfil deterministically. stripe_payment_intent_id lets refund/dispute events
-- (which only carry a charge/PaymentIntent, not our order_id) map back to an order.
--
-- All statements here are transaction-safe (column adds + CREATE OR REPLACE),
-- so this migration runs cleanly inside the CLI's per-file transaction. We do
-- NOT add a 'refunded' order_status enum value, because ALTER TYPE ... ADD VALUE
-- cannot run inside a transaction block; refunds set status to 'failed' instead.

alter table public.orders
  add column if not exists tier_id uuid references public.ticket_tiers(id) on delete restrict,
  add column if not exists quantity integer check (quantity is null or quantity > 0),
  add column if not exists stripe_payment_intent_id text;

-- Refund/dispute lookups hit orders by PaymentIntent id; index it.
create index if not exists orders_stripe_payment_intent_idx
  on public.orders (stripe_payment_intent_id);

-- Recreate reserve_tickets so the pending order records tier_id + quantity.
-- Body is identical to 0006 except the INSERT now persists tier_id/quantity.
create or replace function public.reserve_tickets(
  p_tier_id uuid,
  p_quantity int,
  p_buyer_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller       uuid := auth.uid();
  v_tier         public.ticket_tiers%rowtype;
  v_event_org    uuid;
  v_event_id     uuid;
  v_amount_cents int;
  v_order_id     uuid;
  v_available    int;
begin
  if v_caller is null or p_buyer_id <> v_caller then
    return jsonb_build_object('result', 'unauthorized');
  end if;

  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object('result', 'invalid_quantity');
  end if;

  -- Lock the tier row. Concurrent reservers serialize here.
  select * into v_tier
    from public.ticket_tiers
   where id = p_tier_id
   for update;

  if not found then
    return jsonb_build_object('result', 'tier_not_found');
  end if;

  v_available := v_tier.capacity - v_tier.reserved_count - v_tier.sold_count;
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

  insert into public.orders (org_id, event_id, attendee_id, status, amount_cents, tier_id, quantity)
  values (v_event_org, v_event_id, p_buyer_id, 'pending', v_amount_cents, p_tier_id, p_quantity)
  returning id into v_order_id;

  update public.ticket_tiers
     set reserved_count = reserved_count + p_quantity
   where id = p_tier_id;

  return jsonb_build_object(
    'result',       'success',
    'order_id',     v_order_id,
    'amount_cents', v_amount_cents,
    'quantity',     p_quantity
  );
end;
$$;

revoke all     on function public.reserve_tickets(uuid, int, uuid) from public;
grant  execute on function public.reserve_tickets(uuid, int, uuid) to authenticated;
