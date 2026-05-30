// create-checkout Edge Function (real Stripe).
//
// Accepts { order_id } for a *pending* order created by the reserve_tickets RPC,
// then creates a real Stripe Checkout Session and returns its hosted URL +
// expiry. The frontend redirects the buyer there.
//
// SECURITY (RULES.md Rule 8 / ARCHITECTURE.md §3):
//   - The Stripe secret key lives only in Deno.env (Supabase Edge Function
//     secrets / supabase/functions/.env). It NEVER reaches the client.
//   - This function never issues tickets. Tickets are inserted only by
//     stripe-webhook after a verified checkout.session.completed event.
//   - The amount and line item are derived server-side from the order's tier,
//     never from client input, and are re-checked against orders.amount_cents
//     to catch any drift between reservation and checkout.
//
// Stripe Connect: if the event's organization has a stripe_account_id, the
// charge is routed to that connected account via destination charges
// (payment_intent_data.transfer_data.destination). An optional platform fee can
// be applied via PLATFORM_FEE_BPS. If the org isn't connected, the charge falls
// back to the platform account (useful for single-tenant / test setups).

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface CreateCheckoutBody {
  order_id?: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  let body: CreateCheckoutBody
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const orderId = body.order_id
  if (!orderId || typeof orderId !== 'string') {
    return json(400, { error: 'missing_order_id' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!supabaseUrl || !serviceKey || !stripeKey) {
    return json(500, { error: 'server_misconfigured' })
  }

  const currency = (Deno.env.get('STRIPE_CURRENCY') ?? 'eur').toLowerCase()
  const appUrl = Deno.env.get('APP_URL') ?? new URL(req.url).origin
  const feeBps = Number(Deno.env.get('PLATFORM_FEE_BPS') ?? '0')

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  })
  const admin = createClient(supabaseUrl, serviceKey)

  // Order must exist, be pending, and carry the tier/quantity reserve_tickets set.
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, org_id, event_id, status, amount_cents, tier_id, quantity, order_reference, buyer_email')
    .eq('id', orderId)
    .maybeSingle()
  if (orderErr) return json(500, { error: 'order_lookup_failed', detail: orderErr.message })
  if (!order) return json(404, { error: 'order_not_found' })
  if (order.status !== 'pending') {
    return json(409, { error: 'order_not_pending', status: order.status })
  }
  if (!order.tier_id || !order.quantity) {
    // Pre-0008 orders won't have these; they can't be checked out reliably.
    return json(409, { error: 'order_missing_tier_or_quantity' })
  }

  const { data: tier, error: tierErr } = await admin
    .from('ticket_tiers')
    .select('id, name, price_cents')
    .eq('id', order.tier_id)
    .maybeSingle()
  if (tierErr) return json(500, { error: 'tier_lookup_failed', detail: tierErr.message })
  if (!tier) return json(404, { error: 'tier_not_found' })

  // Guard against drift: the order's stored amount must match the live tier price.
  const expectedAmount = tier.price_cents * order.quantity
  if (expectedAmount !== order.amount_cents) {
    return json(409, {
      error: 'amount_mismatch',
      order_amount_cents: order.amount_cents,
      expected_amount_cents: expectedAmount,
    })
  }

  const { data: event, error: eventErr } = await admin
    .from('events')
    .select('id, name')
    .eq('id', order.event_id)
    .maybeSingle()
  if (eventErr) return json(500, { error: 'event_lookup_failed', detail: eventErr.message })
  if (!event) return json(404, { error: 'event_not_found' })

  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .select('id, stripe_account_id')
    .eq('id', order.org_id)
    .maybeSingle()
  if (orgErr) return json(500, { error: 'org_lookup_failed', detail: orgErr.message })
  if (!org) return json(404, { error: 'org_not_found' })

  // Metadata is the canonical order link carried through to the webhook. We set
  // it on both the Session and the PaymentIntent so refund/dispute events
  // (which surface a charge/PaymentIntent) can also be traced back if needed.
  const metadata: Record<string, string> = {
    order_id: order.id,
    org_id: order.org_id,
    event_id: order.event_id,
    tier_id: order.tier_id,
    quantity: String(order.quantity),
  }

  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    metadata,
  }
  if (org.stripe_account_id) {
    paymentIntentData.transfer_data = { destination: org.stripe_account_id }
    if (Number.isFinite(feeBps) && feeBps > 0) {
      paymentIntentData.application_fee_amount = Math.round((expectedAmount * feeBps) / 10000)
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: order.id,
      metadata,
      payment_intent_data: paymentIntentData,
      // Guest checkout: the buyer never logs in, so the email captured at
      // reservation is the only contact + the Stripe receipt target.
      customer_email: order.buyer_email ?? undefined,
      // Session lifetime: 31 min, not the exact 30-min floor. Stripe requires
      // expires_at to be AT LEAST 30 min out and evaluates it on receipt; the
      // boundary value drifts under request latency/clock skew and gets rejected
      // ("expires_at must be at least 30 minutes in the future"). The extra
      // minute keeps us safely above the floor. The order's hold is re-anchored
      // below to outlast whatever session Stripe actually mints.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      line_items: [
        {
          quantity: order.quantity,
          price_data: {
            currency,
            unit_amount: tier.price_cents,
            product_data: {
              name: `${event.name} — ${tier.name}`,
              metadata: { event_id: order.event_id, tier_id: order.tier_id },
            },
          },
        },
      ],
      // On success the buyer lands on their bearer-keyed My Tickets page, which
      // polls get-tickets until the webhook fulfils the order. order_reference
      // (not order_id) is the secret the buyer holds to retrieve tickets.
      success_url: `${appUrl}/tickets/${order.order_reference}`,
      cancel_url: `${appUrl}/events`,
    })

    if (!session.url) {
      return json(502, { error: 'stripe_no_url' })
    }

    // Re-anchor the order's hold to the session Stripe actually minted.
    // reserve_tickets set expires_at relative to RESERVE time, but the session's
    // clock starts HERE (checkout time). Any reserve->checkout delay erodes the
    // buffer; once it goes negative, reserve_tickets could reclaim the order
    // (status -> expired) while the session is still payable, leaving the buyer
    // charged with no tickets and the inventory potentially resold. Pinning the
    // hold to session.expires_at + 5 min keeps the reclaim deadline strictly
    // behind the payable window, regardless of how long the buyer waited.
    const holdExpiresAt = new Date((session.expires_at + 5 * 60) * 1000).toISOString()
    const { error: holdErr } = await admin
      .from('orders')
      .update({ expires_at: holdExpiresAt })
      .eq('id', order.id)
    if (holdErr) {
      return json(500, { error: 'hold_update_failed', detail: holdErr.message })
    }

    return json(200, {
      order_id: order.id,
      url: session.url,
      // Stripe expires_at is unix seconds; the frontend contract wants ISO.
      expires_at: new Date(session.expires_at * 1000).toISOString(),
    })
  } catch (err) {
    return json(502, { error: 'stripe_session_failed', detail: String(err) })
  }
})
