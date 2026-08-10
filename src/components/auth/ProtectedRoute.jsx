import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { FullPageSpinner } from '../ui/Spinner'
import { Button } from '../ui/Button'

export function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, loading, profileStatus } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner />

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (allowedRoles) {
    // The role is still being established (first load of the day, or a token
    // refresh in flight). "Unknown" is NOT "forbidden" — wait rather than
    // deny, so a slow profile fetch can't strand a legitimate user on
    // /unauthorized with no way back. This grants nothing: it renders a
    // spinner, never `children`.
    if (profileStatus !== 'ready' && profileStatus !== 'error') {
      return <FullPageSpinner />
    }

    // Resolution finished and produced no role — missing profiles row, an RLS
    // policy blocking the read, or a dead connection. That is an account or
    // connectivity fault, not a permissions one, so say so plainly instead of
    // showing a misleading "Access Denied" that sends you hunting the wrong
    // problem. Still grants nothing.
    if (profileStatus === 'error') {
      return <ProfileUnavailable />
    }

    // Fail CLOSED: a resolved role that isn't in the allowed list is denied,
    // and so is any null role that somehow reached this point.
    if (!role || !allowedRoles.includes(role)) {
      return <Navigate to="/unauthorized" state={{ from: location }} replace />
    }
  }

  return children
}

function ProfileUnavailable() {
  const { user, fetchProfile, signOut } = useAuth()
  const [retrying, setRetrying] = useState(false)

  async function retry() {
    setRetrying(true)
    await fetchProfile(user.id)
    setRetrying(false)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-sm">
        <ShieldAlert className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <h2 className="text-xl font-semibold text-gray-600 mb-2">
          Couldn’t load your permissions
        </h2>
        <p className="text-sm text-gray-400 mb-6">
          You’re signed in, but we couldn’t read your account profile, so we
          can’t tell what you’re allowed to see. This is usually a connection
          problem. If it keeps happening, ask an administrator to check that
          your account has a profile.
        </p>
        <div className="flex gap-2 justify-center">
          <Button onClick={retry} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Try again'}
          </Button>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}
