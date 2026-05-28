import { supabase } from '@/lib/supabaseClient'
import type {
  AuthCredentials,
  AuthStateSubscription,
  IAuthProvider,
} from './IAuthProvider'

export const authService: IAuthProvider = {
  async signIn({ email, password }: AuthCredentials) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    if (!data.session) throw new Error('Sign-in returned no session.')
    return data.session
  },

  async signUp({ email, password }: AuthCredentials) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return data.session
  },

  async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  async getSession() {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    return data.session
  },

  async getUser() {
    const { data, error } = await supabase.auth.getUser()
    if (error) throw error
    return data.user
  },

  onAuthStateChange(callback): AuthStateSubscription {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session)
    })
    return { unsubscribe: () => data.subscription.unsubscribe() }
  },
}
