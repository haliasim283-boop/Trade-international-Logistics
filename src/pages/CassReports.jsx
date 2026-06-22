import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Printer, Plus, Trash2, Pencil, CheckCircle, Clock, CreditCard,
  AlertCircle, ChevronDown,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { ConfirmDialog } from '../components/ui/Modal'
import { CassPaymentModal } from '../components/cass/CassPaymentModal'
import { CassAdjustmentModal } from '../components/cass/CassAdjustmentModal'
import { printCassReport } from '../components/cass/CassPrintView'
import { ManageAirlinesModal } from '../components/cass/ManageAirlinesModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function r2(n) { return Math.round(Number(n || 0) * 100) / 100 }

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

// Generate fortnights going back ~18 months and forward 2 months, most-recent first
function generatePeriods() {
  const periods = []
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 17, 1)
  const end   = new Date(now.getFullYear(), now.getMonth() + 2, 1)

  let cur = new Date(start)
  while (cur < end) {
    const y  = cur.getFullYear()
    const m  = cur.getMonth()
    const mm = String(m + 1).padStart(2, '0')
    const last = new Date(y, m + 1, 0).getDate()
    const ld = String(last).padStart(2, '0')
    periods.push({
      key:   `${y}-${mm}-01|${y}-${mm}-15`,
      start: `${y}-${mm}-01`,
      end:   `${y}-${mm}-15`,
      label: `${MONTH_NAMES[m]} ${y} — Period 1 (1–15)`,
    })
    periods.push({
      key:   `${y}-${mm}-16|${y}-${mm}-${ld}`,
      start: `${y}-${mm}-16`,
      end:   `${y}-${mm}-${ld}`,
      label: `${MONTH_NAMES[m]} ${y} — Period 2 (16–${last})`,
    })
    cur = new Date(y, m + 1, 1)
  }
  return periods.reverse()
}

function defaultPeriodKey() {
  const now = new Date()
  const y  = now.getFullYear()
  const m  = String(now.getMonth() + 1).padStart(2, '0')
  const d  = now.getDate()
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const ld   = String(last).padStart(2, '0')
  return d <= 15
    ? `${y}-${m}-01|${y}-${m}-15`
    : `${y}-${m}-16|${y}-${m}-${ld}`
}

// Calculate CASS values for one shipment row
function calcRow(s, commPct, whtRate) {
  const pwc        = r2(Number(s.chargeable_weight || 0) * Number(s.cass_airline_rate || 0))
  const commission = r2(pwc * commPct / 100)
  const oc_agent   = r2(Number(s.other_charges || 0))
  const oc_airline = 0
  const incentive  = 0
  const netBeforeWHT = r2(pwc - commission - oc_agent + oc_airline + incentive)
  const tax_withheld = r2(netBeforeWHT * whtRate / 100)
  const net_amount   = r2(netBeforeWHT - tax_withheld)
  return { pwc, commission, oc_agent, oc_airline, incentive, tax_withheld, net_amount }
}

const STATUS_CONFIG = {
  Pending: { color: 'bg-amber-100 text-amber-800', icon: Clock,        label: 'Pending' },
  Billed:  { color: 'bg-blue-100 text-blue-800',   icon: AlertCircle,  label: 'Billed' },
  Paid:    { color: 'bg-green-100 text-green-700',  icon: CheckCircle,  label: 'Paid' },
}

// ── Component ─────────────────────────────────────────────────────────────────

const PERIODS = generatePeriods()

