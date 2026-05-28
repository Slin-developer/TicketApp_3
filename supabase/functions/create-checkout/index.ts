// Phase 6 stub: create-checkout Edge Function.
//
// Accepts { order_id } in the request body, looks up the order's organization,
// and returns a FAKE redirect URL so the frontend can exercise the full
// reserve -> checkout pipeline without real Stripe keys.
//
// When Stripe is wired up:
//   1. Read STRIPE_SECRET_KEY from Deno.env (already slotted in
//      supabase/functions/.env). Do NOT read it on the client.
//   2. Use organizations.stripe_account_id (Stripe Connect) as the destination.
//   3. Replace the fake URL block with `stripe.checkout.sessions.create({...})`
//      and return session.url + session.expires_at.
//
// SECURITY: this Edge Function never issues tickets. Tickets are only inserted
// by stripe-webhook after signature verification (RULES.md Rule 8).

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
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: 'server_misconfigured' })
  }

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, org_id, status, amount_cents')
    .eq('id', orderId)
    .maybeSingle()
  if (orderErr) return json(500, { error: 'order_lookup_failed', detail: orderErr.message })
  if (!order) return json(404, { error: 'order_not_found' })
  if (order.status !== 'pending') {
    return json(409, { error: 'order_not_pending', status: order.status })
  }

  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .select('id, stripe_account_id')
    .eq('id', order.org_id)
    .maybeSingle()
  if (orgErr) return json(500, { error: 'org_lookup_failed', detail: orgErr.message })
  if (!org) return json(404, { error: 'org_not_found' })

  // === STUB: fake Stripe Checkout URL ==========================================
  // Replace this block with stripe.checkout.sessions.create({...}) when wiring
  // up real Stripe. The shape returned here matches what the real call returns
  // (url + expires_at), so the frontend contract stays stable.
  const fakeUrl = `https://fake-stripe.local/checkout/${orderId}`
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  return json(200, {
    order_id: orderId,
    url: fakeUrl,
    expires_at: expiresAt,
    stripe_account_id: org.stripe_account_id, // null in the stub flow
    stub: true,
  })
})
