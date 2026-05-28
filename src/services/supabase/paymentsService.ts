import { supabase } from '@/lib/supabaseClient'
import type { CheckoutSession, ReserveResult } from '@/types/domain'
import type {
  CreateCheckoutInput,
  IPaymentProvider,
  ReserveInput,
} from './IPaymentProvider'

interface RawReserveResponse {
  result:
    | 'success'
    | 'sold_out'
    | 'tier_not_found'
    | 'invalid_quantity'
    | 'unauthorized'
  order_id?: string
  amount_cents?: number
  quantity?: number
  available?: number
}

function parseReserveResponse(raw: unknown): ReserveResult {
  const r = raw as RawReserveResponse | null
  if (!r || typeof r !== 'object' || typeof r.result !== 'string') {
    throw new Error('reserve_tickets returned an unrecognized payload.')
  }
  switch (r.result) {
    case 'success':
      if (!r.order_id || typeof r.amount_cents !== 'number' || typeof r.quantity !== 'number') {
        throw new Error('reserve_tickets success missing fields.')
      }
      return {
        result: 'success',
        orderId: r.order_id,
        amountCents: r.amount_cents,
        quantity: r.quantity,
      }
    case 'sold_out':
      return { result: 'sold_out', available: r.available ?? 0 }
    case 'tier_not_found':
      return { result: 'tier_not_found' }
    case 'invalid_quantity':
      return { result: 'invalid_quantity' }
    case 'unauthorized':
      return { result: 'unauthorized' }
    default:
      throw new Error(`reserve_tickets returned unknown result: ${String(r.result)}`)
  }
}

// Stubbed payments provider. reserveTickets hits the real DB RPC (no Stripe
// involved). createCheckout invokes the create-checkout Edge Function — which
// is itself stubbed until Phase 6's Stripe wiring lands — so the whole
// pipeline is exercisable end-to-end without real keys.
export const paymentsService: IPaymentProvider = {
  async reserveTickets({ tierId, quantity, buyerId }: ReserveInput): Promise<ReserveResult> {
    const { data, error } = await supabase.rpc('reserve_tickets', {
      p_tier_id: tierId,
      p_quantity: quantity,
      p_buyer_id: buyerId,
    })
    if (error) throw error
    return parseReserveResponse(data)
  },

  async createCheckout({ orderId }: CreateCheckoutInput): Promise<CheckoutSession> {
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { order_id: orderId },
    })
    if (error) throw error
    if (!data || typeof data !== 'object') {
      throw new Error('create-checkout returned no payload.')
    }
    const payload = data as {
      order_id?: string
      url?: string
      expires_at?: string
    }
    if (!payload.order_id || !payload.url || !payload.expires_at) {
      throw new Error('create-checkout payload is missing fields.')
    }
    return {
      orderId: payload.order_id,
      url: payload.url,
      expiresAt: payload.expires_at,
    }
  },
}
