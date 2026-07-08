import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, CreditCard, AlertCircle, ChevronRight, TrendingUp, TrendingDown, Package } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function r2(n) { return Math.round(Number(n || 0) * 100) / 100 }
function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

function currentFortnight() {
  const now = new Date()
  const y = now.getFullYear(), mn = now.getMonth(), day = now.getDate()
  const ms = String(mn + 1).padStart(2, '0')
  if (day <= 15) {
    return { from: `${y}-${ms}-01`, to: `${y}-${ms}-15` }
  }
  const last = new Date(y, mn + 1, 0).getDate()
  return { from: `${y}-${ms}-16`, to: `${y}-${ms}-${String(last).padStart(2, '0')}` }
}

function currentMonth() {
  const now = new Date()
  const y = now.getFullYear(), ms = String(now.getMonth() + 1).padStart(2, '0')
  return { from: `${y}-${ms}-01`, to: now.toISOString().slice(0, 10) }
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, color, onClick }) {
  const styles = {
    red:    { wrap: 'border-red-200    bg-red-50',    val: 'text-red-700',    lbl: 'text-red-800' },
    amber:  { wrap: 'border-amber-200  bg-amber-50',  val: 'text-amber-700',  lbl: 'text-amber-800' },
    blue:   { wrap: 'border-blue-200   bg-blue-50',   val: 'text-blue-700',   lbl: 'text-blue-800' },
    purple: { wrap: 'border-purple-200 bg-purple-50', val: 'text-purple-700', lbl: 'text-purple-800' },
    green:  { wrap: 'border-green-200  bg-green-50',  val: 'text-green-700',  lbl: 'text-green-800' },
  }
  const s = styles[color] ?? styles.blue
  return (
    <div className={`border rounded-xl p-3 sm:p-5 cursor-pointer hover:shadow-md transition-shadow ${s.wrap}`}
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}>
      <p className={`text-[11px] sm:text-xs font-semibold uppercase tracking-wide mb-1 ${s.lbl} opacity-70`}>{label}</p>
      <p className={`font-mono font-bold text-base sm:text-2xl leading-tight break-all ${s.val}`}>PKR {fmt(value)}</p>
      <p className="text-xs text-gray-400 mt-1.5">{sub}</p>
    </div>
  )
}

// ── Status tile ───────────────────────────────────────────────────────────────

