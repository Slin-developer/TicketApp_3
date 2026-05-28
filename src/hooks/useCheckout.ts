import { useMutation, useQueryClient } from '@tanstack/react-query'
import { paymentsService } from '@/services/supabase/paymentsService'
import type { CheckoutSession, ReserveResult } from '@/types/domain'
import type {
  CreateCheckoutInput,
  ReserveInput,
} from '@/services/supabase/IPaymentProvider'

export function useReserveTickets() {
  const qc = useQueryClient()
  return useMutation<ReserveResult, Error, ReserveInput>({
    mutationFn: (input) => paymentsService.reserveTickets(input),
    onSuccess: (_res, vars) => {
      // Reservation changes reserved_count on the tier and creates an order.
      qc.invalidateQueries({ queryKey: ['ticket_tiers'] })
      qc.invalidateQueries({ queryKey: ['orders', vars.buyerId] })
    },
  })
}

export function useCreateCheckout() {
  return useMutation<CheckoutSession, Error, CreateCheckoutInput>({
    mutationFn: (input) => paymentsService.createCheckout(input),
  })
}
