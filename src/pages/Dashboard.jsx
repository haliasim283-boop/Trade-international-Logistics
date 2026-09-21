import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  FileText,
  CreditCard,
  AlertCircle,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Package,
  Plane,
  Wallet,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Building2,
  Users,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react'
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

function getInitials(name) {
  if (!name) return 'CL'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-emerald-100 text-emerald-700 border-emerald-200',
  'bg-amber-100 text-amber-700 border-amber-200',
  'bg-rose-100 text-rose-700 border-rose-200',
  'bg-indigo-100 text-indigo-700 border-indigo-200',
]

function getAvatarColor(str) {
  let hash = 0
  for (let i = 0; i < (str || '').length; i++) hash += str.charCodeAt(i)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

// Supabase caps any single request at its project "Max Rows" setting (1000 by default)
async function fetchAllRows(buildQuery) {
  const CHUNK = 1000
  let all = []
  let from = 0
  while (true) {
    const { data, error } = await buildQuery().range(from, from + CHUNK - 1)
    if (error) return { data: null, error }
    all = all.concat(data ?? [])
    if (!data || data.length < CHUNK) break
    from += CHUNK
  }
  return { data: all, error: null }
}

// ── Status Config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  SHPD: {
    label: 'Shipped',
    dot: 'bg-emerald-500',
    barColor: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    glow: 'group-hover:ring-emerald-200',
  },
  BKD: {
    label: 'Booked',
    dot: 'bg-blue-500',
    barColor: 'bg-blue-500',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    glow: 'group-hover:ring-blue-200',
  },
  PNDNG: {
    label: 'Pending',
    dot: 'bg-amber-500',
    barColor: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    glow: 'group-hover:ring-amber-200',
  },
  'AP-BLZ': {
    label: 'Appr. Booking',
    dot: 'bg-indigo-500',
    barColor: 'bg-indigo-500',
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    glow: 'group-hover:ring-indigo-200',
  },
  OFFLOADED: {
    label: 'Offloaded',
    dot: 'bg-purple-500',
    barColor: 'bg-purple-500',
    badge: 'bg-purple-50 text-purple-700 border-purple-200',
    glow: 'group-hover:ring-purple-200',
  },
  FBL: {
    label: 'FBL Issued',
    dot: 'bg-teal-500',
    barColor: 'bg-teal-500',
    badge: 'bg-teal-50 text-teal-700 border-teal-200',
    glow: 'group-hover:ring-teal-200',
  },
  'NO SHOW': {
    label: 'No Show',
    dot: 'bg-orange-500',
    barColor: 'bg-orange-500',
    badge: 'bg-orange-50 text-orange-700 border-orange-200',
    glow: 'group-hover:ring-orange-200',
  },
  CNCLD: {
    label: 'Cancelled',
    dot: 'bg-rose-500',
    barColor: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    glow: 'group-hover:ring-rose-200',
  },
}

// ── Modern KPI Card ───────────────────────────────────────────────────────────

