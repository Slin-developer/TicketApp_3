import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/scanner'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email, password)
      navigate(next, { replace: true })
    } catch {
      setError('Ungültige Zugangsdaten. Bitte versuche es erneut.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppLayout narrow>
      <div className="page-header">
        <h1>Staff-Login</h1>
        <p className="subtitle">Nur für Mitarbeitende mit Scanner-Zugang.</p>
      </div>

      <form className="card stack" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input
            id="email"
            className="text-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="staff@beispiel.de"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            className="text-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Anmeldung…' : 'Anmelden'}
        </button>
      </form>
    </AppLayout>
  )
}
