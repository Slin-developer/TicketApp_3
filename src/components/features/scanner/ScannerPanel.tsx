import { useState } from 'react'
import type { FormEvent } from 'react'
import { useScanner } from '@/hooks/useScanner'
import { QrScanner } from './QrScanner'
import type { ScanResult } from '@/types/domain'
import './ScannerPanel.css'

interface Described {
  tone: 'ok' | 'warn'
  text: string
}

function describe(result: ScanResult): Described {
  switch (result.result) {
    case 'success':
      return { tone: 'ok', text: `Gültig — Ticket ${result.ticketId} eingecheckt.` }
    case 'already_scanned':
      return { tone: 'warn', text: 'Bereits gescannt.' }
    case 'not_found':
      return { tone: 'warn', text: 'Ticket nicht gefunden.' }
    case 'unauthorized':
      return { tone: 'warn', text: 'Keine Berechtigung für dieses Ticket.' }
  }
}

// Manual token entry — a fallback for when the camera is unavailable or a code
// won't read. Goes through the same scan hook → RPC path as the camera scanner.
function ManualEntry() {
  const [token, setToken] = useState('')
  const scanner = useScanner()

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) return
    scanner.mutate(trimmed)
  }

  const result = scanner.data ? describe(scanner.data) : null

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="scan-token">Roher Token (QR-Inhalt)</label>
        <input
          id="scan-token"
          name="token"
          className="text-input"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="QR-Payload einfügen…"
          disabled={scanner.isPending}
        />
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={scanner.isPending || !token.trim()}
      >
        {scanner.isPending ? 'Wird gescannt…' : 'Ticket scannen'}
      </button>

      <div aria-live="polite">
        {scanner.isError && (
          <p className="message error" role="alert">
            Fehler: {scanner.error.message}
          </p>
        )}
        {result && (
          <div className={`scan-result ${result.tone}`}>
            <span className="result-icon">
              {result.tone === 'ok' ? (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                  <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              )}
            </span>
            {result.text}
          </div>
        )}
      </div>
    </form>
  )
}

export function ScannerPanel() {
  const [manualOpen, setManualOpen] = useState(false)

  return (
    <div className="card stack">
      <QrScanner />

      <button
        type="button"
        className="btn btn-secondary btn-block manual-toggle"
        aria-expanded={manualOpen}
        onClick={() => setManualOpen((o) => !o)}
      >
        {manualOpen ? 'Manuelle Eingabe ausblenden' : 'Token manuell eingeben'}
      </button>

      {manualOpen && <ManualEntry />}
    </div>
  )
}
