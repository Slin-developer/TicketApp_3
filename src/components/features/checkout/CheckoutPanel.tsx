import { useEffect, useMemo, useRef, useState } from 'react'
import { useTiersByEvent } from '@/hooks/useEvents'
import { useCreateCheckout, useReserveTickets } from '@/hooks/useCheckout'
import type { ReserveResult, TicketTier } from '@/types/domain'
import './CheckoutPanel.css'

type TierStatus = 'available' | 'unavailable'

interface DisplayTier {
  id: string
  title: string
  price: number
  badge: string
  status: TierStatus
  max: number
  isMock?: boolean
}

interface PromoMessage {
  type: 'error' | 'success'
  text: string
}

const PROMO_CODES = new Set(['FRIENDS2026', 'SECRET', 'FRIENDS'])

// Per-order cap kept from the original mockup; real availability still wins.
const MAX_PER_ORDER = 10

// Front-end-only mockup. There is no backend for this tier yet, so it is always
// shown (regardless of any promo code) and, when selected, keeps the original
// fake-confirmation modal instead of touching reserve_tickets / Stripe.
const MOCK_FRIENDS_TIER: DisplayTier = {
  id: 'friends-list-mock',
  title: 'Friends List',
  price: 15,
  badge: 'Exklusiv',
  status: 'available',
  max: 4,
  isMock: true,
}

const currencyFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})

// Map a DB ticket_tiers row onto the card shape the UI renders. Availability is
// derived live from capacity - reserved - sold.
function mapTier(tier: TicketTier): DisplayTier {
  const available = Math.max(0, tier.capacity - tier.reserved_count - tier.sold_count)
  return {
    id: tier.id,
    title: tier.name,
    price: tier.price_cents / 100,
    badge: available > 0 ? `Noch ${available} verfügbar` : 'Ausverkauft',
    status: available > 0 ? 'available' : 'unavailable',
    max: Math.min(available, MAX_PER_ORDER),
  }
}

function reserveErrorMessage(result: ReserveResult): string {
  switch (result.result) {
    case 'sold_out':
      return result.available > 0
        ? `Nur noch ${result.available} Tickets verfügbar.`
        : 'Dieses Ticket ist leider ausverkauft.'
    case 'tier_not_found':
      return 'Dieses Ticket ist nicht mehr verfügbar.'
    case 'invalid_quantity':
      return 'Bitte wähle eine gültige Anzahl.'
    case 'invalid_email':
      return 'Bitte gib eine gültige E-Mail-Adresse ein.'
    default:
      return 'Reservierung fehlgeschlagen. Bitte versuche es erneut.'
  }
}

interface Props {
  eventId: string
}

