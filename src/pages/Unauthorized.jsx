import { useEffect } from 'react'
import { ShieldOff } from 'lucide-react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { FullPageSpinner } from '../components/ui/Spinner'
import { useAuth } from '../contexts/AuthContext'
import { ROUTE_ACCESS } from '../config/nav'

export default function Unauthorized() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, role, loading, profileStatus } = useAuth()

  // Set by ProtectedRoute when it bounced us here. Router state only — never a
  // query string — so this can't be used as an open redirect.
  const from = location.state?.from?.pathname ?? null

  // Recovery. This route sits outside ProtectedRoute, so nothing here ever
  // re-evaluated: land here once with an unresolved role and you stayed,
  // even after the real role arrived a second later. Now, once the role is
  // authoritative, we send you back to the page that bounced you.
  //
  // The ROUTE_ACCESS check is what keeps this safe and loop-free: we only
  // return to routes the resolved role genuinely allows, an unknown path
  // matches nothing and is ignored, and ProtectedRoute re-checks on arrival
  // regardless. This can't grant access the guard wouldn't.
  useEffect(() => {
    if (profileStatus !== 'ready' || !role || !from) return
    const allowed = ROUTE_ACCESS[from]
    if (allowed?.includes(role)) navigate(from, { replace: true })
  }, [profileStatus, role, from, navigate])

  // This route is public, so it can be reached with no session at all — don't
  // sit on a spinner waiting for a role that will never resolve.
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />

  // Don't render a verdict — or a landing button aimed at the wrong page —
  // while the role is still in flight.
  if (profileStatus !== 'ready' && profileStatus !== 'error') {
    return <FullPageSpinner />
  }

  const unresolved = profileStatus === 'error'
  const home  = role === 'Data Entry' ? '/shipments' : '/'
  const label = role === 'Data Entry' ? 'Go to Master Shipment Log' : 'Go to Dashboard'

  return (
    <div className="flex items-center justify-center min-h-[28rem]">
      <div className="text-center">
        <ShieldOff className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <h2 className="text-xl font-semibold text-gray-600 mb-2">Access Denied</h2>
        <p className="text-sm text-gray-400 mb-6">
          {unresolved
            ? 'We couldn’t confirm your role, so access was denied. Try reloading the page.'
            : `Your role${role ? ` (${role})` : ''} does not have permission to view this page.`}
        </p>
        <Button variant="secondary" onClick={() => navigate(home)}>
          {label}
        </Button>
      </div>
    </div>
  )
}
