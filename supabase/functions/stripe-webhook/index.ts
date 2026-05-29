// stripe-webhook Edge Function (real Stripe).
//
// THE trust boundary for ticket issuance (RULES.md Rule 8 / ARCHITECTURE.md §3):
//   1. Read the raw body + Stripe-Signature header.
//   2. Verify the signature with stripe.webhooks.constructEventAsync against
//      STRIPE_WEBHOOK_SECRET. Any failure -> 400, nothing else happens.
//   3. checkout.session.completed (payment_status === 'paid') -> issue tickets.
//      charge.refunded / charge.dispute.created -> void the order's tickets.
//
// Fulfilment and voiding run inside SECURITY DEFINER RPCs (0009_fulfilment_rpcs)
// so they are atomic and idempotent against Stripe's at-least-once retries.
//
// Ticket token model (ARCHITECTURE.md §5): we mint a high-entropy raw token per
// ticket (UUIDv4 = 122 bits) and persist ONLY sha256(raw) as tickets.token_hash.
// NOTE: raw tokens are not yet delivered to the buyer (QR/email) — that delivery
// step is a separate follow-up; without it the issued tickets can't be scanned.

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cryptoProvider = Stripe.createSubtleCryptoProvider()

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!supabaseUrl || !serviceKey || !stripeKey || !webhookSecret) {
    return json(500, { error: 'server_misconfigured' })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return json(400, { error: 'missing_signature' })

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  })

  // Verify the signature against the RAW request body. Must use the unparsed
  // text — re-serialized JSON would not match the signature.
  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    )
  } catch (err) {
    return json(400, { error: 'invalid_signature', detail: String(err) })
  }

  const admin = createClient(supabaseUrl, serviceKey)

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      // Only fulfil once the payment actually succeeded.
      if (session.payment_status !== 'paid') {
        return json(200, { ignored: true, reason: 'not_paid', payment_status: session.payment_status })
      }

      const orderId = session.metadata?.order_id ?? session.client_reference_id ?? null
      if (!orderId) return json(400, { error: 'missing_order_id' })

      // We must know the quantity to mint the right number of tokens. Trust the
      // order row (set by reserve_tickets), not client/session-supplied values.
      const { data: order, error: orderErr } = await admin
        .from('orders')
        .select('id, status, quantity')
        .eq('id', orderId)
        .maybeSingle()
      if (orderErr) return json(500, { error: 'order_lookup_failed', detail: orderErr.message })
      if (!order) return json(404, { error: 'order_not_found' })
      if (order.status === 'paid' || order.status === 'fulfilled') {
        return json(200, { ok: true, already_paid: true, order_id: order.id })
      }
      if (!order.quantity || order.quantity < 1) {
        return json(409, { error: 'order_missing_quantity' })
      }

      // Mint one raw token per ticket; persist only the hashes via the RPC.
      const tokenHashes: string[] = []
      for (let i = 0; i < order.quantity; i++) {
        tokenHashes.push(await sha256Hex(crypto.randomUUID()))
      }

      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null

      const { data: result, error: rpcErr } = await admin.rpc('fulfill_paid_order', {
        p_order_id: orderId,
        p_payment_intent_id: paymentIntentId,
        p_token_hashes: tokenHashes,
      })
      if (rpcErr) return json(500, { error: 'fulfilment_failed', detail: rpcErr.message })

      const r = result as { result?: string; tickets_issued?: number }
      if (r?.result === 'fulfilled' || r?.result === 'already_paid') {
        return json(200, { ok: true, order_id: orderId, ...r })
      }
      // Any other RPC result (quantity_mismatch, order_not_pending, …) is a
      // 500 so Stripe retries and we get alerted via logs.
      return json(500, { error: 'fulfilment_rejected', detail: r })
    }

    case 'charge.refunded':
    case 'charge.dispute.created': {
      // Both events surface a charge carrying the PaymentIntent id we stored on
      // the order at fulfilment time. Void that order's tickets.
      const obj = event.data.object as Stripe.Charge | Stripe.Dispute
      const paymentIntentId =
        typeof obj.payment_intent === 'string'
          ? obj.payment_intent
          : obj.payment_intent?.id ?? null
      if (!paymentIntentId) {
        return json(200, { ignored: true, reason: 'no_payment_intent', event_type: event.type })
      }

      const { data: result, error: rpcErr } = await admin.rpc('void_order_by_payment_intent', {
        p_payment_intent_id: paymentIntentId,
      })
      if (rpcErr) return json(500, { error: 'void_failed', detail: rpcErr.message })

      const r = result as { result?: string; tickets_voided?: number }
      // order_not_found is benign (e.g. refund of something we never fulfilled):
      // ack so Stripe stops retrying.
      return json(200, { ok: true, event_type: event.type, ...r })
    }

    default:
      // Acknowledge unhandled events so Stripe doesn't retry them.
      return json(200, { ignored: true, event_type: event.type })
  }
})
