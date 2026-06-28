import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { ROUTE_ACCESS } from './config/nav'
import { useAuth } from './contexts/AuthContext'

import Login          from './pages/Login'
import Unauthorized   from './pages/Unauthorized'
import Dashboard      from './pages/Dashboard'
import Shipments      from './pages/Shipments'
import PartyManagement from './pages/PartyManagement'
import Invoices       from './pages/Invoices'
import Ledgers        from './pages/Ledgers'
import CassReports    from './pages/CassReports'
import FormEReports   from './pages/FormEReports'
import ClearingAgents    from './pages/ClearingAgents'
import SalesAgentReports from './pages/SalesAgentReports'
import Expenses          from './pages/Expenses'
import Income         from './pages/Income'
import ProfitLoss     from './pages/ProfitLoss'
import Settings       from './pages/Settings'
import UserManagement from './pages/UserManagement'

function Shell({ children, path }) {
  return (
    <ProtectedRoute allowedRoles={ROUTE_ACCESS[path]}>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  )
}

function CatchAll() {
  const { role } = useAuth()
  return <Navigate to={role === 'Data Entry' ? '/shipments' : '/'} replace />
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"        element={<Login />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      {/* Protected — wrapped in AppShell + role guard */}
      <Route path="/"           element={<Shell path="/"><Dashboard /></Shell>} />
      <Route path="/shipments"  element={<Shell path="/shipments"><Shipments /></Shell>} />
      <Route path="/parties"    element={<Shell path="/parties"><PartyManagement /></Shell>} />
      <Route path="/invoices"   element={<Shell path="/invoices"><Invoices /></Shell>} />
      <Route path="/ledgers"    element={<Shell path="/ledgers"><Ledgers /></Shell>} />
      <Route path="/cass"       element={<Shell path="/cass"><CassReports /></Shell>} />
      <Route path="/form-e"     element={<Shell path="/form-e"><FormEReports /></Shell>} />
      <Route path="/clearing"     element={<Shell path="/clearing"><ClearingAgents /></Shell>} />
      <Route path="/sales-agents" element={<Shell path="/sales-agents"><SalesAgentReports /></Shell>} />
      <Route path="/expenses"     element={<Shell path="/expenses"><Expenses /></Shell>} />
      <Route path="/income"     element={<Shell path="/income"><Income /></Shell>} />
      <Route path="/pnl"        element={<Shell path="/pnl"><ProfitLoss /></Shell>} />
      <Route path="/settings"   element={<Shell path="/settings"><Settings /></Shell>} />
      <Route path="/users"      element={<Shell path="/users"><UserManagement /></Shell>} />

      {/* Catch-all */}
      <Route path="*" element={<CatchAll />} />
    </Routes>
  )
}
