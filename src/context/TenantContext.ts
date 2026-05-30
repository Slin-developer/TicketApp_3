import { createContext, useContext } from 'react'

export interface TenantContextValue {
  currentOrgId: string | null
  setCurrentOrgId: (orgId: string | null) => void
}

export const TenantContext = createContext<TenantContextValue | undefined>(undefined)

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within a TenantProvider.')
  return ctx
}
