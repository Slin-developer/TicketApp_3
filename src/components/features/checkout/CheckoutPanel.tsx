import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useTiersByEvent } from '@/hooks/useEvents'
import { useCreateCheckout, useReserveTickets } from '@/hooks/useCheckout'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import type { CheckoutSession, ReserveResult, TicketTier } from '@/types/domain'

function describeReserve(r: ReserveResult): string {
  switch (r.result) {
    case 'success':
      return `Reserved ${r.quantity} × — order ${r.orderId} (€${(r.amountCents / 100).toFixed(2)}).`
    case 'sold_out':
      return `Sold out. Available: ${r.available}.`
    case 'tier_not_found':
      return 'Ticket tier not found.'
    case 'invalid_quantity':
      return 'Invalid quantity.'
    case 'unauthorized':
      return 'You must be signed in as the buyer.'
  }
}

interface Props {
  eventId: string
}

export function CheckoutPanel({ eventId }: Props) {
  const { user } = useAuth()
  const tiersQuery = useTiersByEvent(eventId)
  const reserve = useReserveTickets()
  const checkout = useCreateCheckout()

  const [tierId, setTierId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [session, setSession] = useState<CheckoutSession | null>(null)

  const tiers = tiersQuery.data ?? []

  function selectedTier(): TicketTier | undefined {
    return tiers.find((t) => t.id === tierId)
  }

  async function onReserve() {
    if (!user || !tierId) return
    setSession(null)
    const res = await reserve.mutateAsync({ tierId, quantity, buyerId: user.id })
    if (res.result === 'success') {
      setOrderId(res.orderId)
    } else {
      setOrderId(null)
    }
  }

  async function onCheckout() {
    if (!orderId) return
    const s = await checkout.mutateAsync({ orderId })
    setSession(s)
  }

  if (tiersQuery.isLoading) return <p>Loading tiers…</p>
  if (tiersQuery.isError) return <p role="alert">Failed to load tiers: {tiersQuery.error.message}</p>

  return (
    <section>
      <h2>Checkout</h2>

      {!user && <p>Sign in to reserve tickets.</p>}

      <div>
        <label htmlFor="tier">Tier</label>
        <Select
          id="tier"
          value={tierId}
          onChange={(e) => setTierId(e.target.value)}
          disabled={!user || reserve.isPending}
        >
          <option value="">— select a tier —</option>
          {tiers.map((t) => {
            const remaining = t.capacity - t.reserved_count - t.sold_count
            return (
              <option key={t.id} value={t.id} disabled={remaining <= 0}>
                {t.name} — €{(t.price_cents / 100).toFixed(2)} ({remaining} left)
              </option>
            )
          })}
        </Select>
      </div>

      <div>
        <label htmlFor="qty">Quantity</label>
        <Input
          id="qty"
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          disabled={!user || reserve.isPending}
        />
      </div>

      <Button
        type="button"
        onClick={onReserve}
        disabled={!user || !tierId || reserve.isPending}
      >
        {reserve.isPending ? 'Reserving…' : 'Reserve'}
      </Button>

      <output aria-live="polite">
        {reserve.isError && <p role="alert">Reserve error: {reserve.error.message}</p>}
        {reserve.data && <p>{describeReserve(reserve.data)}</p>}
        {selectedTier() && (
          <p>
            Advisory price: €{((selectedTier()!.price_cents * quantity) / 100).toFixed(2)}
          </p>
        )}
      </output>

      {orderId && (
        <div>
          <Button type="button" onClick={onCheckout} disabled={checkout.isPending}>
            {checkout.isPending ? 'Creating checkout…' : 'Proceed to checkout (stub)'}
          </Button>
          {checkout.isError && (
            <p role="alert">Checkout error: {checkout.error.message}</p>
          )}
          {session && (
            <p>
              Stub redirect URL:{' '}
              <a href={session.url} target="_blank" rel="noreferrer">
                {session.url}
              </a>{' '}
              (expires {new Date(session.expiresAt).toLocaleTimeString()})
            </p>
          )}
        </div>
      )}
    </section>
  )
}
