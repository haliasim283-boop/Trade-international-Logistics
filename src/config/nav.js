import {
  LayoutDashboard,
  Plane,
  Users,
  FileText,
  BookOpen,
  BarChart2,
  FileCheck,
  Truck,
  UserCheck,
  TrendingDown,
  TrendingUp,
  PieChart,
  Settings,
  UserCog,
} from 'lucide-react'

export const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard',              path: '/',          phase: null },
  { icon: Plane,           label: 'Master Shipment Log',    path: '/shipments', phase: 4 },
  { icon: Users,           label: 'Party Management',       path: '/parties',   phase: 3 },
  { icon: FileText,        label: 'Invoices',               path: '/invoices',  phase: 6 },
  { icon: BookOpen,        label: 'Party Ledgers',          path: '/ledgers',   phase: 5 },
  { icon: BarChart2,       label: 'Airline Sales (CASS)',   path: '/cass',      phase: 7 },
  { icon: FileCheck,       label: 'Form E Reports',         path: '/form-e',    phase: 7 },
  { icon: Truck,           label: 'Clearing Agent Reports', path: '/clearing',     phase: 7 },
  { icon: UserCheck,       label: 'Sales Agent Reports',    path: '/sales-agents', phase: 7 },
  { icon: TrendingDown,    label: 'Expenses',               path: '/expenses',     phase: 8 },
  { icon: TrendingUp,      label: 'Income',                 path: '/income',    phase: 8 },
  { icon: PieChart,        label: 'Profit & Loss',          path: '/pnl',       phase: 8 },
  { icon: Settings,        label: 'Settings',               path: '/settings',  phase: 10 },
  { icon: UserCog,         label: 'User Management',        path: '/users',     phase: 2 },
]

// Roles that can access each route (empty = all authenticated)
export const ROUTE_ACCESS = {
  '/':          ['Admin','Manager','Data Entry','Report Viewer','Invoice Agent'],
  '/shipments': ['Admin','Manager','Data Entry','Report Viewer','Invoice Agent'],
  '/parties':   ['Admin','Manager','Data Entry','Report Viewer','Invoice Agent'],
  '/invoices':  ['Admin','Manager','Data Entry','Report Viewer','Invoice Agent'],
  '/ledgers':   ['Admin','Manager','Data Entry','Report Viewer','Invoice Agent'],
  '/cass':      ['Admin','Manager','Report Viewer'],
  '/form-e':    ['Admin','Manager','Report Viewer'],
  '/clearing':     ['Admin','Manager','Report Viewer'],
  '/sales-agents': ['Admin','Manager','Report Viewer'],
  '/expenses':     ['Admin','Manager','Report Viewer'],
  '/income':    ['Admin','Manager','Report Viewer'],
  '/pnl':       ['Admin','Manager','Report Viewer'],
  '/settings':  ['Admin','Manager'],
  '/users':     ['Admin'],
}

export const ROLE_COLORS = {
  'Admin':         'bg-purple-100 text-purple-800',
  'Manager':       'bg-blue-100 text-blue-800',
  'Data Entry':    'bg-green-100 text-green-800',
  'Report Viewer': 'bg-gray-100 text-gray-700',
  'Invoice Agent': 'bg-amber-100 text-amber-800',
}
