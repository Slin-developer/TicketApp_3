import { supabase } from '@/lib/supabaseClient'
import type { Database } from '@/types/database.types'
import type { EventRow, TicketTier } from '@/types/domain'

type EventInsert = Database['public']['Tables']['events']['Insert']
type EventUpdate = Database['public']['Tables']['events']['Update']
type TierInsert = Database['public']['Tables']['ticket_tiers']['Insert']
type TierUpdate = Database['public']['Tables']['ticket_tiers']['Update']

export interface IEventsRepository {
  listByOrg(orgId: string): Promise<EventRow[]>
  get(eventId: string): Promise<EventRow | null>
  create(input: EventInsert): Promise<EventRow>
  update(eventId: string, patch: EventUpdate): Promise<EventRow>
  remove(eventId: string): Promise<void>

  listTiers(eventId: string): Promise<TicketTier[]>
  createTier(input: TierInsert): Promise<TicketTier>
  updateTier(tierId: string, patch: TierUpdate): Promise<TicketTier>
  removeTier(tierId: string): Promise<void>
}

export const eventsService: IEventsRepository = {
  async listByOrg(orgId) {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('org_id', orgId)
      .order('starts_at', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  async get(eventId) {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle()
    if (error) throw error
    return data
  },

  async create(input) {
    const { data, error } = await supabase
      .from('events')
      .insert(input)
      .select('*')
      .single()
    if (error) throw error
    return data
  },

  async update(eventId, patch) {
    const { data, error } = await supabase
      .from('events')
      .update(patch)
      .eq('id', eventId)
      .select('*')
      .single()
    if (error) throw error
    return data
  },

  async remove(eventId) {
    const { error } = await supabase.from('events').delete().eq('id', eventId)
    if (error) throw error
  },

  async listTiers(eventId) {
    const { data, error } = await supabase
      .from('ticket_tiers')
      .select('*')
      .eq('event_id', eventId)
      .order('price_cents', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  async createTier(input) {
    const { data, error } = await supabase
      .from('ticket_tiers')
      .insert(input)
      .select('*')
      .single()
    if (error) throw error
    return data
  },

  async updateTier(tierId, patch) {
    const { data, error } = await supabase
      .from('ticket_tiers')
      .update(patch)
      .eq('id', tierId)
      .select('*')
      .single()
    if (error) throw error
    return data
  },

  async removeTier(tierId) {
    const { error } = await supabase.from('ticket_tiers').delete().eq('id', tierId)
    if (error) throw error
  },
}
