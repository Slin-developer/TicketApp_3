import { useEffect, useMemo, useRef, useState } from 'react'
import './CheckoutPanel.css'

type TierStatus = 'available' | 'unavailable' | 'locked'

interface TierData {
  id: string
  title: string
  price: number
  badge: string
  status: TierStatus
  max: number
  isSecret?: boolean
}

interface PromoMessage {
  type: 'error' | 'success'
  text: string
}

const PROMO_CODES = new Set(['FRIENDS2026', 'SECRET', 'FRIENDS'])

const TIERS: TierData[] = [
  {
    id: 'early-bird',
    title: 'Early Bird',
    price: 25,
    badge: 'Ausverkauf droht',
    status: 'available',
    max: 10,
  },
  {
    id: 'phase-1',
    title: 'Standard',
    price: 40,
    badge: 'Beliebt',
    status: 'available',
    max: 10,
  },
  {
    id: 'phase-2',
    title: 'Late Booking',
    price: 60,
    badge: 'Demnächst',
    status: 'unavailable',
    max: 10,
  },
  {
    id: 'friends-list',
    title: 'Friends List',
    price: 15,
    badge: 'Exklusiv freigeschaltet',
    status: 'locked',
    max: 4,
    isSecret: true,
  },
]

const currencyFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})

const createInitialQuantities = () =>
  TIERS.reduce<Record<string, number>>((acc, tier) => {
    acc[tier.id] = 0
    return acc
  }, {})

interface Props {
  eventId: string
}

export function CheckoutPanel({ eventId }: Props) {
  const [loading, setLoading] = useState(true)
  const [showPromo, setShowPromo] = useState(false)
  const [promoValue, setPromoValue] = useState('')
  const [promoMessage, setPromoMessage] = useState<PromoMessage | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number>>(createInitialQuantities)
  const [loadedIndices, setLoadedIndices] = useState<Set<number>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const promoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.body.classList.add('checkout-mode')
    return () => document.body.classList.remove('checkout-mode')
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 1100)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!showPromo) return
    const timer = window.setTimeout(() => promoInputRef.current?.focus(), 200)
    return () => window.clearTimeout(timer)
  }, [showPromo])

  const tiers = useMemo(() => {
    return TIERS.filter((tier) => !tier.isSecret || unlocked).map((tier) => {
      if (tier.id === 'friends-list' && unlocked) {
        return { ...tier, status: 'available' as TierStatus }
      }
      return tier
    })
  }, [unlocked])

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
  const activeStep = modalOpen ? 3 : totalQuantity > 0 ? 2 : 1

  const summaryItems = tiers.filter((tier) => (quantities[tier.id] ?? 0) > 0)

  const checkoutLabel =
    totalQuantity > 0 ? `Jetzt sicher bezahlen (${totalQuantity})` : 'Jetzt sicher bezahlen'

  function adjustQuantity(id: string, delta: number) {
    const tier = tiers.find((item) => item.id === id)
    if (!tier || tier.status !== 'available') return
    setQuantities((prev) => {
      const current = prev[id] ?? 0
      const nextValue = Math.min(tier.max, Math.max(0, current + delta))
      return { ...prev, [id]: nextValue }
    })
  }

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

  function openModal() {
    if (totalQuantity === 0) return
    setModalOpen(true)
  }

  function resetAll() {
    setModalOpen(false)
    setQuantities(createInitialQuantities())
    setPromoValue('')
    setPromoMessage(null)
    setUnlocked(false)
    setShowPromo(false)
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
            {tiers.map((tier, index) => {
              const quantity = quantities[tier.id] ?? 0
              const isDisabled = tier.status !== 'available'
              const isUnlocked = tier.id === 'friends-list' && unlocked
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

          <button type="button" className="checkout-btn" disabled={totalQuantity === 0} onClick={openModal}>
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
