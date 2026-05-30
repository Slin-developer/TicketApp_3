import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { ScannerPanel } from '@/components/features/scanner/ScannerPanel'
import { CheckoutPanel } from '@/components/features/checkout/CheckoutPanel'
import { EventsPage } from '@/components/features/events/EventsPage'
import { MyTicketsPage } from '@/components/features/tickets/MyTicketsPage'
import { LoginPage } from '@/components/features/auth/LoginPage'
import { AppLayout } from '@/components/layout/AppLayout'

function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  return <Outlet />
}
function ScannerPage() {
  return (
    <AppLayout narrow>
      <div className="page-header">
        <h1>Scanner</h1>
        <p className="subtitle">Tickets am Einlass prüfen und einchecken.</p>
      </div>
      <ScannerPanel />
    </AppLayout>
  )
}
function AdminPage() {
  return (
    <AppLayout>
      <div className="page-header">
        <h1>Admin</h1>
        <p className="subtitle">Schnellzugriff auf die Werkzeuge des Teams.</p>
      </div>
      <div className="stack">
        <Link to="/scanner" className="card admin-tile">
          <h2>Ticket-Scanner</h2>
          <p>QR-Codes am Einlass scannen und Tickets entwerten.</p>
        </Link>
        <Link to="/events" className="card admin-tile">
          <h2>Events ansehen</h2>
          <p>Öffentliche Event-Liste und Checkout-Flow durchgehen.</p>
        </Link>
      </div>
    </AppLayout>
  )
}
function CheckoutPage() {
  const [params] = useSearchParams()
  const eventId = params.get('event') ?? 'public'
  return <CheckoutPanel eventId={eventId} />
}

const router = createBrowserRouter([
  // Public, guest-facing routes (no login required).
  { index: true, element: <Navigate to="/events" replace /> },
  { path: '/events', element: <EventsPage /> },
  { path: '/checkout', element: <CheckoutPage /> },
  { path: '/tickets/:ref', element: <MyTicketsPage /> },
  { path: '/login', element: <LoginPage /> },
  // Staff-only routes behind auth.
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/scanner', element: <ScannerPage /> },
      { path: '/admin', element: <AdminPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
