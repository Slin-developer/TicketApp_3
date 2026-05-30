import { useCallback, useState } from 'react'
import { useQrCamera } from '@/hooks/useQrCamera'
import { useScanner } from '@/hooks/useScanner'
import type { ScanResult } from '@/types/domain'
import './QrScanner.css'

type Phase = 'idle' | 'scanning' | 'checking' | 'result'

interface Outcome {
  kind: 'ok' | 'error'
  title: string
  detail: string
}

function outcomeFor(result: ScanResult): Outcome {
  switch (result.result) {
    case 'success':
      return { kind: 'ok', title: 'Gültig', detail: `Ticket ${result.ticketId} eingecheckt.` }
    case 'already_scanned':
      return { kind: 'error', title: 'Bereits gescannt', detail: 'Dieses Ticket wurde schon entwertet.' }
    case 'not_found':
      return { kind: 'error', title: 'Nicht gefunden', detail: 'Kein gültiges Ticket zu diesem Code.' }
    case 'unauthorized':
      return { kind: 'error', title: 'Keine Berechtigung', detail: 'Du darfst dieses Ticket nicht scannen.' }
  }
}

// How long the full-screen colour flash holds before the result panel appears.
const FLASH_MS = 150

export function QrScanner() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [flash, setFlash] = useState<'green' | 'red' | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const scanner = useScanner()

  const settle = useCallback((next: Outcome) => {
    setFlash(next.kind === 'ok' ? 'green' : 'red')
    if (navigator.vibrate) navigator.vibrate(next.kind === 'ok' ? 80 : [60, 50, 60])
    window.setTimeout(() => {
      setFlash(null)
      setOutcome(next)
      setPhase('result')
    }, FLASH_MS)
  }, [])

  // onDetect auto-pauses decoding inside the hook, so this only sequences the
  // scan request and the result UI — no camera control needed here.
  const handleDetect = useCallback(
    (value: string) => {
      const token = value.trim()
      if (!token) return
      setPhase('checking')
      scanner.mutate(token, {
        onSuccess: (res) => settle(outcomeFor(res)),
        onError: () =>
          settle({ kind: 'error', title: 'Fehler', detail: 'Prüfung fehlgeschlagen. Bitte erneut versuchen.' }),
      })
    },
    [scanner, settle],
  )

  const { videoRef, status, error, start: startCamera, resume: resumeCamera } = useQrCamera({
    onDetect: handleDetect,
  })

  const start = useCallback(async () => {
    await startCamera()
    setPhase('scanning')
  }, [startCamera])

  const resume = useCallback(() => {
    setOutcome(null)
    scanner.reset()
    setPhase('scanning')
    resumeCamera()
  }, [resumeCamera, scanner])

  const showVideo = status === 'scanning' || status === 'starting'

  let statusText = 'Bereit zum Scannen'
  let statusTone: 'idle' | 'active' | 'error' = 'idle'
  if (status === 'starting') statusText = 'Kamera wird gestartet…'
  else if (phase === 'checking') statusText = 'Ticket wird geprüft…'
  else if (phase === 'scanning') {
    statusText = 'Scanne aktiv…'
    statusTone = 'active'
  } else if (phase === 'result' && outcome) {
    statusText = outcome.detail
    statusTone = outcome.kind === 'ok' ? 'active' : 'error'
  } else if (status === 'error' && error) {
    statusText = error
    statusTone = 'error'
  }

  return (
    <div className="qr-scanner stack">
      <div className="qr-viewport">
        {/* Onboarding / camera-permission prompt */}
        {phase === 'idle' && (
          <div className="qr-onboarding">
            <div className="qr-onboarding-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
            <h2 className="qr-onboarding-title">Kamera-Zugriff benötigt</h2>
            <p className="qr-onboarding-desc">
              Erlaube den Zugriff auf deine Kamera, um QR-Codes direkt zu scannen und Tickets zu entwerten.
            </p>
            {error && (
              <p className="message error" role="alert">
                {error}
              </p>
            )}
            <button type="button" className="btn btn-primary" onClick={start}>
              {error ? 'Erneut versuchen' : 'Kamera starten'}
            </button>
          </div>
        )}

        {/* Live camera feed (centre-cropped to the square viewport via CSS). */}
        <video 
          ref={videoRef} 
          className="qr-video" 
          muted 
          playsInline 
          autoPlay
          style={{ display: showVideo ? 'block' : 'none' }} 
        />

        {/* Scan HUD: corner sights + stationary laser line. */}
        {phase === 'scanning' && (
          <div className="qr-overlay" aria-hidden>
            <span className="qr-corner top-left" />
            <span className="qr-corner top-right" />
            <span className="qr-laser" />
            <span className="qr-corner bottom-left" />
            <span className="qr-corner bottom-right" />
          </div>
        )}

        {/* Result panel (valid / error). */}
        {phase === 'result' && outcome && (
          <div className={`qr-result-overlay show ${outcome.kind}`} role="status">
            <div className="qr-result-badge">
              {outcome.kind === 'ok' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </div>
            <h2 className="qr-result-title">{outcome.title}</h2>
            <p className="qr-result-detail">{outcome.detail}</p>
            <button type="button" className="btn btn-primary" onClick={resume}>
              Nächstes Ticket
            </button>
          </div>
        )}

        {/* High-speed colour flash on detect. */}
        <div className={`qr-flash${flash ? ` show flash-${flash}` : ''}`} aria-hidden />
      </div>

      <div className={`qr-status tone-${statusTone}`} aria-live="polite">
        {statusTone === 'active' && <span className="qr-status-dot" aria-hidden />}
        <span>{statusText}</span>
      </div>
    </div>
  )
}
