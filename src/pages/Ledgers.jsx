import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, Printer, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { ConfirmDialog } from '../components/ui/Modal'
import { PaymentModal } from '../components/ledger/PaymentModal'
import { LedgerPrintView } from '../components/ledger/LedgerPrintView'
import { useAuth } from '../contexts/AuthContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

function buildPaymentDesc(p) {
  if (p.description) return p.description
  const parts = ['AMOUNT RECEIVED']
  if (p.bank_account && p.bank_account !== 'Other') parts.push(p.bank_account.toUpperCase() + ' BANK')
  if (p.transaction_id) parts.push(`TRX ID ${p.transaction_id}`)
  return parts.join(' ')
}

// Build merged + sorted + balanced entry list from raw DB data
function buildEntries(shipments, payments, opening) {
  const raw = []

  if (opening) {
    raw.push({
      id:          `opening-${opening.id}`,
      type:        'opening',
      date:        opening.balance_date,
      description: `OPENING BALANCE — brought forward from ${fmtDate(opening.balance_date)}`,
      receivable:  Number(opening.amount),
      received:    0,
      // shipment-specific fields (unused for this type)
      awb_number: '', origin: '', destination: '', pieces: null,
      weight: 0, net_rate: 0, clearing: 0, other: 0, form_e: 0,
    })
  }

  for (const s of (shipments ?? [])) {
    raw.push({
      id:          s.id,
      type:        'shipment',
      date:        s.flight_date,
      awb_number:  s.awb_number,
      origin:      s.origin,
      destination: s.destination,
      pieces:      s.pieces,
      weight:      Number(s.chargeable_weight || 0),
      net_rate:    Number(s.net_rate || 0),
      clearing:    Number(s.clearing_charges || 0) + Number(s.idc_tax || 0),
      other:       Number(s.other_charges_due_airline || 0) + Number(s.awb_upload_charges || 0) + Number(s.airlines?.bta_rate_per_awb || 0) + Number(s.amendment_charges || 0),
      form_e:      Number(s.form_e_amount_pkr || 0),
      receivable:  Number(s.total_receivable || 0),
      received:    0,
      description: '',
    })
  }

  for (const p of (payments ?? [])) {
    raw.push({
      id:          p.id,
      type:        'payment',
      date:        p.payment_date,
      description: buildPaymentDesc(p),
      receivable:  0,
      received:    Number(p.amount || 0),
      awb_number: '', origin: '', destination: '', pieces: null,
      weight: 0, net_rate: 0, clearing: 0, other: 0, form_e: 0,
    })
  }

  // Sort ASC by date; within same date: opening first, then shipments, then payments
  const ORDER = { opening: 0, shipment: 1, payment: 2 }
  raw.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return (ORDER[a.type] ?? 1) - (ORDER[b.type] ?? 1)
  })

  // Running balance
  let balance = 0
  for (const e of raw) {
    balance = Math.round((balance + e.receivable - e.received) * 100) / 100
    e.balance = balance
  }

  return raw
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(entries, clientName) {
  const header = 'Date,AWB No.,ORG,DST,PCS,Weight,Net Rate,Clearing Chrgs,Other Chrgs,Form E,Receivable,Received,Balance,Description'
  const lines = entries.map((e) => [
    fmtDate(e.date),
    e.awb_number ?? '',
    e.origin ?? '',
    e.destination ?? '',
    e.pieces ?? '',
    e.weight > 0 ? e.weight.toFixed(3) : '',
    e.net_rate > 0 ? e.net_rate : '',
    e.clearing > 0 ? e.clearing : '',
    e.other > 0 ? e.other : '',
    e.form_e > 0 ? e.form_e : '',
    e.receivable > 0 ? e.receivable : '',
    e.received > 0 ? e.received : '',
    e.balance,
    e.description ?? '',
  ].map((v) => `"${v}"`).join(','))

  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `ledger-${clientName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Fortnight periods (same logic as CASS / Master Shipment Log) ─────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function generatePeriods() {
  const periods = []
  const now  = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 17, 1)
  const end   = new Date(now.getFullYear(), now.getMonth() + 2, 1)
  let cur = new Date(start)
  while (cur < end) {
    const y  = cur.getFullYear()
    const m  = cur.getMonth()
    const mm = String(m + 1).padStart(2, '0')
    const last = new Date(y, m + 1, 0).getDate()
    const ld   = String(last).padStart(2, '0')
    periods.push({ key: `${y}-${mm}-01|${y}-${mm}-15`, start: `${y}-${mm}-01`, end: `${y}-${mm}-15`, label: `${MONTH_NAMES[m]} ${y} — Period 1 (1–15)` })
    periods.push({ key: `${y}-${mm}-16|${y}-${mm}-${ld}`, start: `${y}-${mm}-16`, end: `${y}-${mm}-${ld}`, label: `${MONTH_NAMES[m]} ${y} — Period 2 (16–${last})` })
    cur = new Date(y, m + 1, 1)
  }
  return periods.reverse()
}

const PERIODS = generatePeriods()

// ── Component ─────────────────────────────────────────────────────────────────

export default function Ledgers() {
  const location = useLocation()

  // ── Data ──
  const [allClients,  setAllClients]  = useState([])
  const [selClientId, setSelClientId] = useState('')
  const [client,      setClient]      = useState(null)
  const [entries,     setEntries]     = useState([])
  const [overdueDays, setOverdueDays] = useState(30)

  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)

  // ── Modal state ──
  const [paymentModal, setPaymentModal] = useState(false)
  const [printView,    setPrintView]    = useState(false)
  const [deletePayId,  setDeletePayId]  = useState(null)

  // ── Filters ──
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo,   setFilterTo]   = useState('')
  const [selPeriod,  setSelPeriod]  = useState('')

  // ── Load client list + settings ──────────────────────────────────────────

  useEffect(() => {
    if (!supabase) return
    Promise.all([
      supabase.from('clients').select('id, name, contact_person, city').eq('is_active', true).order('name'),
      supabase.from('company_settings').select('invoice_overdue_days').eq('id', 1).single(),
    ]).then(([{ data: cData }, { data: settData }]) => {
      setAllClients(cData ?? [])
      setOverdueDays(settData?.invoice_overdue_days ?? 30)
    })
  }, [])

  // ── Auto-select client from navigation state ──────────────────────────────

  useEffect(() => {
    const cid = location.state?.clientId
    if (cid) {
      setSelClientId(cid)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [location.state])

  // ── Load ledger data when client changes ──────────────────────────────────

  const loadLedger = useCallback(async (clientId) => {
    if (!supabase || !clientId) return
    setLoading(true); setError(null)

    const [
      { data: sData, error: sErr },
      { data: pData },
      { data: obData },
      { data: cData },
    ] = await Promise.all([
      supabase
        .from('shipments')
        .select('id, flight_date, awb_number, origin, destination, pieces, chargeable_weight, net_rate, clearing_charges, idc_tax, awb_upload_charges, other_charges_due_airline, amendment_charges, form_e_amount_pkr, total_receivable, airlines(bta_rate_per_awb)')
        .eq('client_id', clientId)
        .order('flight_date', { ascending: true })
        .order('created_at',  { ascending: true }),
      supabase
        .from('client_payments')
        .select('*')
        .eq('client_id', clientId)
        .order('payment_date', { ascending: true })
        .order('created_at',   { ascending: true }),
      supabase
        .from('client_opening_balances')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle(),
      supabase
        .from('clients')
        .select('id, name, contact_person, city')
        .eq('id', clientId)
        .single(),
    ])

    if (sErr) { setError(sErr.message); setLoading(false); return }

    setEntries(buildEntries(sData ?? [], pData ?? [], obData))
    setClient(cData ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selClientId) loadLedger(selClientId)
    else { setEntries([]); setClient(null) }
  }, [selClientId, loadLedger])

  // ── Summary (always from ALL entries, not filtered) ───────────────────────

  const summary = useMemo(() => {
    const totalReceivable = entries.reduce((s, e) => s + e.receivable, 0)
    const totalReceived   = entries.reduce((s, e) => s + e.received, 0)
    return {
      totalReceivable: Math.round(totalReceivable * 100) / 100,
      totalReceived:   Math.round(totalReceived   * 100) / 100,
      balance:         Math.round((totalReceivable - totalReceived) * 100) / 100,
    }
  }, [entries])

  // ── Display entries: filtered + carry-forward row ─────────────────────────

  const displayEntries = useMemo(() => {
    if (!filterFrom && !filterTo) return entries

    let carryBalance = 0
    const inRange    = []

    for (const e of entries) {
      const beforeFrom = filterFrom && e.date < filterFrom
      const afterTo    = filterTo  && e.date > filterTo

      if (beforeFrom) {
        carryBalance = e.balance
      } else if (!afterTo) {
        inRange.push(e)
      }
    }

    if (filterFrom && inRange.length > 0) {
      return [
        {
          id:          'carry-forward',
          type:        'carry-forward',
          date:        filterFrom,
          description: `BALANCE BROUGHT FORWARD as of ${fmtDate(filterFrom)}`,
          receivable:  0,
          received:    0,
          balance:     carryBalance,
          awb_number: '', origin: '', destination: '', pieces: null,
          weight: 0, net_rate: 0, clearing: 0, other: 0, form_e: 0,
        },
        ...inRange,
      ]
    }
    return inRange
  }, [entries, filterFrom, filterTo])

  // ── Overdue check ─────────────────────────────────────────────────────────

  const isOverdue = useMemo(() => {
    if (!client || summary.balance <= 0) return false
    if (entries.length === 0) return false
    const lastShipment = [...entries].reverse().find((e) => e.type === 'shipment')
    if (!lastShipment) return false
    const [y, m, d] = lastShipment.date.split('-').map(Number)
    const dueDate = new Date(y, m - 1, d + overdueDays)
    return dueDate < new Date()
  }, [entries, client, summary.balance, overdueDays])

  // ── Add payment ───────────────────────────────────────────────────────────

  async function handleAddPayment(payload) {
    setSaving(true)
    const { error: err } = await supabase.from('client_payments').insert(payload)
    setSaving(false)
    if (err) { alert(err.message); return }
    setPaymentModal(false)
    loadLedger(selClientId)
  }

  async function handleDeletePayment() {
    await supabase.from('client_payments').delete().eq('id', deletePayId)
    setDeletePayId(null)
    loadLedger(selClientId)
  }

  // ── Date label for print ──────────────────────────────────────────────────

  const dateLabel = filterFrom || filterTo
    ? `${filterFrom ? fmtDate(filterFrom) : 'Start'} — ${filterTo ? fmtDate(filterTo) : 'Today'}`
    : 'All Dates'

  // ── Style helpers ─────────────────────────────────────────────────────────

  const INP_F = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white'

  const { role } = useAuth()
  const isDataEntry = role === 'Data Entry'

  // ── Data Entry simplified view ────────────────────────────────────────────

  if (isDataEntry) {
    return (
      <>
        <div className="p-6 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-navy tracking-tight">Record Client Payment</h1>
            <p className="text-sm text-gray-500 mt-0.5">Select a client and record a payment.</p>
          </div>

          <Card>
            <CardBody className="py-4">
              <div className="flex flex-wrap gap-3 items-center">
                <select
                  className={INP_F}
                  style={{ minWidth: 260 }}
                  value={selClientId}
                  onChange={(e) => setSelClientId(e.target.value)}
                >
                  <option value="">Select a client…</option>
                  {allClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>

                {selClientId && (
                  <Button size="sm" variant="success" onClick={() => setPaymentModal(true)}>
                    <Plus className="w-4 h-4" />Record Payment
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>

          {selClientId && (
            <div className="relative rounded-xl overflow-hidden">
              <div className="blur-sm pointer-events-none select-none opacity-60">
                <div className="bg-gray-100 rounded-lg h-64 flex items-center justify-center">
                  <div className="space-y-3 w-full px-8">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-4 bg-gray-300 rounded w-full" />
                    ))}
                  </div>
                </div>
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-white/90 rounded-xl px-8 py-5 text-center shadow-lg border border-gray-200">
                  <p className="text-sm font-semibold text-navy">Ledger details are restricted</p>
                  <p className="text-xs text-gray-500 mt-1">Use the button above to record a payment.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {paymentModal && selClientId && (
          <PaymentModal
            clientId={selClientId}
            onSave={handleAddPayment}
            onClose={() => setPaymentModal(false)}
            saving={saving}
          />
        )}
      </>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="p-6 space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy tracking-tight">Party Ledgers / Statements</h1>
            <p className="text-sm text-gray-500 mt-0.5">Running account statements auto-populated from shipments and payments.</p>
          </div>
        </div>

        {/* Client selector + actions */}
        <Card>
          <CardBody className="py-3">
            <div className="flex flex-wrap gap-2 items-center">
              <select
                className={INP_F}
                style={{ minWidth: 240 }}
                value={selClientId}
                onChange={(e) => { setSelClientId(e.target.value); setFilterFrom(''); setFilterTo(''); setSelPeriod('') }}
              >
                <option value="">Select a client…</option>
                {allClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              {selClientId && (
                <>
                  <select
                    className={INP_F}
                    style={{ minWidth: 230 }}
                    value={selPeriod}
                    onChange={(e) => {
                      const key = e.target.value
                      setSelPeriod(key)
                      if (!key) { setFilterFrom(''); setFilterTo(''); return }
                      const p = PERIODS.find((x) => x.key === key)
                      if (p) { setFilterFrom(p.start); setFilterTo(p.end) }
                    }}
                  >
                    <option value="">Fortnight…</option>
                    {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>

                  <input
                    type="date"
                    className={INP_F}
                    value={filterFrom}
                    onChange={(e) => { setFilterFrom(e.target.value); setSelPeriod('') }}
                    title="From date"
                  />
                  <input
                    type="date"
                    className={INP_F}
                    value={filterTo}
                    onChange={(e) => { setFilterTo(e.target.value); setSelPeriod('') }}
                    title="To date"
                  />
                  {(filterFrom || filterTo) && (
                    <button
                      onClick={() => { setFilterFrom(''); setFilterTo(''); setSelPeriod('') }}
                      className="text-xs text-accent hover:underline whitespace-nowrap"
                    >
                      Clear dates
                    </button>
                  )}

                  <div className="ml-auto flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportCSV(displayEntries, client?.name ?? 'client')}
                    >
                      <Download className="w-4 h-4" />Export CSV
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPrintView(true)}>
                      <Printer className="w-4 h-4" />Print Statement
                    </Button>
                    <Button size="sm" variant="success" onClick={() => setPaymentModal(true)}>
                      <Plus className="w-4 h-4" />Record Payment
                    </Button>
                  </div>
                </>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Summary bar — only if client selected */}
        {client && !loading && (
          <div className={`rounded-lg border px-5 py-3 flex flex-wrap gap-6 items-center ${summary.balance > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
            {/* Client info */}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-navy text-sm truncate">
                AC STATEMENT — {client.name}
                {client.contact_person ? ` / ${client.contact_person}` : ''}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{client.city}, Pakistan</div>
            </div>

            {/* Overdue flag */}
            {isOverdue && (
              <div className="flex items-center gap-1.5 text-danger text-xs font-medium">
                <AlertTriangle className="w-4 h-4" />
                Overdue ({overdueDays}+ days)
              </div>
            )}

            {/* Totals */}
            {[
              ['Total Receivable', summary.totalReceivable, 'text-gray-700'],
              ['Total Received',   summary.totalReceived,   'text-success'],
              ['Outstanding Balance', summary.balance,      summary.balance > 0 ? 'text-danger' : 'text-success'],
            ].map(([lbl, val, cls]) => (
              <div key={lbl} className="text-right">
                <div className="text-xs text-gray-500 uppercase tracking-wide">{lbl}</div>
                <div className={`font-mono font-bold text-base ${cls}`}>
                  PKR {fmt(val)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Ledger table */}
        {!selClientId ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-base font-medium">Select a client to view their ledger</p>
            <p className="text-sm mt-1">Or navigate here from Party Management → Clients</p>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        ) : error ? (
          <div className="py-10 text-center text-danger text-sm">{error}</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-base font-medium">No ledger entries for this client</p>
            <p className="text-sm mt-1">Shipments linked to this client will appear here automatically.</p>
          </div>
        ) : (
          <Card>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 1160, width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ backgroundColor: '#1a2744' }}>
                    {[
                      { label: 'Date',         align: 'left'  },
                      { label: 'AWB No.',      align: 'left'  },
                      { label: 'ORG',          align: 'left'  },
                      { label: 'DST',          align: 'left'  },
                      { label: 'PCS',          align: 'right' },
                      { label: 'Weight',       align: 'right' },
                      { label: 'Net Rate',     align: 'right' },
                      { label: 'Clrg Chrgs',   align: 'right' },
                      { label: 'Other Chrgs',  align: 'right' },
                      { label: 'Form E',       align: 'right' },
                      { label: 'Receivable',   align: 'right' },
                      { label: 'Received',     align: 'right' },
                      { label: 'Balance',      align: 'right' },
                      { label: '',             align: 'right' }, // actions
                    ].map(({ label, align }) => (
                      <th
                        key={label}
                        style={{
                          padding: '8px 10px',
                          color: 'white',
                          fontWeight: 600,
                          fontSize: 10,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          textAlign: align,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayEntries.map((e) => {
                    // ── Opening / Carry-forward row ──────────────────────
                    if (e.type === 'opening' || e.type === 'carry-forward') {
                      return (
                        <tr key={e.id} style={{ backgroundColor: '#f3f4f6' }}>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: '#374151' }}>
                            {fmtDate(e.date)}
                          </td>
                          <td
                            colSpan={11}
                            style={{ padding: '7px 10px', fontStyle: 'italic', color: '#6b7280', fontSize: 11 }}
                          >
                            {e.description}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {fmt(e.balance)}
                          </td>
                          <td style={{ padding: '7px 10px' }} /> {/* actions blank */}
                        </tr>
                      )
                    }

                    // ── Payment row ──────────────────────────────────────
                    if (e.type === 'payment') {
                      return (
                        <tr key={e.id} style={{ backgroundColor: '#eff6ff' }}>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: '#1d4ed8' }}>
                            {fmtDate(e.date)}
                          </td>
                          <td
                            colSpan={9}
                            style={{ padding: '7px 10px', color: '#1d4ed8', fontSize: 11 }}
                          >
                            {e.description}
                          </td>
                          <td style={{ padding: '7px 10px' }} /> {/* RECEIVABLE blank */}
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#16a34a', whiteSpace: 'nowrap' }}>
                            {fmt(e.received)}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: e.balance > 0 ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>
                            {fmt(e.balance)}
                          </td>
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                            <button
                              title="Delete payment"
                              onClick={() => setDeletePayId(e.id)}
                              className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-danger transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      )
                    }

                    // ── Shipment row ──────────────────────────────────────
                    const tdS = { padding: '7px 10px', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }
                    const tdR = { ...tdS, textAlign: 'right', fontFamily: 'monospace' }
                    return (
                      <tr key={e.id}>
                        <td style={tdS}>{fmtDate(e.date)}</td>
                        <td style={{ ...tdS, fontFamily: 'monospace', fontWeight: 600, color: '#1a2744' }}>
                          {e.awb_number}
                        </td>
                        <td style={{ ...tdS, fontFamily: 'monospace', fontSize: 11 }}>{e.origin}</td>
                        <td style={{ ...tdS, fontFamily: 'monospace', fontSize: 11 }}>{e.destination}</td>
                        <td style={tdR}>{e.pieces ?? ''}</td>
                        <td style={tdR}>{Number(e.weight || 0).toFixed(3)}</td>
                        <td style={tdR}>{e.net_rate > 0 ? fmt(e.net_rate) : ''}</td>
                        <td style={tdR}>{e.clearing > 0 ? fmt(e.clearing) : ''}</td>
                        <td style={tdR}>{e.other > 0 ? fmt(e.other) : ''}</td>
                        <td style={tdR}>{e.form_e > 0 ? fmt(e.form_e) : ''}</td>
                        <td style={{ ...tdR, fontWeight: 600 }}>{fmt(e.receivable)}</td>
                        <td style={tdS} /> {/* RECEIVED blank */}
                        <td style={{ ...tdR, fontWeight: 600, color: e.balance > 0 ? '#dc2626' : '#16a34a' }}>
                          {fmt(e.balance)}
                        </td>
                        <td style={{ ...tdS, textAlign: 'right' }} /> {/* no actions for shipments */}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer totals */}
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex justify-between items-center text-sm">
              <span className="text-gray-500">
                {displayEntries.length} entr{displayEntries.length !== 1 ? 'ies' : 'y'}
                {(filterFrom || filterTo) ? ' (filtered)' : ''}
              </span>
              <span className={`font-mono font-bold text-base ${summary.balance > 0 ? 'text-danger' : 'text-success'}`}>
                Balance: PKR {fmt(summary.balance)}
              </span>
            </div>
          </Card>
        )}
      </div>

      {/* Payment modal */}
      {paymentModal && selClientId && (
        <PaymentModal
          clientId={selClientId}
          onSave={handleAddPayment}
          onClose={() => setPaymentModal(false)}
          saving={saving}
        />
      )}

      {/* Print / statement view */}
      {printView && client && (
        <LedgerPrintView
          entries={displayEntries}
          client={client}
          summary={summary}
          dateLabel={dateLabel}
          onClose={() => setPrintView(false)}
        />
      )}

      {/* Delete payment confirm */}
      {deletePayId && (
        <ConfirmDialog
          title="Delete Payment Record"
          message="This payment entry will be permanently deleted. The running balance will recalculate."
          onConfirm={handleDeletePayment}
          onCancel={() => setDeletePayId(null)}
        />
      )}
    </>
  )
}
