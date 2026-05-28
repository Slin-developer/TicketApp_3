import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

interface TenantContextValue {
  currentOrgId: string | null
  setCurrentOrgId: (orgId: string | null) => void
}

const STORAGE_KEY = 'ticketapp.currentOrgId'

const TenantContext = createContext<TenantContextValue | undefined>(undefined)

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

  const setCurrentOrgId = useCallback((orgId: string | null) => {
    setCurrentOrgIdState(orgId)
  }, [])

  const value = useMemo<TenantContextValue>(
    () => ({ currentOrgId, setCurrentOrgId }),
    [currentOrgId, setCurrentOrgId],
  )

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within a TenantProvider.')
  return ctx
}
