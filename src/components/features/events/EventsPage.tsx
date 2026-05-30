import { Link } from 'react-router-dom'
import { usePublicEvents } from '@/hooks/useEvents'

// Public, logged-out landing page: lists seeded events and links each to the
// guest checkout flow. No org scoping — relies on the public read RLS policy.
export function EventsPage() {
  const events = usePublicEvents()

  return (
    <main>
      <h1>Events</h1>

      {events.isLoading && <p>Loading events…</p>}
      {events.isError && <p role="alert">Failed to load events: {events.error.message}</p>}
      {events.data && events.data.length === 0 && <p>No events available.</p>}

      <ul>
        {(events.data ?? []).map((event) => (
          <li key={event.id}>
            <h2>{event.name}</h2>
            {event.starts_at && (
              <p>{new Date(event.starts_at).toLocaleString()}</p>
            )}
            <Link to={`/checkout?event=${event.id}`}>Buy tickets</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
