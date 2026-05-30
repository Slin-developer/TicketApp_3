// get-tickets Edge Function (guest ticket retrieval).
//
// The buyer never logs in (Phase 8 guest checkout). After paying they land on
// /tickets/{order_reference}; this function is how that page fetches their QR
// codes. order_reference is the bearer key — knowing it is sufficient to read
// the order's tickets, so it is a high-entropy UUID minted server-side.
//
// Token model (ARCHITECTURE.md §5): tokens are DERIVED, never stored. For each
// paid ticket we recompute token = HMAC_SHA256(TICKET_TOKEN_SECRET, ticket_id),
// byte-identical to stripe-webhook's minting. The DB only ever holds
// sha256(token) as tickets.token_hash, so this lookup re-derives the live QR
// value without anything secret being at rest.
//
// While the order is still pending (webhook hasn't fulfilled yet) we return
// { status: 'pending', tickets: [] } so the frontend can poll.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface GetTicketsBody {
  order_reference?: string
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

// Re-derive a ticket's QR token from its stable id. MUST stay byte-identical to
// stripe-webhook's deriveToken so the value the buyer scans hashes back to the
// stored token_hash.
async function deriveToken(secret: string, ticketId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ticketId))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  let body: GetTicketsBody
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const orderReference = body.order_reference
  if (!orderReference || typeof orderReference !== 'string') {
    return json(400, { error: 'missing_order_reference' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const tokenSecret = Deno.env.get('TICKET_TOKEN_SECRET')
  if (!supabaseUrl || !serviceKey || !tokenSecret) {
    return json(500, { error: 'server_misconfigured' })
  }

  const admin = createClient(supabaseUrl, serviceKey)

  // Bearer lookup: the order_reference alone authorizes reading this order.
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, status, event_id')
    .eq('order_reference', orderReference)
    .maybeSingle()
  if (orderErr) return json(500, { error: 'order_lookup_failed', detail: orderErr.message })
  if (!order) return json(404, { error: 'order_not_found' })

  const { data: event, error: eventErr } = await admin
    .from('events')
    .select('name')
    .eq('id', order.event_id)
    .maybeSingle()
  if (eventErr) return json(500, { error: 'event_lookup_failed', detail: eventErr.message })
  const eventName = event?.name ?? null

  // Distinguish "not fulfilled yet" (keep polling) from terminal states (stop).
  // 'pending' = webhook hasn't fulfilled — frontend polls. A refund/dispute
  // moves the order to 'failed' (void_order_by_payment_intent) and an abandoned
  // hold to 'expired' (reserve_tickets reclaim); surfacing those verbatim lets
  // the poller stop instead of showing "Finalizing…" forever.
  if (order.status !== 'paid' && order.status !== 'fulfilled') {
    const polling = order.status === 'pending'
    return json(200, {
      status: polling ? 'pending' : order.status,
      tickets: [],
      event_name: eventName,
    })
  }

  const { data: tickets, error: ticketsErr } = await admin
    .from('tickets')
    .select('id, status, ticket_tiers ( name )')
    .eq('order_id', order.id)
    .order('created_at', { ascending: true })
  if (ticketsErr) return json(500, { error: 'tickets_lookup_failed', detail: ticketsErr.message })

  const out = await Promise.all(
    (tickets ?? []).map(async (t) => {
      const tier = t.ticket_tiers as { name?: string } | { name?: string }[] | null
      const tierName = Array.isArray(tier) ? tier[0]?.name ?? null : tier?.name ?? null
      return {
        id: t.id,
        status: t.status,
        token: await deriveToken(tokenSecret, t.id),
        tier_name: tierName,
      }
    }),
  )

  return json(200, { status: 'paid', tickets: out, event_name: eventName })
})
