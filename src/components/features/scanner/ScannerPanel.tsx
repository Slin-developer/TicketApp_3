import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useScanner } from '@/hooks/useScanner'
import type { ScanResult } from '@/types/domain'

function describe(result: ScanResult): string {
  switch (result.result) {
    case 'success':
      return `Success — ticket ${result.ticketId} marked scanned.`
    case 'already_scanned':
      return 'Already scanned.'
    case 'not_found':
      return 'Not found.'
    case 'unauthorized':
      return 'Unauthorized for this ticket.'
  }
}

export function ScannerPanel() {
  const [token, setToken] = useState('')
  const scanner = useScanner()

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) return
    scanner.mutate(trimmed)
  }

  return (
    <section>
      <h2>Scan Ticket</h2>
      <form onSubmit={onSubmit}>
        <label htmlFor="scan-token">Raw token (QR payload)</label>
        <Input
          id="scan-token"
          name="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={scanner.isPending}
        />
        <Button type="submit" disabled={scanner.isPending || !token.trim()}>
          {scanner.isPending ? 'Scanning…' : 'Scan'}
        </Button>
      </form>

      <output aria-live="polite">
        {scanner.isError && <p role="alert">Error: {scanner.error.message}</p>}
        {scanner.data && <p>{describe(scanner.data)}</p>}
      </output>
    </section>
  )
}
