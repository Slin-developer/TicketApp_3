import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { authService } from '@/services/supabase/authService'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    authService
      .getSession()
      .then((s) => {
        if (cancelled) return
        setSession(s)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const sub = authService.onAuthStateChange((s) => {
      setSession(s)
    })

    return () => {
      cancelled = true
      sub.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      async signIn(email, password) {
        const s = await authService.signIn({ email, password })
        setSession(s)
      },
      async signUp(email, password) {
        const s = await authService.signUp({ email, password })
        setSession(s)
      },
      async signOut() {
        await authService.signOut()
        setSession(null)
      },
    }),
    [session, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider.')
  return ctx
}
