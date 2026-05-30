import type { Database } from './database.types'

export type ScanResult =
  | { result: 'success'; ticketId: string }
  | { result: 'already_scanned' }
  | { result: 'not_found' }
  | { result: 'unauthorized' }

export type OrderStatus = Database['public']['Enums']['order_status']
export type TicketStatus = Database['public']['Enums']['ticket_status']
export type OrgMemberRole = Database['public']['Enums']['org_member_role']

export type Order = Database['public']['Tables']['orders']['Row']
export type Ticket = Database['public']['Tables']['tickets']['Row']
export type EventRow = Database['public']['Tables']['events']['Row']
export type TicketTier = Database['public']['Tables']['ticket_tiers']['Row']
export type Organization = Database['public']['Tables']['organizations']['Row']
export type OrganizationMember =
  Database['public']['Tables']['organization_members']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']

export type PaymentStatus = 'idle' | 'pending' | 'succeeded' | 'failed'

export interface CheckoutSession {
  orderId: string
  url: string
  expiresAt: string
}

// Discriminated union returned by the reserve_tickets RPC. Mirrors the jsonb
// payload built in 0010_guest_checkout.sql. Guest checkout: success carries the
// orderReference (the bearer key the buyer later uses to fetch tickets), and
// the buyer is identified by email rather than auth.uid() — hence invalid_email
// replaces the old unauthorized branch.
export type ReserveResult =
  | {
      result: 'success'
      orderId: string
      orderReference: string
      amountCents: number
      quantity: number
    }
  | { result: 'sold_out'; available: number }
  | { result: 'tier_not_found' }
  | { result: 'invalid_quantity' }
  | { result: 'invalid_email' }

// A single issued ticket as surfaced by the get-tickets Edge Function. `token`
// is the derived HMAC QR payload (re-computed server-side, never stored).
export interface TicketView {
  id: string
  status: TicketStatus
  token: string
  tierName: string | null
}

// get-tickets response. `status` is 'pending' while the webhook is still
// fulfilling (frontend polls), 'paid' once tickets are issued, or a terminal
// order_status ('expired' / 'failed') the poller should stop on.
export interface OrderTicketsView {
  status: 'pending' | 'paid' | OrderStatus
  tickets: TicketView[]
  eventName: string | null
}
