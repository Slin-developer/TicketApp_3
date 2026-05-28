import { createBrowserRouter, Navigate, Outlet, RouterProvider, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { ScannerPanel } from '@/components/features/scanner/ScannerPanel'
import { CheckoutPanel } from '@/components/features/checkout/CheckoutPanel'

function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

// Stub pages — replaced in subsequent phases
function LoginPage() {
  return <main><h1>Login</h1></main>
}
function EventsPage() {
  return <main><h1>Events</h1></main>
}
function ScannerPage() {
  return (
    <main>
      <h1>Scanner</h1>
      <ScannerPanel />
    </main>
  )
}
function AdminPage() {
  return <main><h1>Admin</h1></main>
}
function CheckoutPage() {
  const [params] = useSearchParams()
  const eventId = params.get('event')
  return (
    <main>
      <h1>Checkout</h1>
      {eventId
        ? <CheckoutPanel eventId={eventId} />
        : <p>Append <code>?event=&lt;event_id&gt;</code> to the URL to pick an event.</p>}
    </main>
  )
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { index: true, element: <Navigate to="/events" replace /> },
      { path: '/events', element: <EventsPage /> },
      { path: '/scanner', element: <ScannerPage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '/checkout', element: <CheckoutPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
