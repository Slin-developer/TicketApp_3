import { Link } from 'react-router-dom'
import { usePublicEvents } from '@/hooks/useEvents'
import { AppLayout } from '@/components/layout/AppLayout'
import './EventsPage.css'

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4.5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// Public, logged-out landing page: lists seeded events and links each to the
// guest checkout flow. No org scoping — relies on the public read RLS policy.
export function EventsPage() {
  const events = usePublicEvents()

  return (
    <AppLayout>
      <div className="page-header">
        <h1>Events</h1>
        <p className="subtitle">Sichere dir Tickets — sofort, sicher, digital.</p>
      </div>

      {events.isLoading && (
        <div className="stack">
          {[1, 2].map((i) => (
            <div key={i} className="card">
              <div className="skeleton-line medium" />
              <div className="skeleton-line short" />
            </div>
          ))}
        </div>
      )}

      {events.isError && (
        <p className="message error" role="alert">
          Events konnten nicht geladen werden: {events.error.message}
        </p>
      )}

      {events.data && events.data.length === 0 && (
        <div className="empty-state">
          <div className="empty-emoji">🎟️</div>
          <p>Derzeit sind keine Events verfügbar.</p>
        </div>
      )}

      <div className="stack">
        {(events.data ?? []).map((event) => (
          <article key={event.id} className="card event-card">
            <div className="event-card-top">
              <div>
                <h2 className="event-title">{event.name}</h2>
                {event.description && <p className="event-description">{event.description}</p>}
              </div>
            </div>

            {event.starts_at && (
              <span className="event-date">
                <CalendarIcon />
                {dateFormatter.format(new Date(event.starts_at))}
              </span>
            )}

            <div className="event-card-actions">
              <span className="badge green">Tickets verfügbar</span>
              <Link to={`/checkout?event=${event.id}`} className="btn btn-primary">
                Tickets sichern
              </Link>
            </div>
          </article>
        ))}
      </div>
    </AppLayout>
  )
}
