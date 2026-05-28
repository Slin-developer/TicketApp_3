// Phase 6 stub: stripe-webhook Edge Function.
//
// This is the SOLE trust boundary for ticket issuance (RULES.md Rule 8).
// The real implementation must:
//   1. Read the raw body + Stripe-Signature header.
//   2. Call stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)
//      to verify the signature. Reject 400 on any failure.
//   3. Handle 'checkout.session.completed' (and refund/chargeback events).
//
// The stub below skips signature verification and instead accepts a JSON body
// of the shape { event_type: 'checkout.session.completed', order_id } so the
// fulfilment pipeline (orders -> paid, tickets generated) is exercisable
// without Stripe wired up. DO NOT ship this to production as-is.
//
// Ticket token model (RULES.md Rule 4 / ARCHITECTURE.md §5):
//   - Generate a high-entropy raw token per ticket (UUIDv4 = 122 bits).
//   - Store only sha256(raw_token) hex in tickets.token_hash.
//   - In a real flow the raw tokens would be encoded into QR codes and
//     emailed/delivered to the buyer; the DB never persists them.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface WebhookBody {
  event_type?: string
  order_id?: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // === STUB: skip Stripe signature verification ================================
  // Real impl: read raw body, verify with stripe.webhooks.constructEvent.
  let body: WebhookBody
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  if (body.event_type !== 'checkout.session.completed') {
    // Ignore other event types in the stub. Real impl handles refunds etc.
    return json(200, { ignored: true, event_type: body.event_type ?? null })
  }
  if (!body.order_id) return json(400, { error: 'missing_order_id' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'server_misconfigured' })

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, org_id, event_id, attendee_id, status, amount_cents')
    .eq('id', body.order_id)
    .maybeSingle()
  if (orderErr) return json(500, { error: 'order_lookup_failed', detail: orderErr.message })
  if (!order) return json(404, { error: 'order_not_found' })

  // Idempotency: a webhook may fire twice. If already paid, treat as success.
  if (order.status === 'paid' || order.status === 'fulfilled') {
    return json(200, { ok: true, already_paid: true, order_id: order.id })
  }
  if (order.status !== 'pending') {
    return json(409, { error: 'order_not_pending', status: order.status })
  }

  // Find the tier this order reserved. The pending order's reservation lives
  // on a single tier in the current model (one-tier-per-order). When multiple
  // tiers per order are supported, the order will need a join table.
  // For the stub, infer the tier via amount_cents / quantity is not reliable,
  // so we look up the most-recent reservation row. The cleanest fix in
  // production is to add a tier_id (or order_items table) to orders; out of
  // scope for the stub.
  const { data: tier, error: tierErr } = await admin
    .from('ticket_tiers')
    .select('id, event_id, price_cents, capacity, reserved_count, sold_count')
    .eq('event_id', order.event_id)
    .order('price_cents', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (tierErr) return json(500, { error: 'tier_lookup_failed', detail: tierErr.message })
  if (!tier) return json(500, { error: 'tier_not_found' })

  const quantity = Math.max(1, Math.floor(order.amount_cents / Math.max(1, tier.price_cents)))

  // Generate ticket rows. token_hash = sha256(random raw secret).
  const ticketRows: Array<{
    org_id: string
    event_id: string
    tier_id: string
    order_id: string
    attendee_id: string
    token_hash: string
    status: 'valid'
  }> = []
  for (let i = 0; i < quantity; i++) {
    const raw = crypto.randomUUID()
    const hash = await sha256Hex(raw)
    ticketRows.push({
      org_id: order.org_id,
      event_id: order.event_id,
      tier_id: tier.id,
      order_id: order.id,
      attendee_id: order.attendee_id,
      token_hash: hash,
      status: 'valid',
    })
  }

  const { error: insertErr } = await admin.from('tickets').insert(ticketRows)
  if (insertErr) return json(500, { error: 'ticket_insert_failed', detail: insertErr.message })

  // Flip reserved -> sold on the tier.
  const { error: tierUpdateErr } = await admin
    .from('ticket_tiers')
    .update({
      reserved_count: Math.max(0, tier.reserved_count - quantity),
      sold_count: tier.sold_count + quantity,
    })
    .eq('id', tier.id)
  if (tierUpdateErr) {
    return json(500, { error: 'tier_update_failed', detail: tierUpdateErr.message })
  }

  const { error: orderUpdateErr } = await admin
    .from('orders')
    .update({ status: 'paid' })
    .eq('id', order.id)
  if (orderUpdateErr) {
    return json(500, { error: 'order_update_failed', detail: orderUpdateErr.message })
  }

  return json(200, { ok: true, order_id: order.id, tickets_issued: quantity, stub: true })
})
