import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'

interface Props {
  children: ReactNode
  /** Narrows the page column for focused, form-style pages (login, scanner). */
  narrow?: boolean
}

// Shared chrome for the non-checkout pages: a sticky brand bar with primary
// navigation plus a centered content column. The checkout panel deliberately
// opts out of this (it runs in its own focused `body.checkout-mode` shell).
export function AppLayout({ children, narrow = false }: Props) {
  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link to="/events" className="app-brand">
          <span className="brand-dot">◆</span>
          TicketApp
        </Link>
        <div className="app-nav-links">
          <NavLink to="/events" className="nav-link">
            Events
          </NavLink>
          <NavLink to="/scanner" className="nav-link">
            Scanner
          </NavLink>
          <NavLink to="/admin" className="nav-link">
            Admin
          </NavLink>
        </div>
      </nav>
      <main className="app-main">
        <div className={`page ${narrow ? 'page-narrow' : ''}`}>{children}</div>
      </main>
    </div>
  )
}
