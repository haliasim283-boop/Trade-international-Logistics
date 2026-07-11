import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // supabase-js can occasionally hang on the very first getSession() call
    // after a cold page load (stale internal lock). Fail open after a
    // timeout so the app doesn't spin forever — the user lands on the
    // login page and can sign in instead of being stuck.
    let settled = false
    const timeoutId = setTimeout(() => {
      if (!settled) setLoading(false)
    }, 10000)

    // Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      settled = true
      clearTimeout(timeoutId)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          await fetchProfile(session.user.id)
        } else {
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => {
      settled = true
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [])

  async function fetchProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error
      setProfile(data)
    } catch (err) {
      console.error('Failed to fetch profile:', err.message)
      // Do NOT blindly clear the profile on failure. A transient error (e.g.
      // the network dropped) must not downgrade a known role to null — the
      // authorization guards fail closed on a null role, but nulling a valid
      // role would also wrongly lock a legitimate user out of their own pages.
      // Only clear when we genuinely have no established profile for this user.
      setProfile(prev => (prev && prev.id === userId ? prev : null))
    } finally {
      setLoading(false)
    }
  }

  async function signIn(email, password) {
    if (!supabase) {
      return { error: { message: 'Supabase not configured — check your .env file.' } }
    }
    // Guard against the same auth-client hang described above — without
    // this, a stuck sign-in leaves the button spinning forever.
    const timeout = new Promise(resolve =>
      setTimeout(() => resolve({
        error: { message: 'Sign in timed out. Please refresh the page and try again.' },
      }), 15000)
    )
    const attempt = supabase.auth.signInWithPassword({ email, password })
      .then(({ error }) => ({ error }))
    return Promise.race([attempt, timeout])
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  async function updateProfile(updates) {
    if (!supabase || !user) return { error: { message: 'Not authenticated' } }
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select()
      .single()
    if (!error) setProfile(data)
    return { data, error }
  }

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      role: profile?.role ?? null,
      loading,
      signIn,
      signOut,
      updateProfile,
      fetchProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
