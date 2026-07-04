import { NavLink } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plane, X } from 'lucide-react'
import { NAV_ITEMS, ROUTE_ACCESS } from '../../config/nav'
import { useAuth } from '../../contexts/AuthContext'

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }) {
  const { role } = useAuth()

  // Filter nav items to those the current role can access
  const visibleItems = NAV_ITEMS.filter(item => {
    const allowed = ROUTE_ACCESS[item.path]
    return !role || !allowed || allowed.includes(role)
  })

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={[
          'fixed left-0 top-0 bottom-0 z-40 flex flex-col bg-navy text-white',
          'transition-transform duration-200 ease-in-out w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
          collapsed ? 'md:w-16' : 'md:w-64',
        ].join(' ')}
      >
        {/* Logo / brand */}
        <div className={[
          'flex items-center gap-3 px-4 py-4 border-b border-white/10 min-h-[64px]',
          collapsed ? 'md:justify-center' : '',
        ].join(' ')}>
          <div className="flex-shrink-0 w-8 h-8 bg-accent rounded flex items-center justify-center">
            <Plane className="w-4 h-4 text-white" />
          </div>
          <div className={collapsed ? 'overflow-hidden md:hidden' : 'overflow-hidden'}>
            <p className="text-xs font-bold uppercase tracking-wider leading-tight text-white">
              Trade Intl
            </p>
            <p className="text-[10px] text-blue-300 leading-tight">Logistics</p>
          </div>
          {/* Mobile close button */}
          <button
            onClick={onMobileClose}
            className="ml-auto md:hidden text-blue-200 hover:text-white p-1"
            title="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-3 scrollbar-thin">
          {visibleItems.map(({ icon: Icon, label, path }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              title={collapsed ? label : undefined}
              onClick={onMobileClose}
              className={({ isActive }) => [
                'flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm font-medium',
                'transition-colors duration-100 group relative',
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-blue-200 hover:bg-white/10 hover:text-white',
              ].join(' ')}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span className={collapsed ? 'truncate md:hidden' : 'truncate'}>{label}</span>
              {/* Tooltip when collapsed (desktop only) */}
              {collapsed && (
                <span className={[
                  'hidden md:block absolute left-full ml-3 px-2 py-1 rounded bg-gray-900 text-white text-xs',
                  'whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none',
                  'transition-opacity duration-150 z-50',
                ].join(' ')}>
                  {label}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={onToggle}
          className="hidden md:flex items-center justify-center h-12 border-t border-white/10 text-blue-300 hover:text-white hover:bg-white/10 transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>
    </>
  )
}
