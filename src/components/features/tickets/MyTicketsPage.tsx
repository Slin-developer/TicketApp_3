import { useEffect, useState, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useParams } from 'react-router-dom'
import { useOrderTickets } from '@/hooks/useTickets'
import { AppLayout } from '@/components/layout/AppLayout'
import './MyTicketsPage.css'

// How long to keep showing "Finalizing…" before telling the buyer the payment
// never landed. Kept just past the hook's polling cap (~2 min).
const GIVE_UP_MS = 125_000

// Small wrapper so every state of this page shares the same header + shell.
function TicketsShell({ children }: { children: ReactNode }) {
  return (
    <AppLayout>
      <div className="page-header">
        <h1>Meine Tickets</h1>
        <p className="subtitle">Zeige diesen QR-Code am Einlass vor.</p>
      </div>
      {children}
    </AppLayout>
  )
}

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
      <TicketsShell>
        <p className="message error" role="alert">
          Fehlende Bestellreferenz.
        </p>
      </TicketsShell>
    )
  }

  if (query.isLoading) {
    return (
      <TicketsShell>
        <div className="card stack">
          <div className="skeleton-line medium" />
          <div className="skeleton-line short" />
        </div>
      </TicketsShell>
    )
  }

  if (query.isError) {
    return (
      <TicketsShell>
        <p className="message error" role="alert">
          Tickets konnten nicht geladen werden: {query.error.message}
        </p>
      </TicketsShell>
    )
  }

  const data = query.data
  if (!data) return null

  if (data.status === 'pending') {
    return (
      <TicketsShell>
        <div className="card finalizing">
          {gaveUp ? (
            <p className="message error" role="alert">
              Bestellung noch nicht bezahlt. Prüfe deine E-Mails oder versuche es erneut.
            </p>
          ) : (
            <>
              <div className="spinner" />
              <p className="muted" aria-live="polite">
                Deine Bestellung wird abgeschlossen…
              </p>
            </>
          )}
        </div>
      </TicketsShell>
    )
  }

  if (data.status !== 'paid') {
    // Terminal non-paid state (expired hold / refunded / failed).
    return (
      <TicketsShell>
        <p className="message error" role="alert">
          Diese Bestellung ist {data.status}. Es sind keine Tickets verfügbar.
        </p>
      </TicketsShell>
    )
  }

  return (
    <TicketsShell>
      <div className="tickets-banner">
        <span className="check">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
            <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h2>Zahlung bestätigt</h2>
          <p>{data.eventName ?? 'Deine Tickets sind bereit.'}</p>
        </div>
      </div>

      {data.tickets.length === 0 && (
        <div className="empty-state">
          <div className="empty-emoji">🎟️</div>
          <p>Keine Tickets für diese Bestellung gefunden.</p>
        </div>
      )}

      <div className="stack">
        {data.tickets.map((ticket, index) => (
          <article key={ticket.id} className="card ticket-qr-card">
            <div className="ticket-qr-frame">
              <QRCodeSVG value={ticket.token} size={104} />
            </div>
            <div className="ticket-qr-meta">
              <p className="ticket-tier">{ticket.tierName ?? `Ticket ${index + 1}`}</p>
              {ticket.status === 'valid' ? (
                <span className="badge green">Gültig</span>
              ) : (
                <span className="badge">Status: {ticket.status}</span>
              )}
              <p className="ticket-hint">Am Einlass scannen lassen.</p>
            </div>
          </article>
        ))}
      </div>
    </TicketsShell>
  )
}
