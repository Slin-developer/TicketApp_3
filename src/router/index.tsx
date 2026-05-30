import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { ScannerPanel } from '@/components/features/scanner/ScannerPanel'
import { CheckoutPanel } from '@/components/features/checkout/CheckoutPanel'
import { EventsPage } from '@/components/features/events/EventsPage'
import { MyTicketsPage } from '@/components/features/tickets/MyTicketsPage'
import { LoginPage } from '@/components/features/auth/LoginPage'

function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  return <Outlet />
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