export function CheckoutPanel({ eventId }: Props) {
  // The router defaults eventId to 'public' when no ?event param is present;
  // that is not a real tier owner, so don't fire a query for it.
  const realEventId = eventId && eventId !== 'public' ? eventId : null
  const tiersQuery = useTiersByEvent(realEventId)
  const reserveTickets = useReserveTickets()
  const createCheckout = useCreateCheckout()

  const [showPromo, setShowPromo] = useState(false)
  const [promoValue, setPromoValue] = useState('')
  const [promoMessage, setPromoMessage] = useState<PromoMessage | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [loadedIndices, setLoadedIndices] = useState<Set<number>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const promoInputRef = useRef<HTMLInputElement>(null)

  const loading = tiersQuery.isLoading
  const checkoutPending = reserveTickets.isPending || createCheckout.isPending

  useEffect(() => {
    document.body.classList.add('checkout-mode')
    return () => document.body.classList.remove('checkout-mode')
  }, [])

  useEffect(() => {
    if (!showPromo) return
    const timer = window.setTimeout(() => promoInputRef.current?.focus(), 200)
    return () => window.clearTimeout(timer)
  }, [showPromo])

  // Real DB tiers first, then the Friends List mockup (only if a code is applied).
  const tiers = useMemo<DisplayTier[]>(() => {
    const dbTiers = (tiersQuery.data ?? []).map(mapTier)
    return unlocked ? [...dbTiers, MOCK_FRIENDS_TIER] : dbTiers
  }, [tiersQuery.data, unlocked])

  useEffect(() => {
    if (loading) return
    const timers = tiers.map((_, index) =>
      window.setTimeout(() => {
        setLoadedIndices((prev) => {
          const next = index === 0 ? new Set<number>() : new Set(prev)
          next.add(index)
          return next
        })
      }, index * 40),
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [loading, tiers])

  const totalQuantity = tiers.reduce((sum, tier) => sum + (quantities[tier.id] ?? 0), 0)
  const totalAmount = tiers.reduce(
    (sum, tier) => sum + (quantities[tier.id] ?? 0) * tier.price,
    0,
  )
  // Single-tier checkout: at most one tier ever has a quantity.
  const activeTier = tiers.find((tier) => (quantities[tier.id] ?? 0) > 0) ?? null
  const activeStep = modalOpen ? 3 : totalQuantity > 0 ? 2 : 1

  const summaryItems = tiers.filter((tier) => (quantities[tier.id] ?? 0) > 0)

  const checkoutLabel = checkoutPending
    ? 'Wird verarbeitet…'
    : totalQuantity > 0
      ? `Jetzt sicher bezahlen (${totalQuantity})`
      : 'Jetzt sicher bezahlen'

  // The backend reserves one tier per order, so selecting a different tier
  // clears any previous selection (only one tier can be active at a time).
  function adjustQuantity(id: string, delta: number) {
    const tier = tiers.find((item) => item.id === id)
    if (!tier || tier.status !== 'available') return
    setFormError(null)
    setQuantities((prev) => {
      const current = prev[id] ?? 0
      const nextValue = Math.min(tier.max, Math.max(0, current + delta))
      return { [id]: nextValue }
    })
  }

  // Cosmetic only: the promo input no longer gates anything (the Friends List
  // tier is always visible). A valid code just lights up the mock card.
  function applyPromo() {
    const code = promoValue.trim().toUpperCase()
    if (!code) {
      setPromoMessage({ type: 'error', text: 'Bitte Code eingeben.' })
      return
    }
    if (PROMO_CODES.has(code)) {
      setUnlocked(true)
      setPromoMessage({ type: 'success', text: 'Code akzeptiert. VIP-Tier freigeschaltet.' })
      return
    }
    setPromoMessage({ type: 'error', text: 'Code ungültig. Bitte prüfen.' })
  }

  async function handleCheckout() {
    if (!activeTier) return
    const quantity = quantities[activeTier.id] ?? 0
    if (quantity <= 0) return

    // Mockup tier: keep the original fake confirmation, no backend call.
    if (activeTier.isMock) {
      setModalOpen(true)
      return
    }

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setFormError('Bitte gib eine gültige E-Mail-Adresse ein.')
      return
    }
    setFormError(null)

    try {
      const reservation = await reserveTickets.mutateAsync({
        tierId: activeTier.id,
        quantity,
        email: trimmedEmail,
      })
      if (reservation.result !== 'success') {
        setFormError(reserveErrorMessage(reservation))
        return
      }
      const session = await createCheckout.mutateAsync({ orderId: reservation.orderId })
      // Hand off to Stripe's hosted checkout page.
      window.location.href = session.url
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Checkout fehlgeschlagen. Bitte versuche es erneut.',
      )
    }
  }

  function resetAll() {
    setModalOpen(false)
    setQuantities({})
    setPromoValue('')
    setPromoMessage(null)
    setUnlocked(false)
    setShowPromo(false)
    setEmail('')
    setFormError(null)
  }

  return (
    <main className="checkout-shell">
      <section className="container" data-event={eventId}>
        <div className="steps" aria-hidden>
          {[1, 2, 3].map((step) => (
            <span key={step} className={`step-bar ${activeStep >= step ? 'active' : ''}`} />
          ))}
        </div>

        <header>
          <div>
            <h1>Tickets sichern</h1>
            <p className="subtitle">Sicher, sofort, digital.</p>
          </div>
          <button
            type="button"
            className={`code-toggle-btn ${showPromo ? 'open' : ''}`}
            onClick={() => setShowPromo((prev) => !prev)}
          >
            Code
            <svg className="chevron" viewBox="0 0 24 24" aria-hidden>
              <polyline
                points="8 5 16 12 8 19"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </header>

        <div className={`promo-section ${showPromo ? 'show' : ''}`}>
          <div className="promo-header">
            <label htmlFor="promo-code">Gutscheincode</label>
            <span>Nur für ausgewählte Gäste</span>
          </div>
          <div className="promo-input-row">
            <input
              id="promo-code"
              ref={promoInputRef}
              className="promo-input"
              type="text"
              value={promoValue}
              onChange={(event) => setPromoValue(event.target.value)}
              placeholder="FRIENDS2026"
              autoComplete="off"
            />
            <button type="button" className="promo-apply" onClick={applyPromo}>
              Einlösen
            </button>
          </div>
          {promoMessage && <p className={`message ${promoMessage.type}`}>{promoMessage.text}</p>}
        </div>

        {loading ? (
          <div className="skeleton-container" aria-live="polite">
            {[1, 2, 3].map((item) => (
              <div key={item} className="skeleton-card">
                <div className="skeleton-line medium" />
                <div className="skeleton-line short" />
                <div className="skeleton-footer">
                  <div className="skeleton-line short" />
                  <div className="skeleton-line short" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="ticket-list">
            {tiersQuery.isError && (
              <p className="message error">
                Tickets konnten nicht geladen werden. Bitte lade die Seite neu.
              </p>
            )}
            {tiers.map((tier, index) => {
              const quantity = quantities[tier.id] ?? 0
              const isDisabled = tier.status !== 'available'
              const isUnlocked = Boolean(tier.isMock) && unlocked
              return (
                <article
                  key={tier.id}
                  className={[
                    'ticket-card',
                    loadedIndices.has(index) ? 'loaded' : '',
                    isUnlocked ? 'unlocked' : '',
                    isDisabled ? 'disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="ticket-header">
                    <div>
                      <h3 className="ticket-title">{tier.title}</h3>
                      <p className="ticket-meta">Max. {tier.max} Tickets pro Bestellung</p>
                    </div>
                    <span className="badge">{tier.badge}</span>
                  </div>

                  <div className="ticket-controls">
                    <span className="ticket-price">{currencyFormatter.format(tier.price)}</span>
                    <div className={`qty-controls ${quantity > 0 ? 'active' : ''}`}>
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => adjustQuantity(tier.id, -1)}
                        aria-label={`${tier.title} reduzieren`}
                        disabled={isDisabled || quantity === 0}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden>
                          <line
                            x1="6"
                            y1="12"
                            x2="18"
                            y2="12"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                      <span className="qty-value">{quantity}</span>
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => adjustQuantity(tier.id, 1)}
                        aria-label={`${tier.title} erhöhen`}
                        disabled={isDisabled || quantity >= tier.max}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden>
                          <line
                            x1="12"
                            y1="6"
                            x2="12"
                            y2="18"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                          <line
                            x1="6"
                            y1="12"
                            x2="18"
                            y2="12"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <span className="ticket-limit">
                    {isDisabled ? 'Derzeit nicht verfügbar' : 'Sofort verfügbar'}
                  </span>
                </article>
              )
            })}
          </div>
        )}

        <div className="checkout-section">
          {summaryItems.length === 0 && (
            <div className="summary-row">
              <span>Auswahl</span>
              <span>0,00 €</span>
            </div>
          )}
          {summaryItems.map((tier) => {
            const quantity = quantities[tier.id] ?? 0
            return (
              <div key={tier.id} className="summary-row">
                <span>
                  {tier.title} (x{quantity})
                </span>
                <span>{currencyFormatter.format(quantity * tier.price)}</span>
              </div>
            )
          })}
          <div className="summary-row">
            <span>Zwischensumme</span>
            <span>{currencyFormatter.format(totalAmount)}</span>
          </div>
          <div className="summary-row total">
            <span>Gesamt</span>
            <span>{currencyFormatter.format(totalAmount)}</span>
          </div>

          {/* Email is the buyer's identity for guest checkout — required by
              reserve_tickets. Hidden for the mock tier, which never reserves. */}
          {activeTier && !activeTier.isMock && (
            <div className="email-field">
              <label htmlFor="buyer-email">E-Mail für deine Tickets</label>
              <input
                id="buyer-email"
                className="promo-input"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setFormError(null)
                }}
                placeholder="du@beispiel.de"
                autoComplete="email"
              />
            </div>
          )}

          {formError && <p className="message error">{formError}</p>}

          <button
            type="button"
            className="checkout-btn"
            disabled={totalQuantity === 0 || checkoutPending}
            onClick={handleCheckout}
          >
            {checkoutLabel}
          </button>
          <div className="trust-footer">SSL-verschlüsselt · PCI-DSS geprüft</div>
        </div>
      </section>

      {modalOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <h2>Bestellung bestätigt</h2>
            <p>Deine Tickets werden gerade erstellt. Eine Bestätigung ist unterwegs.</p>
            <div className="modal-list">
              {summaryItems.map((tier) => {
                const quantity = quantities[tier.id] ?? 0
                return (
                  <div key={tier.id} className="modal-row">
                    <span>
                      {tier.title} (x{quantity})
                    </span>
                    <span>{currencyFormatter.format(quantity * tier.price)}</span>
                  </div>
                )
              })}
              <div className="modal-row">
                <strong>Gesamt</strong>
                <strong>{currencyFormatter.format(totalAmount)}</strong>
              </div>
            </div>
            <button type="button" className="modal-close" onClick={resetAll}>
              Fenster schließen
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
