import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { FullPageSpinner } from '../ui/Spinner'

export function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner />

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Fail CLOSED: for a role-restricted route, an authenticated user whose
  // role is unknown (null — e.g. the profile fetch failed while offline) or
  // not in the allowed list is denied. Never grant access when role is null.
  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    return <Navigate to="/unauthorized" replace />
  }

  return children
}
