import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { authService } from '@/services/supabase/authService'
import { TenantContext, type TenantContextValue } from './TenantContext'

const STORAGE_KEY = 'ticketapp.currentOrgId'

function readInitialOrgId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(readInitialOrgId)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (currentOrgId) {
      window.localStorage.setItem(STORAGE_KEY, currentOrgId)
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [currentOrgId])

  // Clear org selection on sign-out so a new user on the same device
  // doesn't inherit a previous user's organization.
  useEffect(() => {
    const sub = authService.onAuthStateChange((session) => {
      if (!session) setCurrentOrgIdState(null)
    })
    return () => sub.unsubscribe()
  }, [])

  const setCurrentOrgId = useCallback((orgId: string | null) => {
    setCurrentOrgIdState(orgId)
  }, [])

  const value = useMemo<TenantContextValue>(
    () => ({ currentOrgId, setCurrentOrgId }),
    [currentOrgId, setCurrentOrgId],
  )

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}
