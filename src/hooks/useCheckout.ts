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
    onSuccess: () => {
      // Reservation changes reserved_count on the tier (refresh "N left").
      // Guest orders aren't read back by the client, so no order cache to bust.
      qc.invalidateQueries({ queryKey: ['ticket_tiers'] })
    },
  })
}

export function useCreateCheckout() {
  return useMutation<CheckoutSession, Error, CreateCheckoutInput>({
    mutationFn: (input) => paymentsService.createCheckout(input),
  })
}
