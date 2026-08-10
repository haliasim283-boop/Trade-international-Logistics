import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

const PROFILE_TIMEOUT_MS = 6000
const PROFILE_RETRIES    = 2

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// The query builder is a thenable, so it races cleanly against a timer. Without
// this, a hung request would leave the role unresolved forever and the guards
// would spin instead of ever settling.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Profile lookup timed out')), ms)
    ),
  ])
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // How far along we are in establishing the role. This is the piece that was
  // missing: without it, "role not loaded yet" and "role loaded, and it's not
  // allowed" are the same null and the guards cannot tell them apart.
  //   'idle'    — no authenticated user; nothing to resolve
  //   'loading' — a fetch is in flight; the role is NOT YET KNOWN
  //   'ready'   — profile.role is authoritative
  //   'error'   — every attempt failed; the role stays unknown
  const [profileStatus, setProfileStatus] = useState('idle')
  const [profileError, setProfileError]   = useState(null)

  // Mirrors `profile` so fetchProfile can read the current value without
  // stale-closure games or impure state updaters.
  const profileRef = useRef(null)
  // Monotonic counter: a slow response from an earlier call must never
  // overwrite the result of a newer one.
  const fetchSeq = useRef(0)

  function applyProfile(next) {
    profileRef.current = next
    setProfile(next)
  }

  function clearProfile() {
    applyProfile(null)
    setProfileStatus('idle')
    setProfileError(null)
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // supabase-js can occasionally hang on the very first getSession() call
    // after a cold page load (stale internal lock). Fail open after a
    // timeout so the app doesn't spin forever — the user lands on the
    // login page and can sign in instead of being stuck. Failing open is safe
    // here only because it grants no access: with no user, the guards send
    // you to /login.
    let settled = false
    const timeoutId = setTimeout(() => {
      if (!settled) setLoading(false)
    }, 10000)

    // Check existing session on mount
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        settled = true
        clearTimeout(timeoutId)
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchProfile(session.user.id)
        } else {
          clearProfile()
          setLoading(false)
        }
      })
      .catch(err => {
        // A rejected session lookup used to go unhandled and leave `loading`
        // pinned until the timer fired.
        settled = true
        clearTimeout(timeoutId)
        console.error('Failed to restore session:', err?.message ?? err)
        setLoading(false)
      })

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          // Also fires on TOKEN_REFRESHED. That matters: the bootstrap fetch
          // may have gone out carrying an expired JWT, and re-fetching once
          // the new token lands is what lets a failed load self-heal.
          await fetchProfile(session.user.id)
        } else {
          clearProfile()
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
    if (!supabase) return null

    const seq = ++fetchSeq.current
    const isCurrent = () => seq === fetchSeq.current

    // Only advertise "loading" when there is nothing authoritative to show. A
    // background refresh must not blank out a role we already trust.
    const hadProfile = profileRef.current?.id === userId
    if (!hadProfile) setProfileStatus('loading')

    let lastError = null

    for (let attempt = 0; attempt <= PROFILE_RETRIES; attempt++) {
      try {
        const { data, error } = await withTimeout(
          supabase.from('profiles').select('*').eq('id', userId).single(),
          PROFILE_TIMEOUT_MS
        )
        if (error) throw error
        if (!isCurrent()) return null

        applyProfile(data)
        setProfileStatus('ready')
        setProfileError(null)
        setLoading(false)
        return data
      } catch (err) {
        lastError = err
        if (!isCurrent()) return null
        // Backoff gives an in-flight token refresh time to land, which is the
        // usual reason the first attempt of the day fails.
        if (attempt < PROFILE_RETRIES) await sleep(400 * 2 ** attempt)
      }
    }

    if (!isCurrent()) return null

    console.error('Failed to fetch profile:', lastError?.message ?? lastError)

    // Fail CLOSED. Keep a previously established profile for this same user —
    // a transient error must not downgrade a known role — but never invent
    // one. An unresolved role stays unresolved, and the guards deny.
    if (hadProfile) {
      setProfileStatus('ready')
    } else {
      applyProfile(null)
      setProfileStatus('error')
      setProfileError(lastError ?? new Error('Unknown error'))
    }
    setLoading(false)
    return null
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
    // Invalidate any in-flight profile fetch so its result cannot land after
    // sign-out and repopulate a role for a user who is no longer here.
    fetchSeq.current++
    setUser(null)
    clearProfile()
  }

  async function updateProfile(updates) {
    if (!supabase || !user) return { error: { message: 'Not authenticated' } }
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select()
      .single()
    if (!error) applyProfile(data)
    return { data, error }
  }

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      role: profile?.role ?? null,
      // True only when the role has been positively established. Callers must
      // never treat a false here as permission to proceed.
      roleResolved: profileStatus === 'ready',
      profileStatus,
      profileError,
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