function ModernKPICard({ title, value, sub, icon: Icon, theme, onClick, actionLabel = 'View details' }) {
  const themeMap = {
    rose: {
      bar: 'bg-gradient-to-r from-rose-500 to-red-500',
      iconBox: 'bg-rose-50 text-rose-600 border border-rose-100 group-hover:bg-rose-600 group-hover:text-white',
      badge: 'text-rose-700 bg-rose-50 border-rose-200/70',
      actionText: 'text-rose-600 group-hover:text-rose-700',
      borderHover: 'hover:border-rose-300',
    },
    amber: {
      bar: 'bg-gradient-to-r from-amber-500 to-orange-500',
      iconBox: 'bg-amber-50 text-amber-600 border border-amber-100 group-hover:bg-amber-600 group-hover:text-white',
      badge: 'text-amber-700 bg-amber-50 border-amber-200/70',
      actionText: 'text-amber-600 group-hover:text-amber-700',
      borderHover: 'hover:border-amber-300',
    },
    purple: {
      bar: 'bg-gradient-to-r from-purple-500 to-indigo-500',
      iconBox: 'bg-purple-50 text-purple-600 border border-purple-100 group-hover:bg-purple-600 group-hover:text-white',
      badge: 'text-purple-700 bg-purple-50 border-purple-200/70',
      actionText: 'text-purple-600 group-hover:text-purple-700',
      borderHover: 'hover:border-purple-300',
    },
    blue: {
      bar: 'bg-gradient-to-r from-blue-500 to-cyan-500',
      iconBox: 'bg-blue-50 text-blue-600 border border-blue-100 group-hover:bg-blue-600 group-hover:text-white',
      badge: 'text-blue-700 bg-blue-50 border-blue-200/70',
      actionText: 'text-blue-600 group-hover:text-blue-700',
      borderHover: 'hover:border-blue-300',
    },
  }

  const t = themeMap[theme] || themeMap.blue

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      className={`group relative bg-white border border-slate-200/80 rounded-2xl shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between overflow-hidden cursor-pointer ${t.borderHover}`}
    >
      {/* Top Accent Strip */}
      <div className={`h-1.5 w-full ${t.bar}`} />

      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
            <div className="flex items-baseline gap-1.5 mt-2">
              <span className="text-xs font-bold text-slate-400 font-mono">PKR</span>
              <span className="text-xl sm:text-2xl lg:text-[26px] font-extrabold text-slate-900 tracking-tight font-mono">
                {fmt(value)}
              </span>
            </div>
          </div>
          <div className={`p-2.5 rounded-xl transition-all duration-300 shrink-0 ${t.iconBox}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>

        {/* Footer Subtext & Action */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500 truncate pr-2">{sub}</span>
          <span className={`font-semibold inline-flex items-center gap-1 transition-transform group-hover:translate-x-0.5 ${t.actionText}`}>
            {actionLabel}
            <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

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
        fetchAllRows(() => supabase.from('shipments').select(
          'id,client_id,flight_date,status,total_receivable,form_e_usd_value,form_e_pkr_rate_payable,clearing_charges,clearing_agents(is_in_house)'
        )),
        // All client payments (for outstanding calculation)
        fetchAllRows(() => supabase.from('client_payments').select('client_id,amount')),
        // Opening balances
        fetchAllRows(() => supabase.from('client_opening_balances').select('client_id,amount')),
        // All form E payments
        fetchAllRows(() => supabase.from('form_e_payments').select('amount')),
        // All clearing agent payments
        fetchAllRows(() => supabase.from('clearing_agent_payments').select('amount')),
        // Current fortnight shipments (for CASS estimate)
        supabase.from('shipments')
          .select('chargeable_weight,pkr_exchange_rate,airlines(cass_commission_usd_per_kg)')
          .gte('flight_date', ft.from).lte('flight_date', ft.to),
        // CASS payments this fortnight
        supabase.from('cass_payments')
          .select('amount').gte('payment_date', ft.from).lte('payment_date', ft.to),
        // All active clients (for overdue computation)
        fetchAllRows(() => supabase.from('clients').select('id,name,credit_terms_days').eq('is_active', true)),
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
      const formETotal  = r2((allShips || []).reduce(
        (s, r) => s + r2(Number(r.form_e_usd_value || 0) * Number(r.form_e_pkr_rate_payable || 0)), 0
      ))
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
      const sc = { PNDNG: 0, 'AP-BLZ': 0, BKD: 0, CNCLD: 0, 'NO SHOW': 0, OFFLOADED: 0, SHPD: 0, FBL: 0 }
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

  const totalShipments = useMemo(() => {
    return Object.values(statusCounts).reduce((s, n) => s + n, 0)
  }, [statusCounts])

  const statusList = useMemo(() => {
    return ['SHPD', 'BKD', 'PNDNG', 'AP-BLZ', 'OFFLOADED', 'FBL', 'NO SHOW', 'CNCLD']
  }, [])

  if (!supabase) return <div className="p-6 text-danger text-sm">Supabase not configured.</div>

  return (
    <div className="space-y-6 w-full pb-10">
      {/* ── Modern Header & Command Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-navy tracking-tight">Logistics Command Center</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Live Status
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Trade International Logistics · Consolidated operations, billing, and cash flow overview
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <button
            title="Refresh Data"
            onClick={load}
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 active:scale-95 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-accent' : ''}`} />
          </button>

          <Button
            size="sm"
            variant="secondary"
            className="shadow-sm border-slate-200 font-medium"
            onClick={() => navigate('/invoices')}
          >
            <FileText className="w-4 h-4 text-slate-600" /> New Invoice
          </Button>

          <Button
            size="sm"
            variant="secondary"
            className="shadow-sm border-slate-200 font-medium"
            onClick={() => navigate('/ledgers')}
          >
            <CreditCard className="w-4 h-4 text-slate-600" /> Record Payment
          </Button>

          <Button
            size="sm"
            className="bg-gradient-to-r from-navy to-navy-light text-white shadow-md shadow-navy/20 hover:shadow-lg hover:brightness-110 active:scale-95 transition-all font-semibold"
            onClick={() => navigate('/shipments')}
          >
            <Plus className="w-4 h-4" /> New Shipment
          </Button>
        </div>
      </div>

      {loading && !kpis ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-3">
          <Spinner size="lg" />
          <p className="text-xs font-medium text-slate-400">Loading live logistics telemetry...</p>
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-center text-rose-700 text-sm">
          <AlertCircle className="w-6 h-6 mx-auto mb-2 text-rose-500" />
          {error}
        </div>
      ) : (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <ModernKPICard
              title="Outstanding Receivables"
              value={kpis?.outstandingReceivables ?? 0}
              sub="All client accounts receivable"
              icon={Wallet}
              theme="rose"
              onClick={() => navigate('/ledgers')}
              actionLabel="Client ledgers"
            />
            <ModernKPICard
              title="CASS Payable"
              value={kpis?.cassPayable ?? 0}
              sub={`Fortnight ${fmtDate(ft.from)} – ${fmtDate(ft.to)}`}
              icon={Plane}
              theme="amber"
              onClick={() => navigate('/cass')}
              actionLabel="CASS reports"
            />
            <ModernKPICard
              title="Form E Payable"
              value={kpis?.formEPayable ?? 0}
              sub="Balance due to Form E suppliers"
              icon={ShieldCheck}
              theme="purple"
              onClick={() => navigate('/form-e')}
              actionLabel="Suppliers"
            />
            <ModernKPICard
              title="Clearing Payable"
              value={kpis?.clearPayable ?? 0}
              sub="Outside clearing agent balances"
              icon={Building2}
              theme="blue"
              onClick={() => navigate('/clearing')}
              actionLabel="Agents"
            />
          </div>

          {/* ── Operations & Financials Grid ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

            {/* Left 2 Cols: Active Shipments + Monthly P&L */}
            <div className="xl:col-span-2 space-y-6">

              {/* ── Active Shipments Operations Hub ── */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-navy/5 text-navy rounded-xl">
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-bold text-navy text-base">Shipment Operations Hub</h2>
                      <p className="text-xs text-slate-400">Click any status to filter live shipments</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg">
                      {totalShipments.toLocaleString()} Total In System
                    </span>
                    <button
                      onClick={() => navigate('/shipments')}
                      className="text-xs font-semibold text-accent hover:text-accent-light flex items-center gap-1 group"
                    >
                      View All <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                </div>

                {/* Status Segmented Distribution Bar */}
                {totalShipments > 0 && (
                  <div className="mt-4">
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                      {statusList.map((st) => {
                        const count = statusCounts[st] || 0
                        if (!count) return null
                        const pct = (count / totalShipments) * 100
                        const cfg = STATUS_CONFIG[st] || STATUS_CONFIG.PNDNG
                        return (
                          <div
                            key={st}
                            title={`${st} (${cfg.label}): ${count} (${pct.toFixed(1)}%)`}
                            style={{ width: `${pct}%` }}
                            className={`${cfg.barColor} h-full transition-all duration-500`}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Interactive Status Tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  {statusList.map((st) => {
                    const cfg = STATUS_CONFIG[st] || STATUS_CONFIG.PNDNG
                    const count = statusCounts[st] || 0
                    return (
                      <div
                        key={st}
                        onClick={() => navigate('/shipments', { state: { status: st } })}
                        className={`group p-3.5 rounded-xl border bg-white hover:bg-slate-50/70 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${cfg.glow}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                            <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                            {st}
                          </span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.badge}`}>
                            {cfg.label}
                          </span>
                        </div>
                        <p className="text-2xl font-black text-slate-900 mt-2 font-mono">
                          {count.toLocaleString()}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── Current Month P&L Widget ── */}
              {monthPL && (
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-2 rounded-xl ${monthPL.net >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                        {monthPL.net >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      </div>
                      <div>
                        <h2 className="font-bold text-navy text-base">Monthly Financial Performance (P&amp;L)</h2>
                        <p className="text-xs text-slate-400">
                          Period: {fmtDate(mn.from)} – {fmtDate(mn.to)} (Current Month)
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => navigate('/pnl')}
                      className="text-xs font-semibold text-accent hover:text-accent-light flex items-center gap-1 group"
                    >
                      Detailed Statement <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>

                  {/* 3 Metric Summary Boxes */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-4">
                    {/* Income */}
                    <div className="p-4 rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/70 to-emerald-50/20">
                      <div className="flex items-center justify-between text-xs text-emerald-800 font-semibold mb-1">
                        <span>Total Income</span>
                        <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                      </div>
                      <p className="font-mono font-extrabold text-lg sm:text-xl text-emerald-700">
                        PKR {fmt(monthPL.income)}
                      </p>
                      <p className="text-[11px] text-emerald-600/80 mt-1">Client payments &amp; manual income</p>
                    </div>

                    {/* Expenses */}
                    <div className="p-4 rounded-xl border border-rose-100 bg-gradient-to-br from-rose-50/70 to-rose-50/20">
                      <div className="flex items-center justify-between text-xs text-rose-800 font-semibold mb-1">
                        <span>Total Expenses</span>
                        <ArrowRight className="w-4 h-4 text-rose-500 rotate-45" />
                      </div>
                      <p className="font-mono font-extrabold text-lg sm:text-xl text-rose-700">
                        PKR {fmt(monthPL.expenses)}
                      </p>
                      <p className="text-[11px] text-rose-600/80 mt-1">Operational &amp; general expenditures</p>
                    </div>

                    {/* Net P&L */}
                    <div className={`p-4 rounded-xl border ${
                      monthPL.net >= 0
                        ? 'border-emerald-200 bg-emerald-100/50'
                        : 'border-rose-200 bg-rose-100/50'
                    }`}>
                      <div className="flex items-center justify-between text-xs font-semibold mb-1">
                        <span className={monthPL.net >= 0 ? 'text-emerald-900' : 'text-rose-900'}>
                          Net Operating P&amp;L
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          monthPL.net >= 0 ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                        }`}>
                          {monthPL.net >= 0 ? 'Surplus' : 'Deficit'}
                        </span>
                      </div>
                      <p className={`font-mono font-extrabold text-lg sm:text-xl ${
                        monthPL.net >= 0 ? 'text-emerald-800' : 'text-rose-800'
                      }`}>
                        {monthPL.net < 0 ? '−' : '+'}PKR {fmt(Math.abs(monthPL.net))}
                      </p>
                      <p className={`text-[11px] mt-1 ${monthPL.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {monthPL.income > 0
                          ? `${((monthPL.net / monthPL.income) * 100).toFixed(1)}% operating margin`
                          : 'Net cash differential'}
                      </p>
                    </div>
                  </div>

                  {/* Relative Visual Comparison Bars */}
                  {(monthPL.income > 0 || monthPL.expenses > 0) && (() => {
                    const maxVal = Math.max(monthPL.income, monthPL.expenses, 1)
                    return (
                      <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="w-16 font-semibold text-slate-600 shrink-0">Income</span>
                          <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                              style={{ width: `${(monthPL.income / maxVal) * 100}%` }}
                            />
                          </div>
                          <span className="w-24 text-right font-mono font-semibold text-emerald-700 text-[11px] shrink-0">
                            {((monthPL.income / maxVal) * 100).toFixed(0)}% scale
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="w-16 font-semibold text-slate-600 shrink-0">Expenses</span>
                          <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-rose-500 to-red-400 rounded-full transition-all duration-500"
                              style={{ width: `${(monthPL.expenses / maxVal) * 100}%` }}
                            />
                          </div>
                          <span className="w-24 text-right font-mono font-semibold text-rose-700 text-[11px] shrink-0">
                            {((monthPL.expenses / maxVal) * 100).toFixed(0)}% scale
                          </span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>

            {/* Right Column: Client Balances Due & CASS Fortnight */}
            <div className="space-y-6">

              {/* ── Client Balances Due Widget ── */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
                        <Users className="w-4 h-4" />
                      </div>
                      <h2 className="font-bold text-navy text-sm uppercase tracking-wide">Client Balances Due</h2>
                    </div>
                    {overdueClients.some(c => c.isOverdue) && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                        Overdue Detected
                      </span>
                    )}
                  </div>

                  {overdueClients.length === 0 ? (
                    <div className="text-center py-10 text-slate-400">
                      <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
                      <p className="text-sm font-medium">All client balances settled</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5 mt-3">
                      {overdueClients.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => navigate('/ledgers', { state: { clientId: c.id } })}
                          className={`group flex items-center justify-between p-2.5 rounded-xl border transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-x-0.5 ${
                            c.isOverdue
                              ? 'bg-rose-50/50 border-rose-200 hover:bg-rose-50'
                              : 'bg-white border-slate-200/80 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 border ${getAvatarColor(c.name)}`}>
                              {getInitials(c.name)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 truncate group-hover:text-accent transition-colors">
                                {c.name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {c.isOverdue ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-600 bg-rose-100/80 px-1.5 py-0.2 rounded">
                                    <Clock className="w-2.5 h-2.5" /> {c.daysOld}d overdue
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-400">
                                    {c.daysOld != null ? `Last ${c.daysOld}d ago` : 'No shipments logged'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0 ml-2">
                            <p className={`font-mono font-bold text-xs ${c.isOverdue ? 'text-rose-700' : 'text-slate-900'}`}>
                              PKR {fmt(c.balance)}
                            </p>
                            <span className="text-[10px] font-semibold text-accent flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              Ledger <ChevronRight className="w-2.5 h-2.5" />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => navigate('/ledgers')}
                    className="w-full py-2 text-center text-xs font-semibold text-accent hover:text-accent-light hover:underline flex items-center justify-center gap-1"
                  >
                    View All Party Ledgers &amp; Aging <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* ── Upcoming CASS Period Card ── */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                      <Plane className="w-4 h-4" />
                    </div>
                    <h2 className="font-bold text-navy text-sm uppercase tracking-wide">Current CASS Period</h2>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    Fortnight Cycle
                  </span>
                </div>

                <div className="mt-3.5 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <span className="text-slate-400">Active Window</span>
                    <span className="font-semibold text-slate-900">
                      {fmtDate(ft.from)} – {fmtDate(ft.to)}
                    </span>
                  </div>

                  <div className="p-4 bg-gradient-to-br from-amber-50/80 to-amber-50/20 border border-amber-200/80 rounded-xl">
                    <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
                      Estimated CASS Payable
                    </p>
                    <p className="font-mono font-black text-xl text-amber-900 mt-1">
                      PKR {fmt(kpis?.cassPayable ?? 0)}
                    </p>
                    <p className="text-[11px] text-amber-700/80 mt-1">
                      Net estimated amount due to airlines after commission deductions
                    </p>
                  </div>

                  <button
                    onClick={() => navigate('/cass')}
                    className="w-full py-2.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all"
                  >
                    Manage CASS Reports &amp; Payments <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* ── Recent Shipments Modern Table ── */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/40">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-navy/5 text-navy rounded-xl">
                  <Package className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-navy text-sm">Recent Shipments Log</h3>
                  <p className="text-xs text-slate-400">Latest active consignments across all routes</p>
                </div>
              </div>

              <button
                onClick={() => navigate('/shipments')}
                className="text-xs font-semibold text-accent hover:text-accent-light flex items-center gap-1 group self-start sm:self-auto"
              >
                Open Full Shipment Directory <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[700px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider text-left">
                    <th className="py-3 px-4">Flight Date</th>
                    <th className="py-3 px-4">AWB Number</th>
                    <th className="py-3 px-4">Client</th>
                    <th className="py-3 px-4">Airline</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Total Receivable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentShipments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-400 text-sm">
                        No shipments found.{' '}
                        <button onClick={() => navigate('/shipments')} className="text-accent font-semibold hover:underline">
                          Log first shipment →
                        </button>
                      </td>
                    </tr>
                  ) : (
                    recentShipments.map((s) => {
                      const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.PNDNG
                      return (
                        <tr
                          key={s.id}
                          className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                          onClick={() => navigate('/shipments', { state: { highlightId: s.id } })}
                        >
                          <td className="py-3 px-4 text-slate-700 whitespace-nowrap text-xs font-medium">
                            {fmtDate(s.flight_date)}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
                              {s.awb_number}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-800 text-xs font-semibold truncate">
                            {s.clients?.name ?? '—'}
                          </td>
                          <td className="py-3 px-4 text-slate-600 text-xs">
                            {s.airlines?.name ?? '—'}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${cfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {s.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-xs text-slate-900">
                            PKR {fmt(s.total_receivable)}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
