import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Printer, Plus, Trash2, Download, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { ConfirmDialog } from '../components/ui/Modal'
import { SalesAgentPaymentModal } from '../components/salesagent/SalesAgentPaymentModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

function r2(n) { return Math.round(Number(n || 0) * 100) / 100 }

function defaultRange() {
  const now = new Date()
  const y   = now.getFullYear()
  const m   = String(now.getMonth() + 1).padStart(2, '0')
  return {
    from: `${y}-${m}-01`,
    to:   now.toISOString().slice(0, 10),
  }
}

// Generate the last N months of fortnights (newest first)
function buildFortnights(months = 18) {
  const result = []
  const now = new Date()
  for (let i = -2; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y    = d.getFullYear()
    const m    = d.getMonth() + 1
    const mStr = String(m).padStart(2, '0')
    const monthName = d.toLocaleString('en-US', { month: 'long' })
    const last = new Date(y, m, 0).getDate()
    // Period 2 first (more recent within the month)
    result.push({
      key:   `${y}-${mStr}-2`,
      label: `${monthName} ${y} — Period 2 (16–${last})`,
      from:  `${y}-${mStr}-16`,
      to:    `${y}-${mStr}-${String(last).padStart(2, '0')}`,
    })
    result.push({
      key:   `${y}-${mStr}-1`,
      label: `${monthName} ${y} — Period 1 (1–15)`,
      from:  `${y}-${mStr}-01`,
      to:    `${y}-${mStr}-15`,
    })
  }
  return result
}

const FORTNIGHTS = buildFortnights()

