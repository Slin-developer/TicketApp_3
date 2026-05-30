import { FunctionsHttpError } from '@supabase/supabase-js'
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
    | 'invalid_email'
  order_id?: string
  order_reference?: string
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
      if (
        !r.order_id ||
        !r.order_reference ||
        typeof r.amount_cents !== 'number' ||
        typeof r.quantity !== 'number'
      ) {
        throw new Error('reserve_tickets success missing fields.')
      }
      return {
        result: 'success',
        orderId: r.order_id,
        orderReference: r.order_reference,
        amountCents: r.amount_cents,
        quantity: r.quantity,
      }
    case 'sold_out':
      return { result: 'sold_out', available: r.available ?? 0 }
    case 'tier_not_found':
      return { result: 'tier_not_found' }
    case 'invalid_quantity':
      return { result: 'invalid_quantity' }
    case 'invalid_email':
      return { result: 'invalid_email' }
    default:
      throw new Error(`reserve_tickets returned unknown result: ${String(r.result)}`)
  }
}

// supabase-js surfaces non-2xx Edge Function responses as FunctionsHttpError
// with the original Response on `.context`. Pull the JSON `error` code out so a
// known business outcome (a 409 order_not_pending — the reservation hold lapsed
// before checkout) can be turned into a friendly message instead of a raw
// "Edge Function returned a non-2xx status code".
async function rethrowFunctionError(error: unknown): Promise<never> {
  if (error instanceof FunctionsHttpError) {
    let code: string | undefined
    try {
      const body = await error.context.json()
      code = typeof body?.error === 'string' ? body.error : undefined
    } catch {
      // fall through to the generic error below
    }
    if (code === 'order_not_pending') {
      throw new Error('Reservation expired. Please try again.')
    }
    if (code) throw new Error(`Checkout failed: ${code}`)
  }
  throw error
}

// Payments provider. reserveTickets hits the reserve_tickets DB RPC (guest
// checkout: email-keyed, no auth). createCheckout invokes the create-checkout
// Edge Function, which mints a real Stripe Checkout Session and returns its
// hosted URL for the frontend to redirect to.
export const paymentsService: IPaymentProvider = {
  async reserveTickets({ tierId, quantity, email }: ReserveInput): Promise<ReserveResult> {
    const { data, error } = await supabase.rpc('reserve_tickets', {
      p_tier_id: tierId,
      p_quantity: quantity,
      p_buyer_email: email,
    })
    if (error) throw error
    return parseReserveResponse(data)
  },

  async createCheckout({ orderId }: CreateCheckoutInput): Promise<CheckoutSession> {
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { order_id: orderId },
    })
    if (error) await rethrowFunctionError(error)
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
