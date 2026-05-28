-- Phase 6: reserve_tickets RPC.
-- Atomically claims inventory on a ticket_tier and creates a pending order.
-- Uses SELECT ... FOR UPDATE on ticket_tiers (per TODOS.md) so concurrent
-- reservations cannot oversell: only one transaction holds the row lock at a
-- time, and capacity is re-checked under the lock before incrementing
-- reserved_count.
--
-- Typed jsonb result (mirrors scan_ticket's discriminated-union shape):
--   { result: 'success', order_id, amount_cents, quantity }
--   { result: 'sold_out', available }
--   { result: 'tier_not_found' }
--   { result: 'invalid_quantity' }
--   { result: 'unauthorized' }            -- p_buyer_id != auth.uid()
--
-- Tickets are NOT inserted here. Per ARCHITECTURE.md trust boundary, ticket
-- rows are only created by the stripe-webhook Edge Function once an order
-- transitions to 'paid'. reserve_tickets only books capacity + creates the
-- pending order.

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

  insert into public.orders (org_id, event_id, attendee_id, status, amount_cents)
  values (v_event_org, v_event_id, p_buyer_id, 'pending', v_amount_cents)
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
