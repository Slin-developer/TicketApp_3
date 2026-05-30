import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useParams } from 'react-router-dom'
import { useOrderTickets } from '@/hooks/useTickets'

// How long to keep showing "Finalizing…" before telling the buyer the payment
// never landed. Kept just past the hook's polling cap (~2 min).
const GIVE_UP_MS = 125_000

// Bearer-keyed My Tickets page. The buyer lands here after paying; the order is
// fulfilled asynchronously by the webhook, so we poll get-tickets until the
// status flips to 'paid' and the QR codes appear.
export function MyTicketsPage() {
  const { ref } = useParams<{ ref: string }>()
  const query = useOrderTickets(ref)
  const status = query.data?.status

  // Once we've been pending for GIVE_UP_MS, stop saying "Finalizing…". The
  // effect keys off `status`, so the timer arms when pending first appears and
  // is cleared the moment the status moves on.
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (status !== 'pending') return
    const timer = setTimeout(() => setGaveUp(true), GIVE_UP_MS)
    return () => clearTimeout(timer)
  }, [status])

  if (!ref) {
    return (
      <main>
        <h1>My Tickets</h1>
        <p role="alert">Missing order reference.</p>
      </main>
    )
  }

  if (query.isLoading) {
    return (
      <main>
        <h1>My Tickets</h1>
        <p>Loading…</p>
      </main>
    )
  }

  if (query.isError) {
    return (
      <main>
        <h1>My Tickets</h1>
        <p role="alert">Couldn’t load your tickets: {query.error.message}</p>
      </main>
    )
  }

  const data = query.data
  if (!data) return null

  if (data.status === 'pending') {
    return (
      <main>
        <h1>My Tickets</h1>
        {gaveUp ? (
          <p role="alert">
            Order not paid yet. Check your email or try again.
          </p>
        ) : (
          <p aria-live="polite">Finalizing your order…</p>
        )}
      </main>
    )
  }

  if (data.status !== 'paid') {
    // Terminal non-paid state (expired hold / refunded / failed).
    return (
      <main>
        <h1>My Tickets</h1>
        <p role="alert">This order is {data.status}. No tickets are available.</p>
      </main>
    )
  }

  return (
    <main>
      <h1>My Tickets</h1>
      {data.eventName && <h2>{data.eventName}</h2>}
      {data.tickets.length === 0 && <p>No tickets found for this order.</p>}
      <ul>
        {data.tickets.map((ticket) => (
          <li key={ticket.id}>
            <QRCodeSVG value={ticket.token} />
            {ticket.tierName && <p>{ticket.tierName}</p>}
            {ticket.status !== 'valid' && <p>Status: {ticket.status}</p>}
          </li>
        ))}
      </ul>
    </main>
  )
}