function StatusTile({ status, count, color }) {
  return (
    <div className={`rounded-lg p-2 sm:p-4 text-center ${color}`}>
      <p className="text-xl sm:text-3xl font-bold leading-none">{count}</p>
      <p className="text-[10px] sm:text-xs font-medium mt-1.5">{status}</p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()

  const [kpis,            setKpis]            = useState(null)
  const [statusCounts,    setStatusCounts]    = useState({})
  const [recentShipments, setRecentShipments] = useState([])
  const [overdueClients,  setOverdueClients]  = useState([])
  const [monthPL,         setMonthPL]         = useState(null)
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)

  const ft = currentFortnight()
  const mn = currentMonth()

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError(null)
    try {
      const [
        { data: allShips,    error: e1 },
        { data: allPayments, error: e2 },
        { data: openBals,    error: e3 },
        { data: formEPmts,   error: e4 },
        { data: clearPmts,   error: e5 },
        { data: cassShipsFt, error: e6 },
        { data: cassPmtsFt,  error: e7 },
        { data: clients,     error: e8 },
        { data: mnExpenses,  error: e9 },
        { data: mnIncomeCp,  error: e10 },
        { data: mnIncomeMi,  error: e11 },
        { data: recent,      error: e12 },
      ] = await Promise.all([
        // All shipments for total receivable + status + clearing + form E calculations
        supabase.from('shipments').select(
          'id,client_id,flight_date,status,total_receivable,form_e_amount_pkr,clearing_charges,clearing_agents(is_in_house)'
        ),
        // All client payments (for outstanding calculation)
        supabase.from('client_payments').select('client_id,amount'),
        // Opening balances
        supabase.from('client_opening_balances').select('client_id,amount'),
        // All form E payments
        supabase.from('form_e_payments').select('amount'),
        // All clearing agent payments
        supabase.from('clearing_agent_payments').select('amount'),
        // Current fortnight shipments (for CASS estimate)
        supabase.from('shipments')
          .select('chargeable_weight,pkr_exchange_rate,airlines(cass_commission_usd_per_kg)')
          .gte('flight_date', ft.from).lte('flight_date', ft.to),
        // CASS payments this fortnight
        supabase.from('cass_payments')
          .select('amount').gte('payment_date', ft.from).lte('payment_date', ft.to),
        // All active clients (for overdue computation)
        supabase.from('clients').select('id,name,credit_terms_days').eq('is_active', true),
        // Current month expenses
        supabase.from('expenses').select('amount').gte('expense_date', mn.from).lte('expense_date', mn.to),
        // Current month income (client payments)
        supabase.from('client_payments').select('amount').gte('payment_date', mn.from).lte('payment_date', mn.to),
        // Current month manual income
        supabase.from('manual_income').select('amount').gte('income_date', mn.from).lte('income_date', mn.to),
        // Recent 10 shipments (with names)
        supabase.from('shipments')
          .select('id,flight_date,awb_number,status,total_receivable,clients(name),airlines(name)')
          .order('flight_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      if (e1||e2||e3||e4||e5||e6||e7||e8||e9||e10||e11||e12) {
        throw e1||e2||e3||e4||e5||e6||e7||e8||e9||e10||e11||e12
      }

      // ── KPI 1: Outstanding receivables ──────────────────────────────────────
      const openBalsTotal = r2((openBals || []).reduce((s, r) => s + Number(r.amount), 0))
      const totalRecv     = r2((allShips || []).reduce((s, r) => s + Number(r.total_receivable), 0))
      const totalPaid     = r2((allPayments || []).reduce((s, r) => s + Number(r.amount), 0))
      const outstandingReceivables = r2(openBalsTotal + totalRecv - totalPaid)

      // ── KPI 2: CASS payable (current fortnight estimate) ───────────────────
      const cassGross = r2((cassShipsFt || []).reduce((s, r) => {
        const w    = Number(r.chargeable_weight || 0)
        const rate = Number(r.pkr_exchange_rate || 1)
        const comm = w * Number(r.airlines?.cass_commission_usd_per_kg || 0) * rate
        return s + comm
      }, 0))
      const cassPaidFt = r2((cassPmtsFt || []).reduce((s, r) => s + Number(r.amount), 0))
      const cassPayable = Math.max(0, r2(cassGross - cassPaidFt))

      // ── KPI 3: Form E payable ───────────────────────────────────────────────
      const formETotal  = r2((allShips || []).reduce((s, r) => s + Number(r.form_e_amount_pkr || 0), 0))
      const formEPaid   = r2((formEPmts || []).reduce((s, r) => s + Number(r.amount), 0))
      const formEPayable= Math.max(0, r2(formETotal - formEPaid))

      // ── KPI 4: Clearing payable (non-in-house) ─────────────────────────────
      const clearTotal  = r2((allShips || [])
        .filter((r) => r.clearing_agents && !r.clearing_agents.is_in_house)
        .reduce((s, r) => s + Number(r.clearing_charges || 0), 0))
      const clearPaid   = r2((clearPmts || []).reduce((s, r) => s + Number(r.amount), 0))
      const clearPayable= Math.max(0, r2(clearTotal - clearPaid))

      setKpis({ outstandingReceivables, cassPayable, formEPayable, clearPayable })

      // ── Status counts ───────────────────────────────────────────────────────
      const sc = { PNDNG: 0, 'AP-BLZ': 0, BKD: 0, CNCLD: 0, 'NO SHOW': 0, OFFLOADED: 0, SHPD: 0 }
      for (const s of (allShips || [])) { if (sc[s.status] !== undefined) sc[s.status]++ }
      setStatusCounts(sc)

      // ── Month P&L ───────────────────────────────────────────────────────────
      const mnInc = r2(
        (mnIncomeCp || []).reduce((s, r) => s + Number(r.amount), 0) +
        (mnIncomeMi || []).reduce((s, r) => s + Number(r.amount), 0)
      )
      const mnExp = r2((mnExpenses || []).reduce((s, r) => s + Number(r.amount), 0))
      setMonthPL({ income: mnInc, expenses: mnExp, net: r2(mnInc - mnExp) })

      // ── Overdue client balances ─────────────────────────────────────────────
      const now = new Date()
      const clientMap = {}
      for (const c of (clients || [])) {
        clientMap[c.id] = { name: c.name, creditDays: c.credit_terms_days || 30, balance: 0, lastDate: null }
      }
      for (const ob of (openBals || [])) {
        if (clientMap[ob.client_id]) clientMap[ob.client_id].balance += Number(ob.amount)
      }
      for (const s of (allShips || [])) {
        if (!clientMap[s.client_id]) continue
        clientMap[s.client_id].balance += Number(s.total_receivable || 0)
        if (!clientMap[s.client_id].lastDate || s.flight_date > clientMap[s.client_id].lastDate) {
          clientMap[s.client_id].lastDate = s.flight_date
        }
      }
      for (const p of (allPayments || [])) {
        if (clientMap[p.client_id]) clientMap[p.client_id].balance -= Number(p.amount || 0)
      }
      const overdue = Object.entries(clientMap)
        .filter(([, v]) => v.balance > 1)
        .map(([id, v]) => {
          const lastDt   = v.lastDate ? new Date(v.lastDate) : null
          const daysOld  = lastDt ? Math.floor((now - lastDt) / 86400000) : null
          const isOverdue= daysOld != null && daysOld > v.creditDays
          return { id, ...v, daysOld, isOverdue }
        })
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 6)
      setOverdueClients(overdue)

      setRecentShipments(recent || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [ft.from, ft.to, mn.from, mn.to])

  useEffect(() => { load() }, [load])

  const STATUS_TILES = [
    { status: 'PNDNG',     color: 'bg-gray-100 text-gray-700' },
    { status: 'AP-BLZ',    color: 'bg-amber-100 text-amber-800' },
    { status: 'BKD',       color: 'bg-blue-100 text-blue-800' },
    { status: 'CNCLD',     color: 'bg-red-100 text-red-700' },
    { status: 'NO SHOW',   color: 'bg-orange-100 text-orange-800' },
    { status: 'OFFLOADED', color: 'bg-purple-100 text-purple-800' },
    { status: 'SHPD',      color: 'bg-green-100 text-green-800' },
  ]

  const STATUS_DOT = {
    'PNDNG':     'bg-gray-400',
    'AP-BLZ':    'bg-amber-500',
    'BKD':       'bg-blue-500',
    'CNCLD':     'bg-red-500',
    'NO SHOW':   'bg-orange-500',
    'OFFLOADED': 'bg-purple-500',
    'SHPD':      'bg-green-500',
  }

  if (!supabase) return <div className="p-6 text-danger text-sm">Supabase not configured.</div>

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Trade International Logistics — Business Overview</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="sm:text-sm sm:px-4 sm:py-2" onClick={() => navigate('/shipments')}>
            <Plus className="w-4 h-4" /> New Shipment
          </Button>
          <Button size="sm" className="sm:text-sm sm:px-4 sm:py-2" variant="secondary" onClick={() => navigate('/invoices')}>
            <FileText className="w-4 h-4" /> New Invoice
          </Button>
          <Button size="sm" className="sm:text-sm sm:px-4 sm:py-2" variant="secondary" onClick={() => navigate('/ledgers')}>
            <CreditCard className="w-4 h-4" /> Record Payment
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="py-10 text-center text-danger text-sm">{error}</div>
      ) : (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            <KPICard
              label="Outstanding Receivables"
              value={kpis?.outstandingReceivables ?? 0}
              sub="All clients — amount due"
              color="red"
              onClick={() => navigate('/ledgers')}
            />
            <KPICard
              label="CASS Payable"
              value={kpis?.cassPayable ?? 0}
              sub={`Current fortnight ${fmtDate(ft.from)}–${fmtDate(ft.to)}`}
              color="amber"
              onClick={() => navigate('/cass')}
            />
            <KPICard
              label="Form E Payable"
              value={kpis?.formEPayable ?? 0}
              sub="Outstanding to suppliers"
              color="purple"
              onClick={() => navigate('/form-e')}
            />
            <KPICard
              label="Clearing Payable"
              value={kpis?.clearPayable ?? 0}
              sub="Outstanding to agents"
              color="blue"
              onClick={() => navigate('/clearing')}
            />
          </div>

          {/* ── Middle section ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

            {/* Left: Status tiles + Month P&L */}
            <div className="xl:col-span-2 space-y-6">

              {/* Shipment status */}
              <Card>
                <div className="px-4 pt-4 pb-1 flex items-center justify-between">
                  <h3 className="font-semibold text-navy text-sm uppercase tracking-wide flex items-center gap-2">
                    <Package className="w-4 h-4" /> Active Shipments
                  </h3>
                  <button onClick={() => navigate('/shipments')}
                    className="text-xs text-accent hover:underline flex items-center gap-1">
                    View all <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <CardBody className="pt-2">
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
                    {STATUS_TILES.map(({ status, color }) => (
                      <StatusTile key={status} status={status} count={statusCounts[status] ?? 0} color={color} />
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-1 text-xs text-gray-400">
                    <span>Total shipments in system:</span>
                    <span className="font-bold text-gray-600">
                      {Object.values(statusCounts).reduce((s, n) => s + n, 0)}
                    </span>
                  </div>
                </CardBody>
              </Card>

              {/* Current month P&L */}
              {monthPL && (
                <Card>
                  <div className="px-4 pt-4 pb-1 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-navy text-sm uppercase tracking-wide flex items-center gap-2">
                        {monthPL.net >= 0
                          ? <TrendingUp className="w-4 h-4 text-green-500" />
                          : <TrendingDown className="w-4 h-4 text-red-500" />}
                        Current Month P&amp;L
                      </h3>
                      <p className="text-xs text-gray-400 mt-0.5">{fmtDate(mn.from)} – {fmtDate(mn.to)}</p>
                    </div>
                    <button onClick={() => navigate('/pnl')}
                      className="text-xs text-accent hover:underline flex items-center gap-1">
                      Full P&amp;L <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                  <CardBody className="pt-2">
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="text-center p-3 rounded-lg bg-green-50">
                        <p className="text-xs text-gray-500 mb-1">Income</p>
                        <p className="font-mono font-bold text-green-700">PKR {fmt(monthPL.income)}</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-red-50">
                        <p className="text-xs text-gray-500 mb-1">Expenses</p>
                        <p className="font-mono font-bold text-red-700">PKR {fmt(monthPL.expenses)}</p>
                      </div>
                      <div className={`text-center p-3 rounded-lg ${monthPL.net >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                        <p className="text-xs text-gray-500 mb-1">Net</p>
                        <p className={`font-mono font-bold ${monthPL.net >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                          {monthPL.net < 0 ? '−' : '+'}PKR {fmt(Math.abs(monthPL.net))}
                        </p>
                      </div>
                    </div>
                    {/* Stacked bar */}
                    {(monthPL.income > 0 || monthPL.expenses > 0) && (() => {
                      const max = Math.max(monthPL.income, monthPL.expenses, 1)
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span>
                            <span className="text-gray-500 w-16">Income</span>
                            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-green-500 rounded-full"
                                style={{ width: `${(monthPL.income / max) * 100}%` }} />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"></span>
                            <span className="text-gray-500 w-16">Expenses</span>
                            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-red-400 rounded-full"
                                style={{ width: `${(monthPL.expenses / max) * 100}%` }} />
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                  </CardBody>
                </Card>
              )}
            </div>

            {/* Right: Overdue + CASS info */}
            <div className="space-y-6">

              {/* Overdue balances */}
              <Card>
                <div className="px-4 pt-4 pb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Client Balances Due</h3>
                </div>
                <div className="px-4 pb-4">
                  {overdueClients.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">
                      No outstanding client balances
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {overdueClients.map((c) => (
                        <div key={c.id}
                          className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors ${
                            c.isOverdue
                              ? 'bg-red-50 border-red-200 hover:bg-red-100'
                              : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                          }`}
                          onClick={() => navigate('/ledgers', { state: { clientId: c.id } })}>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800 truncate">{c.name}</p>
                            {c.daysOld != null && (
                              <p className={`text-xs mt-0.5 ${c.isOverdue ? 'text-red-600' : 'text-gray-400'}`}>
                                Last shipment {c.daysOld}d ago{c.isOverdue ? ' — overdue' : ''}
                              </p>
                            )}
                          </div>
                          <div className="text-right ml-2 flex-shrink-0">
                            <p className={`font-mono font-bold text-sm ${c.isOverdue ? 'text-red-700' : 'text-gray-700'}`}>
                              PKR {fmt(c.balance)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {overdueClients.length > 0 && (
                    <button onClick={() => navigate('/ledgers')}
                      className="mt-2 text-xs text-accent hover:underline">
                      View all party ledgers →
                    </button>
                  )}
                </div>
              </Card>

              {/* Upcoming CASS */}
              <Card>
                <div className="px-4 pt-4 pb-2">
                  <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Current CASS Period</h3>
                </div>
                <CardBody className="pt-0">
                  <p className="text-xs text-gray-500 mb-0.5">Fortnight</p>
                  <p className="text-sm font-semibold text-gray-800 mb-3">
                    {fmtDate(ft.from)} – {fmtDate(ft.to)}
                  </p>
                  <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg mb-3">
                    <p className="text-xs text-amber-700 font-medium mb-1">Estimated CASS payable</p>
                    <p className="font-mono font-bold text-amber-800 text-lg">PKR {fmt(kpis?.cassPayable ?? 0)}</p>
                    <p className="text-xs text-amber-600 mt-1">Net after commission — current fortnight only</p>
                  </div>
                  <button onClick={() => navigate('/cass')}
                    className="text-xs text-accent hover:underline flex items-center gap-1">
                    View CASS Reports &amp; Payments <ChevronRight className="w-3 h-3" />
                  </button>
                </CardBody>
              </Card>
            </div>
          </div>

          {/* ── Recent Shipments ── */}
          <Card>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Recent Shipments</h3>
              <button onClick={() => navigate('/shipments')}
                className="text-xs text-accent hover:underline flex items-center gap-1">
                View all <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[620px]">
                <thead className="bg-navy text-white">
                  <tr>
                    {['Date', 'AWB No.', 'Client', 'Airline', 'Status', 'Receivable'].map((h, i) => (
                      <th key={h} className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide ${i === 5 ? 'text-right' : 'text-left'}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentShipments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-gray-400 text-sm">
                        No shipments yet.{' '}
                        <button onClick={() => navigate('/shipments')} className="text-accent hover:underline">
                          Add your first shipment →
                        </button>
                      </td>
                    </tr>
                  ) : (
                    recentShipments.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate('/shipments', { state: { highlightId: s.id } })}>
                        <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(s.flight_date)}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-800">{s.awb_number}</td>
                        <td className="px-3 py-2.5 text-gray-700 text-xs">{s.clients?.name}</td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs">{s.airlines?.name}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            s.status === 'SHPD'      ? 'bg-green-100 text-green-800' :
                            s.status === 'BKD'       ? 'bg-blue-100 text-blue-800' :
                            s.status === 'AP-BLZ'    ? 'bg-amber-100 text-amber-800' :
                            s.status === 'CNCLD'     ? 'bg-red-100 text-red-700' :
                            s.status === 'NO SHOW'   ? 'bg-orange-100 text-orange-800' :
                            s.status === 'OFFLOADED' ? 'bg-purple-100 text-purple-800' :
                                                       'bg-gray-100 text-gray-700'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s.status]}`}></span>
                            {s.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-800">
                          PKR {fmt(s.total_receivable)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
