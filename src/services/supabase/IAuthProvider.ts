import type { Session, User } from '@supabase/supabase-js'

export interface AuthCredentials {
  email: string
  password: string
}

export interface AuthStateSubscription {
  unsubscribe: () => void
}

export interface IAuthProvider {
  signIn(credentials: AuthCredentials): Promise<Session>
  signUp(credentials: AuthCredentials): Promise<Session | null>
  signOut(): Promise<void>
  getSession(): Promise<Session | null>
  getUser(): Promise<User | null>
  onAuthStateChange(
    callback: (session: Session | null) => void,
  ): AuthStateSubscription
}
