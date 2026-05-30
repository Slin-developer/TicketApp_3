import { useQuery } from '@tanstack/react-query'
import { ticketsService } from '@/services/supabase/ticketsService'
import type { OrderTicketsView } from '@/types/domain'

const orderTicketsKey = (ref: string) => ['tickets', 'by-order-ref', ref] as const

// Stop polling after ~2 min of "pending". At 2s/poll that's 60 fetches; the
// webhook fulfils within seconds in practice, so still-pending past this means
// the payment never completed (abandoned / failed).
export const MAX_PENDING_POLLS = 60

// Fetches a guest order's tickets by its bearer reference, polling every 2s
// while the webhook is still fulfilling (status === 'pending'). Stops once a
// terminal status arrives or the poll cap is hit, so the page never spins
// forever.
export function useOrderTickets(orderReference: string | null | undefined) {
  return useQuery<OrderTicketsView, Error>({
    queryKey: orderTicketsKey(orderReference ?? ''),
    queryFn: () => ticketsService.getOrderByReference(orderReference as string),
    enabled: Boolean(orderReference),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || data.status !== 'pending') return false
      if (query.state.dataUpdateCount >= MAX_PENDING_POLLS) return false
      return 2000
    },
  })
}