export default function CassReports() {
  const location = useLocation()

  // Selectors
  const [airlines,          setAirlines]          = useState([])
  const [selectedAirlineId, setSelectedAirlineId] = useState(location.state?.airlineId ?? '')
  const [selectedPeriodKey, setSelectedPeriodKey] = useState(defaultPeriodKey())

  // Data
  const [shipments,   setShipments]   = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [cassperiod,  setCassperiod]  = useState(null)   // cass_periods row
  const [payments,    setPayments]    = useState([])
  const [settings,    setSettings]    = useState(null)

  // UI
  const [loading,           setLoading]           = useState(false)
  const [error,             setError]             = useState(null)
  const [showPaymentModal,  setShowPaymentModal]  = useState(false)
  const [showAdjModal,      setShowAdjModal]      = useState(false)
  const [editAdj,           setEditAdj]           = useState(null)
  const [deletePayId,       setDeletePayId]       = useState(null)
  const [deleteAdjId,       setDeleteAdjId]       = useState(null)
  const [changingStatus,    setChangingStatus]    = useState(false)
  const [showManageAirlines, setShowManageAirlines] = useState(false)

  // ── Load airlines + settings once ──────────────────────────────────────────
  const loadAirlines = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('airlines').select('*').eq('is_active', true).order('name')
    const list = data ?? []
    setAirlines(list)
    if (!selectedAirlineId && list.length > 0) setSelectedAirlineId(list[0].id)
  }, [selectedAirlineId])

  useEffect(() => {
    if (!supabase) return
    loadAirlines()
    supabase.from('company_settings').select('*').eq('id', 1).single()
      .then(({ data }) => setSettings(data))
  }, [])                // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived: selected airline + period objects ──────────────────────────────
  const airline = useMemo(
    () => airlines.find((a) => a.id === selectedAirlineId) ?? null,
    [airlines, selectedAirlineId],
  )

  const period = useMemo(
    () => PERIODS.find((p) => p.key === selectedPeriodKey) ?? PERIODS[0],
    [selectedPeriodKey],
  )

  // ── Load data when airline+period change ────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!supabase || !selectedAirlineId || !period) return
    setLoading(true); setError(null)

    // 1. Ensure cass_period row exists
    let pRow = null
    {
      const { data: existing } = await supabase
        .from('cass_periods')
        .select('*')
        .eq('airline_id', selectedAirlineId)
        .eq('period_start', period.start)
        .eq('period_end', period.end)
        .maybeSingle()

      if (existing) {
        pRow = existing
      } else {
        const { data: created, error: ce } = await supabase
          .from('cass_periods')
          .insert({
            airline_id:   selectedAirlineId,
            period_start: period.start,
            period_end:   period.end,
            status:       'Pending',
          })
          .select()
          .single()
        if (ce) { setError(ce.message); setLoading(false); return }
        pRow = created
      }
    }
    setCassperiod(pRow)

    // 2. Shipments for this airline + period
    const { data: sData, error: sErr } = await supabase
      .from('shipments')
      .select('id,flight_date,awb_number,origin,destination,pieces,chargeable_weight,other_charges,cass_airline_rate,clients(name)')
      .eq('airline_id', selectedAirlineId)
      .gte('flight_date', period.start)
      .lte('flight_date', period.end)
      .order('flight_date', { ascending: true })
    if (sErr) { setError(sErr.message); setLoading(false); return }

    // 3. Adjustments
    const { data: aData } = await supabase
      .from('cass_adjustments')
      .select('*')
      .eq('cass_period_id', pRow.id)
      .order('created_at')

    // 4. Payments
    const { data: pyData } = await supabase
      .from('cass_payments')
      .select('*')
      .eq('cass_period_id', pRow.id)
      .order('payment_date')

    setShipments(sData ?? [])
    setAdjustments(aData ?? [])
    setPayments(pyData ?? [])
    setLoading(false)
  }, [selectedAirlineId, period])

  useEffect(() => { loadData() }, [loadData])

  // ── Calculated rows ─────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    if (!airline) return []
    const commPct = Number(airline.cass_commission_pct || 5)
    const whtRate = Number(settings?.cass_wht_rate || 12)
    return shipments.map((s) => ({ ...s, ...calcRow(s, commPct, whtRate) }))
  }, [shipments, airline, settings])

  // ── Recapitulation ──────────────────────────────────────────────────────────
  const recap = useMemo(() => {
    const totalWeight   = rows.reduce((s, r) => s + Number(r.chargeable_weight || 0), 0)
    const totalPWC      = r2(rows.reduce((s, r) => s + r.pwc, 0))
    const totalCommission = r2(rows.reduce((s, r) => s + r.commission, 0))
    const totalOCAgent  = r2(rows.reduce((s, r) => s + r.oc_agent, 0))
    const totalOCAirline = r2(rows.reduce((s, r) => s + r.oc_airline, 0))
    const totalIncentive = r2(rows.reduce((s, r) => s + r.incentive, 0))
    const totalWHT      = r2(rows.reduce((s, r) => s + r.tax_withheld, 0))
    const totalNet      = r2(rows.reduce((s, r) => s + r.net_amount, 0))
    const awbCount      = rows.length
    const bta           = r2(Number(airline?.bta_rate_per_awb || 0) * awbCount)
    const totalAdj      = r2(adjustments.reduce((s, a) => s + Number(a.amount || 0), 0))
    const netDueExport  = r2(totalPWC - totalCommission - totalOCAgent - totalWHT + totalAdj)
    const grandTotal    = r2(netDueExport + bta)
    const totalPaid     = r2(payments.reduce((s, p) => s + Number(p.amount || 0), 0))
    const balanceDue    = r2(grandTotal - totalPaid)
    return {
      totalWeight, totalPWC, totalCommission, totalOCAgent, totalOCAirline,
      totalIncentive, totalWHT, totalNet, awbCount, bta, totalAdj,
      netDueExport, grandTotal, totalPaid, balanceDue,
      status: cassperiod?.status ?? 'Pending',
    }
  }, [rows, adjustments, payments, airline, cassperiod])

  // ── Status change ───────────────────────────────────────────────────────────
  async function handleStatusChange(newStatus) {
    if (!cassperiod) return
    setChangingStatus(true)
    const { error: e } = await supabase
      .from('cass_periods')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', cassperiod.id)
    setChangingStatus(false)
    if (e) { alert(e.message); return }
    setCassperiod((p) => ({ ...p, status: newStatus }))
  }

  // ── Delete handlers ─────────────────────────────────────────────────────────
  async function deletePayment() {
    await supabase.from('cass_payments').delete().eq('id', deletePayId)
    setDeletePayId(null); loadData()
  }

  async function deleteAdj() {
    await supabase.from('cass_adjustments').delete().eq('id', deleteAdjId)
    setDeleteAdjId(null); loadData()
  }

  // ── Print ───────────────────────────────────────────────────────────────────
  function handlePrint() {
    printCassReport({ airline, period, rows, recap, adjustments, payments, settings })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const statusCfg = STATUS_CONFIG[cassperiod?.status ?? 'Pending']
  const StatusIcon = statusCfg.icon

  if (!supabase) {
    return (
      <div className="p-6 text-danger text-sm">Supabase not configured. Check your .env file.</div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Airline Sales Reports (CASS)</h1>
          <p className="text-sm text-gray-500 mt-0.5">Fortnightly CASS billing reports per airline</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowManageAirlines(true)} variant="secondary">
            <Plus className="w-4 h-4" /> Manage Airlines
          </Button>
          {airline && period && (
            <Button onClick={handlePrint} variant="secondary">
              <Printer className="w-4 h-4" /> Print / PDF
            </Button>
          )}
        </div>
      </div>

      {/* ── Selectors ── */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Airline</label>
              <div className="relative">
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-accent"
                  value={selectedAirlineId}
                  onChange={(e) => setSelectedAirlineId(e.target.value)}
                >
                  <option value="">— Select Airline —</option>
                  {airlines.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.iata_prefix})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>

            <div className="flex-1 min-w-[260px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Billing Period</label>
              <div className="relative">
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-accent"
                  value={selectedPeriodKey}
                  onChange={(e) => setSelectedPeriodKey(e.target.value)}
                >
                  {PERIODS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>

            {cassperiod && (
              <div className="flex items-center gap-2 pb-0.5">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${statusCfg.color}`}>
                  <StatusIcon className="w-3.5 h-3.5" />
                  {cassperiod.status}
                </span>
                {cassperiod.status === 'Pending' && (
                  <button
                    onClick={() => handleStatusChange('Billed')}
                    disabled={changingStatus}
                    className="text-xs px-3 py-1.5 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium transition-colors"
                  >
                    Mark Billed
                  </button>
                )}
                {cassperiod.status === 'Billed' && (
                  <>
                    <button
                      onClick={() => handleStatusChange('Paid')}
                      disabled={changingStatus}
                      className="text-xs px-3 py-1.5 rounded-md bg-green-50 text-green-700 hover:bg-green-100 font-medium transition-colors"
                    >
                      Mark Paid
                    </button>
                    <button
                      onClick={() => handleStatusChange('Pending')}
                      disabled={changingStatus}
                      className="text-xs px-3 py-1.5 rounded-md bg-gray-50 text-gray-600 hover:bg-gray-100 font-medium transition-colors"
                    >
                      Revert to Pending
                    </button>
                  </>
                )}
                {cassperiod.status === 'Paid' && (
                  <button
                    onClick={() => handleStatusChange('Billed')}
                    disabled={changingStatus}
                    className="text-xs px-3 py-1.5 rounded-md bg-gray-50 text-gray-600 hover:bg-gray-100 font-medium transition-colors"
                  >
                    Revert to Billed
                  </button>
                )}
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {!selectedAirlineId ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-base">Select an airline above to view its CASS report.</p>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="py-8 text-center text-danger text-sm">{error}</div>
      ) : (
        <>
          {/* ── Airline + Period heading ── */}
          <div className="bg-navy text-white rounded-xl px-6 py-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs uppercase tracking-widest text-blue-200 mb-0.5">CASS Report</p>
                <h2 className="text-lg font-bold">{airline?.name} — {period?.label}</h2>
                <p className="text-sm text-blue-200 mt-0.5">
                  Period: {fmtDate(period?.start)} – {fmtDate(period?.end)}
                  &nbsp;|&nbsp; Prefix: {airline?.iata_prefix}
                  &nbsp;|&nbsp; Commission: {airline?.cass_commission_pct}%
                  &nbsp;|&nbsp; WHT: {settings?.cass_wht_rate ?? 12}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-blue-200">AWBs in Period</p>
                <p className="text-3xl font-bold font-mono">{recap.awbCount}</p>
              </div>
            </div>
          </div>

          {/* ── Per-AWB Table ── */}
          <Card>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Per-AWB Detail</h3>
              {rows.length > 0 && (
                <span className="text-xs text-gray-400">{rows.length} shipment{rows.length !== 1 ? 's' : ''}</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[1100px]">
                <thead className="bg-navy text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide w-10">SN</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">AWB No.</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">ORG</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">DST</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Weight (KGS)</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Prepaid Wgt Charges</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Commission</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">OC Due Agent</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">OC Due Airline</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Incentive</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Tax Withheld</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide">SPIN</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Net Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="text-center py-12 text-gray-400 text-sm">
                        No shipments found for {airline?.name} in {period?.label}.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r, i) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500 text-xs">{i + 1}</td>
                        <td className="px-3 py-2 font-mono text-xs font-medium text-navy">{r.awb_number}</td>
                        <td className="px-3 py-2 text-gray-700">{r.origin}</td>
                        <td className="px-3 py-2 text-gray-700">{r.destination}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-700">
                          {Number(r.chargeable_weight || 0).toFixed(3)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-gray-900">{fmt(r.pwc)}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-700">({fmt(r.commission)})</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-700">
                          {r.oc_agent > 0 ? `(${fmt(r.oc_agent)})` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">—</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">—</td>
                        <td className="px-3 py-2 text-right font-mono text-purple-700">({fmt(r.tax_withheld)})</td>
                        <td className="px-3 py-2 text-center text-gray-500 text-xs">{i + 1}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-navy">{fmt(r.net_amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="bg-navy text-white">
                    <tr>
                      <td colSpan={4} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide">
                        Totals ({rows.length} AWBs)
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-xs">
                        {Number(recap.totalWeight).toFixed(3)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-xs">{fmt(recap.totalPWC)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-xs">({fmt(recap.totalCommission)})</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-xs">
                        {recap.totalOCAgent > 0 ? `(${fmt(recap.totalOCAgent)})` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-xs">—</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-xs">—</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-xs">({fmt(recap.totalWHT)})</td>
                      <td></td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-sm">{fmt(recap.totalNet)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          {/* ── Recapitulation + Adjustments + Payment — side by side ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Recapitulation */}
            <Card>
              <div className="px-4 pt-4 pb-2">
                <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Recapitulation</h3>
              </div>
              <div className="px-4 pb-4">
                <table className="w-full text-sm">
                  <tbody>
                    <RecapRow label="Total Commissionable Sales" value={recap.totalPWC} />
                    <RecapRow label={`Commission Due Agent (${airline?.cass_commission_pct ?? 5}%)`} value={-recap.totalCommission} sub />
                    {recap.totalOCAgent > 0 && (
                      <RecapRow label="Other Charges Due Agent" value={-recap.totalOCAgent} sub />
                    )}
                    <RecapRow label={`WHT @ ${settings?.cass_wht_rate ?? 12}%`} value={-recap.totalWHT} sub purple />
                    {adjustments.map((a) => (
                      <RecapRow
                        key={a.id}
                        label={a.description}
                        value={Number(a.amount)}
                        sub
                        green={Number(a.amount) < 0}
                      />
                    ))}
                    <tr className="border-t-2 border-gray-300">
                      <td className="py-2 font-semibold text-gray-900">Net Due Export</td>
                      <td className="py-2 text-right font-mono font-semibold text-navy">PKR {fmt(recap.netDueExport)}</td>
                    </tr>
                    {recap.bta > 0 && (
                      <RecapRow
                        label={`Net Due DIP (BTA: PKR ${fmt(airline?.bta_rate_per_awb ?? 0)} × ${recap.awbCount})`}
                        value={recap.bta}
                        amber
                      />
                    )}
                    <tr className="bg-navy text-white">
                      <td className="px-3 py-3 font-bold rounded-bl-lg">GRAND TOTAL PAYABLE</td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-lg rounded-br-lg">
                        PKR {fmt(recap.grandTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Payment Summary */}
            <div className="space-y-4">
              <Card>
                <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Payment Summary</h3>
                </div>
                <div className="px-4 pb-4 space-y-2">
                  <div className="flex justify-between text-sm py-1 border-b border-gray-100">
                    <span className="text-gray-600">Grand Total Payable</span>
                    <span className="font-mono font-semibold text-navy">PKR {fmt(recap.grandTotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm py-1 border-b border-gray-100">
                    <span className="text-gray-600">Total Paid</span>
                    <span className="font-mono font-semibold text-green-700">PKR {fmt(recap.totalPaid)}</span>
                  </div>
                  <div className="flex justify-between text-sm py-2">
                    <span className="font-semibold text-gray-800">Balance Due</span>
                    <span className={`font-mono font-bold text-lg ${recap.balanceDue > 0 ? 'text-danger' : 'text-green-600'}`}>
                      PKR {fmt(recap.balanceDue)}
                    </span>
                  </div>
                </div>
              </Card>

              {/* KPI tiles */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <p className="text-xs text-blue-500 font-medium mb-1">Total Weight</p>
                  <p className="font-mono font-bold text-blue-900 text-lg">
                    {Number(recap.totalWeight).toFixed(3)}
                  </p>
                  <p className="text-xs text-blue-400">KGS</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                  <p className="text-xs text-amber-600 font-medium mb-1">Commission Earned</p>
                  <p className="font-mono font-bold text-amber-900 text-lg">
                    PKR {fmt(recap.totalCommission)}
                  </p>
                  <p className="text-xs text-amber-400">{airline?.cass_commission_pct}% of sales</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Adjustments Section ── */}
          <Card>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">
                Manual Adjustments
              </h3>
              <Button size="sm" onClick={() => { setEditAdj(null); setShowAdjModal(true) }}>
                <Plus className="w-4 h-4" /> Add Adjustment
              </Button>
            </div>
            <div className="px-4 pb-4">
              {adjustments.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No adjustments for this period. Add credits or corrections above.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Amount (PKR)</th>
                      <th className="w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {adjustments.map((a) => (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="py-2 text-gray-700 italic">{a.description}</td>
                        <td className={`py-2 text-right font-mono ${Number(a.amount) < 0 ? 'text-green-600' : 'text-gray-900'}`}>
                          {Number(a.amount) >= 0 ? '+' : ''}{fmt(a.amount)}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => { setEditAdj(a); setShowAdjModal(true) }}
                              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-navy"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteAdjId(a.id)}
                              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-danger"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-200">
                      <td className="py-2 font-semibold text-gray-700">Total Adjustments</td>
                      <td className={`py-2 text-right font-mono font-semibold ${recap.totalAdj < 0 ? 'text-green-600' : 'text-gray-900'}`}>
                        {recap.totalAdj >= 0 ? '+' : ''}{fmt(recap.totalAdj)}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* ── Payment History ── */}
          <Card>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Payment History</h3>
              <Button size="sm" onClick={() => setShowPaymentModal(true)}>
                <Plus className="w-4 h-4" /> Record Payment
              </Button>
            </div>
            <div className="px-4 pb-4">
              {payments.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No payments recorded yet. Click "Record Payment" when the CASS is settled.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Bank</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Amount (PKR)</th>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Ref / TRX</th>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-blue-50/30">
                        <td className="py-2 text-gray-700">{fmtDate(p.payment_date)}</td>
                        <td className="py-2 text-gray-700">{p.bank_account || '—'}</td>
                        <td className="py-2 text-right font-mono font-semibold text-green-700">{fmt(p.amount)}</td>
                        <td className="py-2 font-mono text-xs text-gray-500">{p.transaction_id || '—'}</td>
                        <td className="py-2 text-gray-500 text-xs">{p.notes || ''}</td>
                        <td className="py-2">
                          <button
                            onClick={() => setDeletePayId(p.id)}
                            className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-danger"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-300">
                    <tr>
                      <td colSpan={2} className="py-2.5 font-semibold text-gray-800">Total Paid</td>
                      <td className="py-2.5 text-right font-mono font-bold text-green-700">{fmt(recap.totalPaid)}</td>
                      <td colSpan={3}></td>
                    </tr>
                    <tr className={recap.balanceDue > 0 ? 'bg-red-50' : 'bg-green-50'}>
                      <td colSpan={2} className="py-2.5 font-bold text-gray-900 rounded-bl-lg">Balance Due</td>
                      <td className={`py-2.5 text-right font-mono font-bold text-lg rounded-br-lg ${recap.balanceDue > 0 ? 'text-danger' : 'text-green-700'}`}>
                        PKR {fmt(recap.balanceDue)}
                      </td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ── Modals ── */}
      {showPaymentModal && cassperiod && (
        <CassPaymentModal
          periodId={cassperiod.id}
          airlineId={selectedAirlineId}
          onClose={() => setShowPaymentModal(false)}
          onSaved={() => { setShowPaymentModal(false); loadData() }}
        />
      )}

      {showAdjModal && cassperiod && (
        <CassAdjustmentModal
          periodId={cassperiod.id}
          existing={editAdj}
          onClose={() => { setShowAdjModal(false); setEditAdj(null) }}
          onSaved={() => { setShowAdjModal(false); setEditAdj(null); loadData() }}
        />
      )}

      {deletePayId && (
        <ConfirmDialog
          title="Delete Payment"
          message="This payment record will be permanently removed."
          onConfirm={deletePayment}
          onCancel={() => setDeletePayId(null)}
        />
      )}

      {deleteAdjId && (
        <ConfirmDialog
          title="Delete Adjustment"
          message="This adjustment will be permanently removed."
          onConfirm={deleteAdj}
          onCancel={() => setDeleteAdjId(null)}
        />
      )}

      {showManageAirlines && (
        <ManageAirlinesModal
          onClose={() => setShowManageAirlines(false)}
          onChanged={loadAirlines}
        />
      )}
    </div>
  )
}

// ── Recap Row helper ──────────────────────────────────────────────────────────

function RecapRow({ label, value, sub, purple, amber, green }) {
  const isNeg = value < 0
  const color = purple
    ? 'text-purple-700'
    : amber
    ? 'text-amber-700'
    : green || isNeg
    ? 'text-green-600'
    : 'text-gray-900'

  return (
    <tr className="border-b border-gray-50">
      <td className={`py-1.5 ${sub ? 'pl-4 text-gray-500 text-xs' : 'font-medium text-gray-700'}`}>
        {label}
      </td>
      <td className={`py-1.5 text-right font-mono text-sm ${color}`}>
        PKR {isNeg ? `(${fmt(Math.abs(value))})` : fmt(value)}
      </td>
    </tr>
  )
}
