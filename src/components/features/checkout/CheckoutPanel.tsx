import { useState } from 'react'
import { useTiersByEvent } from '@/hooks/useEvents'
import { useCreateCheckout, useReserveTickets } from '@/hooks/useCheckout'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import type { ReserveResult, TicketTier } from '@/types/domain'

function describeReserve(r: ReserveResult): string {
  switch (r.result) {
    case 'success':
      return `Reserved ${r.quantity} × — €${(r.amountCents / 100).toFixed(2)}. Proceed to payment.`
    case 'sold_out':
      return `Sold out. Available: ${r.available}.`
    case 'tier_not_found':
      return 'Ticket tier not found.'
    case 'invalid_quantity':
      return 'Invalid quantity.'
    case 'invalid_email':
      return 'Please enter a valid email address.'
  }
}

interface Props {
  eventId: string
}

export function CheckoutPanel({ eventId }: Props) {
  const tiersQuery = useTiersByEvent(eventId)
  const reserve = useReserveTickets()
  const checkout = useCreateCheckout()

  const [email, setEmail] = useState('')
  const [tierId, setTierId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [orderId, setOrderId] = useState<string | null>(null)

  const tiers = tiersQuery.data ?? []
  const busy = reserve.isPending || checkout.isPending

  function selectedTier(): TicketTier | undefined {
    return tiers.find((t) => t.id === tierId)
  }

  async function onReserve() {
    if (!tierId || !email.trim()) return
    // A fresh reservation invalidates any previous order.
    setOrderId(null)
    const res = await reserve.mutateAsync({ tierId, quantity, email: email.trim() })
    if (res.result === 'success') {
      setOrderId(res.orderId)
    }
  }

  async function onCheckout() {
    if (!orderId) return
    const session = await checkout.mutateAsync({ orderId })
    // Hand the buyer off to Stripe's hosted checkout. On success Stripe returns
    // them to /tickets/<order_reference> (set as success_url server-side).
    window.location.assign(session.url)
  }

  if (tiersQuery.isLoading) return <p>Loading tiers…</p>
  if (tiersQuery.isError) return <p role="alert">Failed to load tiers: {tiersQuery.error.message}</p>

  return (
    <section>
      <h2>Checkout</h2>

      <div>
        <label htmlFor="email">Email</label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </div>

      <div>
        <label htmlFor="tier">Tier</label>
        <Select
          id="tier"
          value={tierId}
          onChange={(e) => setTierId(e.target.value)}
          disabled={busy}
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
          disabled={busy}
        />
      </div>

      <Button
        type="button"
        onClick={onReserve}
        disabled={busy || !tierId || !email.trim()}
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
            {checkout.isPending ? 'Redirecting…' : 'Proceed to checkout'}
          </Button>
          {checkout.isError && (
            <p role="alert">Checkout error: {checkout.error.message}</p>
          )}
        </div>
      )}
    </section>
  )
}
