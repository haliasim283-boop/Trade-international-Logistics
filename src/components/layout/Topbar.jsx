import { useLocation } from 'react-router-dom'
import { LogOut, ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { NAV_ITEMS, ROLE_COLORS } from '../../config/nav'

export function Topbar() {
  const { profile, role, signOut } = useAuth()
  const location = useLocation()

  const currentItem = NAV_ITEMS.find(item =>
    item.path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(item.path)
  )

  const roleColor = ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-700'

  return (
    <header className="sticky top-0 z-20 h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shadow-sm">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-400">Trade Intl</span>
        <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
        <span className="font-semibold text-navy">
          {currentItem?.label ?? 'Dashboard'}
        </span>
      </div>

      {/* Right: role + user + logout */}
      <div className="flex items-center gap-3">
        {role && (
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${roleColor}`}>
            {role}
          </span>
        )}
        {profile && (
          <span className="text-sm text-gray-600 hidden sm:block">
            {profile.full_name}
          </span>
        )}
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-danger transition-colors px-2 py-1 rounded hover:bg-red-50"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:block">Sign out</span>
        </button>
      </div>
    </header>
  )
}
