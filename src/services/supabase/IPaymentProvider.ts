import type { CheckoutSession, ReserveResult } from '@/types/domain'

export interface ReserveInput {
  tierId: string
  quantity: number
  email: string
}

export interface CreateCheckoutInput {
  orderId: string
}

// Per RULES.md Rule 8, ticket issuance is the webhook's job; this contract only
// covers (a) inventory reservation and (b) handing off a checkout URL to the
// frontend. The stub implementation fakes (b) until Stripe is wired up.
export interface IPaymentProvider {
  reserveTickets(input: ReserveInput): Promise<ReserveResult>
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>
}