function exportCSV(shipments, agent, dateFrom, dateTo) {
  const header = ['Date','AWB No.','Client','Origin','Dest','Pieces','Weight (KGS)','Rate (PKR/kg)','Commission (PKR)']
  const lines = shipments.map((s) => {
    const commission = r2(Number(s.chargeable_weight || 0) * Number(s.sales_agent_commission_per_kg || 0))
    return [
      s.flight_date, s.awb_number, s.clients?.name ?? '',
      s.origin, s.destination, s.pieces ?? '',
      s.chargeable_weight, s.sales_agent_commission_per_kg, commission,
    ].map((v) => `"${v ?? ''}"`).join(',')
  })
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `sales-agent-${agent?.name ?? 'report'}-${dateFrom}-${dateTo}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SalesAgentReports() {
  const location = useLocation()
  const range    = defaultRange()

  // Selectors
  const [agents,          setAgents]          = useState([])
  const [selectedAgentId, setSelectedAgentId] = useState(location.state?.agentId ?? '')
  const [dateFrom,        setDateFrom]        = useState(range.from)
  const [dateTo,          setDateTo]          = useState(range.to)

  // Data
  const [shipments, setShipments] = useState([])
  const [payments,  setPayments]  = useState([])

  // UI
  const [loading,          setLoading]          = useState(false)
  const [error,            setError]            = useState(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [deletePayId,      setDeletePayId]      = useState(null)

  // ── Load agents once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return
    supabase.from('sales_agents').select('*').eq('is_active', true).order('name')
      .then(({ data }) => {
        const list = data ?? []
        setAgents(list)
        if (!selectedAgentId && list.length > 0) setSelectedAgentId(list[0].id)
      })
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const agent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )

  // ── Load data when agent/dates change ──────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!supabase || !selectedAgentId || !dateFrom || !dateTo) return
    setLoading(true); setError(null)

    const [{ data: sData, error: sErr }, { data: pData }] = await Promise.all([
      supabase.from('shipments')
        .select('id,flight_date,awb_number,origin,destination,pieces,chargeable_weight,sales_agent_commission_per_kg,clients(name)')
        .eq('sales_agent_id', selectedAgentId)
        .gt('sales_agent_commission_per_kg', 0)
        .gte('flight_date', dateFrom)
        .lte('flight_date', dateTo)
        .order('flight_date'),

      // All payments ever to this agent (no date filter — running total)
      supabase.from('sales_agent_payments')
        .select('*')
        .eq('agent_id', selectedAgentId)
        .order('payment_date'),
    ])

    if (sErr) { setError(sErr.message); setLoading(false); return }
    setShipments(sData ?? [])
    setPayments(pData ?? [])
    setLoading(false)
  }, [selectedAgentId, dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  // ── Summary ─────────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const totalShipments = shipments.length
    const totalWeight    = r2(shipments.reduce((s, r) => s + Number(r.chargeable_weight || 0), 0))
    const totalCommission = r2(shipments.reduce((s, r) =>
      s + r2(Number(r.chargeable_weight || 0) * Number(r.sales_agent_commission_per_kg || 0)), 0
    ))
    const totalPaid      = r2(payments.reduce((s, p) => s + Number(p.amount || 0), 0))
    const balanceDue     = r2(totalCommission - totalPaid)
    return { totalShipments, totalWeight, totalCommission, totalPaid, balanceDue }
  }, [shipments, payments])

  // ── Delete payment ──────────────────────────────────────────────────────────
  async function deletePayment() {
    await supabase.from('sales_agent_payments').delete().eq('id', deletePayId)
    setDeletePayId(null); loadData()
  }

  // ── Fortnight picker ────────────────────────────────────────────────────────
  function applyFortnight(e) {
    const fn = FORTNIGHTS.find((f) => f.key === e.target.value)
    if (fn) { setDateFrom(fn.from); setDateTo(fn.to) }
    else     { setDateFrom('');    setDateTo('') }
  }

  const activeFortnight = FORTNIGHTS.find((f) => f.from === dateFrom && f.to === dateTo)?.key ?? ''

  // ── Print ───────────────────────────────────────────────────────────────────
  function handlePrint() {
    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) return
    const rows = shipments.map((s) => {
      const comm = r2(Number(s.chargeable_weight || 0) * Number(s.sales_agent_commission_per_kg || 0))
      return `<tr>
        <td>${fmtDate(s.flight_date)}</td>
        <td class="mono">${s.awb_number}</td>
        <td>${s.clients?.name ?? '—'}</td>
        <td>${s.origin}</td>
        <td>${s.destination}</td>
        <td class="r">${Number(s.chargeable_weight || 0).toFixed(3)}</td>
        <td class="r mono">${fmt(s.sales_agent_commission_per_kg)}</td>
        <td class="r mono bold">PKR ${fmt(comm)}</td>
      </tr>`
    }).join('')
    w.document.write(`<!DOCTYPE html><html><head><title>Sales Agent Report — ${agent?.name}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a2e;margin:20px}
      h2{margin:0 0 4px}p{margin:0 0 2px;color:#555}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th{background:#1a1a2e;color:#fff;padding:6px 8px;text-align:left;font-size:11px;text-transform:uppercase}
      td{padding:5px 8px;border-bottom:1px solid #eee}
      .r{text-align:right}.mono{font-family:monospace}.bold{font-weight:700}
      tfoot td{background:#f0f0f0;font-weight:700;border-top:2px solid #1a1a2e}
      .summary{display:flex;gap:20px;margin-top:16px}
      .tile{border:1px solid #ddd;border-radius:8px;padding:10px 14px;flex:1}
      .tile p{font-size:10px;color:#666;margin-bottom:2px}.tile h3{margin:0;font-size:16px}
    </style></head><body>
    <h2>Sales Agent Report — ${agent?.name}</h2>
    <p>${fmtDate(dateFrom)} – ${fmtDate(dateTo)}</p>
    <div class="summary">
      <div class="tile"><p>Shipments</p><h3>${summary.totalShipments}</h3></div>
      <div class="tile"><p>Total Commission</p><h3>PKR ${fmt(summary.totalCommission)}</h3></div>
      <div class="tile"><p>Total Paid</p><h3>PKR ${fmt(summary.totalPaid)}</h3></div>
      <div class="tile"><p>Balance Due</p><h3>PKR ${fmt(summary.balanceDue)}</h3></div>
    </div>
    <table><thead><tr>
      <th>Date</th><th>AWB No.</th><th>Client</th><th>Origin</th><th>Dest</th>
      <th class="r">Weight (KGS)</th><th class="r">Rate (PKR/kg)</th><th class="r">Commission (PKR)</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="5">Totals (${summary.totalShipments} shipments)</td>
      <td class="r">${Number(summary.totalWeight).toFixed(3)}</td>
      <td></td>
      <td class="r">PKR ${fmt(summary.totalCommission)}</td>
    </tr></tfoot></table>
    </body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 400)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!supabase) {
    return <div className="p-6 text-danger text-sm">Supabase not configured.</div>
  }

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Sales Agent Reports & Payables</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track commission earned and amounts owed to sales agents</p>
        </div>
        {agent && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => exportCSV(shipments, agent, dateFrom, dateTo)}>
              <Download className="w-4 h-4" /> Export CSV
            </Button>
            <Button variant="secondary" onClick={handlePrint}>
              <Printer className="w-4 h-4" /> Print / PDF
            </Button>
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Sales Agent</label>
              <div className="relative">
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-accent"
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                >
                  <option value="">— Select Agent —</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date From</label>
              <input
                type="date"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date To</label>
              <input
                type="date"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            {/* Fortnight shortcut */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Fortnight</label>
              <div className="relative">
                <select
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-accent"
                  value={activeFortnight}
                  onChange={applyFortnight}
                >
                  <option value="">Fortnight…</option>
                  {FORTNIGHTS.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {!selectedAgentId ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-base">Select a sales agent above to view their report.</p>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="py-8 text-center text-danger text-sm">{error}</div>
      ) : (
        <>
          {/* ── Agent header band ── */}
          <div className="bg-navy text-white rounded-xl px-6 py-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs uppercase tracking-widest text-blue-200 mb-0.5">Sales Agent Report</p>
                <h2 className="text-lg font-bold">{agent?.name}</h2>
                <p className="text-sm text-blue-200 mt-0.5">
                  {agent?.contact && <>{agent.contact} &nbsp;|&nbsp;</>}
                  {fmtDate(dateFrom)} – {fmtDate(dateTo)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-blue-200">Shipments in Period</p>
                <p className="text-3xl font-bold font-mono">{summary.totalShipments}</p>
              </div>
            </div>
          </div>

          {/* ── Summary tiles ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryTile label="Total Shipments"      value={summary.totalShipments}            color="blue" />
            <SummaryTile label="Commission Owed (Period)" value={`PKR ${fmt(summary.totalCommission)}`} sub="(this period)" color="navy" />
            <SummaryTile label="Total Paid (All Time)" value={`PKR ${fmt(summary.totalPaid)}`}  color="green" />
            <SummaryTile
              label="Balance Due"
              value={`PKR ${fmt(summary.balanceDue)}`}
              color={summary.balanceDue > 0 ? 'red' : 'green'}
            />
          </div>

          {/* ── Shipments table ── */}
          <Card>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">
                Commission Shipments — {fmtDate(dateFrom)} to {fmtDate(dateTo)}
              </h3>
              <span className="text-xs text-gray-400">{shipments.length} shipment{shipments.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-navy text-white">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Date</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">AWB No.</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Client</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide">Origin</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide">Dest</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Weight (KGS)</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Rate (PKR/kg)</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Commission (PKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shipments.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-gray-400 text-sm">
                        No shipments with commission for {agent?.name} in this period.
                      </td>
                    </tr>
                  ) : (
                    shipments.map((s) => {
                      const commission = r2(
                        Number(s.chargeable_weight || 0) * Number(s.sales_agent_commission_per_kg || 0)
                      )
                      return (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-700">{fmtDate(s.flight_date)}</td>
                          <td className="px-4 py-2.5 font-mono text-xs font-medium text-navy">{s.awb_number}</td>
                          <td className="px-4 py-2.5 text-gray-700">{s.clients?.name ?? '—'}</td>
                          <td className="px-4 py-2.5 text-center font-medium text-gray-700">{s.origin}</td>
                          <td className="px-4 py-2.5 text-center font-medium text-gray-700">{s.destination}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-gray-600">
                            {Number(s.chargeable_weight || 0).toFixed(3)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-gray-600">
                            {fmt(s.sales_agent_commission_per_kg)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-navy">
                            PKR {fmt(commission)}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
                {shipments.length > 0 && (
                  <tfoot className="bg-navy text-white">
                    <tr>
                      <td colSpan={5} className="px-4 py-2.5 font-bold text-xs uppercase tracking-wide">
                        Period Totals ({summary.totalShipments} shipments)
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-xs">
                        {Number(summary.totalWeight).toFixed(3)}
                      </td>
                      <td></td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold">
                        PKR {fmt(summary.totalCommission)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          {/* ── Payment History ── */}
          <Card>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Payment History</h3>
                <p className="text-xs text-gray-400 mt-0.5">All payments ever made to {agent?.name}</p>
              </div>
              <Button size="sm" onClick={() => setShowPaymentModal(true)}>
                <Plus className="w-4 h-4" /> Record Payment
              </Button>
            </div>
            <div className="px-4 pb-4">
              {payments.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No payments recorded yet. Click "Record Payment" to log a payment.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Bank / Method</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Amount (PKR)</th>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Ref / TRX</th>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Period Covered</th>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-green-50/30">
                        <td className="py-2 text-gray-700">{fmtDate(p.payment_date)}</td>
                        <td className="py-2 text-gray-700">{p.bank_account || '—'}</td>
                        <td className="py-2 text-right font-mono font-semibold text-green-700">{fmt(p.amount)}</td>
                        <td className="py-2 font-mono text-xs text-gray-500">{p.transaction_id || '—'}</td>
                        <td className="py-2 text-xs text-gray-500">
                          {p.period_start && p.period_end
                            ? `${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`
                            : '—'}
                        </td>
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
                      <td colSpan={2} className="py-2.5 font-semibold text-gray-800">Total Paid (All Time)</td>
                      <td className="py-2.5 text-right font-mono font-bold text-green-700">{fmt(summary.totalPaid)}</td>
                      <td colSpan={4}></td>
                    </tr>
                    <tr className={summary.balanceDue > 0 ? 'bg-red-50' : 'bg-green-50'}>
                      <td colSpan={2} className="py-2.5 font-bold text-gray-900">
                        Balance Due (Period Commission − All Paid)
                      </td>
                      <td className={`py-2.5 text-right font-mono font-bold text-lg ${summary.balanceDue > 0 ? 'text-danger' : 'text-green-700'}`}>
                        PKR {fmt(summary.balanceDue)}
                      </td>
                      <td colSpan={4}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ── Modals ── */}
      {showPaymentModal && selectedAgentId && (
        <SalesAgentPaymentModal
          agentId={selectedAgentId}
          periodStart={dateFrom}
          periodEnd={dateTo}
          onClose={() => setShowPaymentModal(false)}
          onSaved={() => { setShowPaymentModal(false); loadData() }}
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
    </div>
  )
}

// ── Summary tile ──────────────────────────────────────────────────────────────

function SummaryTile({ label, value, sub, color }) {
  const colors = {
    blue:  'bg-blue-50  border-blue-100  text-blue-900',
    navy:  'bg-indigo-50 border-indigo-100 text-indigo-900',
    green: 'bg-green-50 border-green-100 text-green-900',
    red:   'bg-red-50   border-red-100   text-danger',
  }
  return (
    <div className={`border rounded-xl p-4 ${colors[color] ?? colors.blue}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="font-mono font-bold text-lg leading-tight">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  )
}
