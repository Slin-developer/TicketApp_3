import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { eventsService } from '@/services/supabase/eventsService'
import type { Database } from '@/types/database.types'
import type { EventRow, TicketTier } from '@/types/domain'

type EventInsert = Database['public']['Tables']['events']['Insert']
type EventUpdate = Database['public']['Tables']['events']['Update']
type TierInsert = Database['public']['Tables']['ticket_tiers']['Insert']
type TierUpdate = Database['public']['Tables']['ticket_tiers']['Update']

const publicEventsKey = ['events', 'public'] as const
const eventsKey = (orgId: string) => ['events', 'by-org', orgId] as const
const eventKey = (eventId: string) => ['events', 'one', eventId] as const
const tiersKey = (eventId: string) => ['ticket_tiers', 'by-event', eventId] as const

export function usePublicEvents() {
  return useQuery<EventRow[], Error>({
    queryKey: publicEventsKey,
    queryFn: () => eventsService.listPublic(),
  })
}

export function useEventsByOrg(orgId: string | null | undefined) {
  return useQuery<EventRow[], Error>({
    queryKey: eventsKey(orgId ?? ''),
    queryFn: () => eventsService.listByOrg(orgId as string),
    enabled: Boolean(orgId),
  })
}

export function useEvent(eventId: string | null | undefined) {
  return useQuery<EventRow | null, Error>({
    queryKey: eventKey(eventId ?? ''),
    queryFn: () => eventsService.get(eventId as string),
    enabled: Boolean(eventId),
  })
}

export function useTiersByEvent(eventId: string | null | undefined) {
  return useQuery<TicketTier[], Error>({
    queryKey: tiersKey(eventId ?? ''),
    queryFn: () => eventsService.listTiers(eventId as string),
    enabled: Boolean(eventId),
  })
}

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation<EventRow, Error, EventInsert>({
    mutationFn: (input) => eventsService.create(input),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: eventsKey(row.org_id) })
    },
  })
}

export function useUpdateEvent() {
  const qc = useQueryClient()
  return useMutation<EventRow, Error, { id: string; patch: EventUpdate }>({
    mutationFn: ({ id, patch }) => eventsService.update(id, patch),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: eventsKey(row.org_id) })
      qc.invalidateQueries({ queryKey: eventKey(row.id) })
    },
  })
}

export function useDeleteEvent(orgId: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (eventId) => eventsService.remove(eventId),
    onSuccess: () => {
      if (orgId) qc.invalidateQueries({ queryKey: eventsKey(orgId) })
    },
  })
}

export function useCreateTier() {
  const qc = useQueryClient()
  return useMutation<TicketTier, Error, TierInsert>({
    mutationFn: (input) => eventsService.createTier(input),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: tiersKey(row.event_id) })
    },
  })
}

export function useUpdateTier() {
  const qc = useQueryClient()
  return useMutation<TicketTier, Error, { id: string; patch: TierUpdate }>({
    mutationFn: ({ id, patch }) => eventsService.updateTier(id, patch),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: tiersKey(row.event_id) })
    },
  })
}

export function useDeleteTier(eventId: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (tierId) => eventsService.removeTier(tierId),
    onSuccess: () => {
      if (eventId) qc.invalidateQueries({ queryKey: tiersKey(eventId) })
    },
  })
}
