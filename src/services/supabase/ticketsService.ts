import { supabase } from '@/lib/supabaseClient'
import type { OrderTicketsView, TicketView } from '@/types/domain'

// Raw shape returned by the get-tickets Edge Function (snake_case JSON).
interface RawGetTickets {
  status?: string
  event_name?: string | null
  tickets?: Array<{
    id?: string
    status?: string
    token?: string
    tier_name?: string | null
  }>
}

function parseGetTickets(raw: unknown): OrderTicketsView {
  const r = raw as RawGetTickets | null
  if (!r || typeof r !== 'object' || typeof r.status !== 'string') {
    throw new Error('get-tickets returned an unrecognized payload.')
  }
  const tickets: TicketView[] = (r.tickets ?? []).map((t) => {
    if (!t.id || !t.status || !t.token) {
      throw new Error('get-tickets returned a malformed ticket.')
    }
    return {
      id: t.id,
      status: t.status as TicketView['status'],
      token: t.token,
      tierName: t.tier_name ?? null,
    }
  })
  return {
    status: r.status as OrderTicketsView['status'],
    tickets,
    eventName: r.event_name ?? null,
  }
}

export interface ITicketsRepository {
  getOrderByReference(orderReference: string): Promise<OrderTicketsView>
}

// Guest ticket reads. The order_reference is the bearer key — the buyer never
// logs in — so retrieval goes through the get-tickets Edge Function (service
// role) rather than an RLS-guarded table read. Throws on transport/shape errors;
// pending vs paid is a normal status the caller polls on, not an error.
export const ticketsService: ITicketsRepository = {
  async getOrderByReference(orderReference: string): Promise<OrderTicketsView> {
    const { data, error } = await supabase.functions.invoke('get-tickets', {
      body: { order_reference: orderReference },
    })
    if (error) throw error
    return parseGetTickets(data)
  },
}
