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
