import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, Plus, Trash2, AlertTriangle, Pencil, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { ConfirmDialog } from '../components/ui/Modal'
import { PaymentModal } from '../components/ledger/PaymentModal'
import { AdjustmentModal } from '../components/ledger/AdjustmentModal'
import { LedgerImportModal } from '../components/ledger/LedgerImportModal'
import { buildPrintHTML } from '../components/ledger/LedgerPrintView'
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
function buildEntries(shipments, payments, adjustments, opening) {
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
      receipt_url: p.receipt_url ?? null,
      awb_number: '', origin: '', destination: '', pieces: null,
      weight: 0, net_rate: 0, clearing: 0, other: 0, form_e: 0,
    })
  }

  for (const a of (adjustments ?? [])) {
    raw.push({
      id:          a.id,
      type:        a.type, // 'credit' | 'debit'
      date:        a.entry_date,
      entry_date:  a.entry_date, // kept for edit-modal prefill
      amount:      Number(a.amount || 0),
      description: a.description,
      notes:       a.notes ?? '',
      receivable:  a.type === 'credit' ? Number(a.amount || 0) : 0,
      received:    a.type === 'debit'  ? Number(a.amount || 0) : 0,
      awb_number: '', origin: '', destination: '', pieces: null,
      weight: 0, net_rate: 0, clearing: 0, other: 0, form_e: 0,
    })
  }

  // Sort ASC by date; within same date: opening first, then shipments, then credits/payments/debits
  const ORDER = { opening: 0, shipment: 1, credit: 2, payment: 3, debit: 3 }
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
    (e.type === 'credit' ? 'CREDIT: ' : e.type === 'debit' ? 'DEBIT: ' : '') + (e.description ?? ''),
  ].map((v) => `"${v}"`).join(','))

  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `ledger-${clientName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── PDF statement export (same layout/colors as Print Statement) ────────────

function statementFileName(clientName) {
  return `Statement-${clientName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`
}

async function buildStatementPdf(entries, client, summary, dateLabel, awbFixedFee) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  const html = buildPrintHTML(entries, client, summary, dateLabel, awbFixedFee)

  const PAGE_PX_WIDTH = 1123 // A4 landscape @ 96dpi
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_PX_WIDTH}px;height:1px;border:none;`
  document.body.appendChild(iframe)

  await new Promise((resolve) => {
    iframe.onload = resolve
    iframe.contentDocument.open()
    iframe.contentDocument.write(html)
    iframe.contentDocument.close()
  })

  await new Promise((r) => setTimeout(r, 400))

  const body = iframe.contentDocument.body
  const contentHeight = body.scrollHeight
  iframe.style.height = contentHeight + 'px'

  // Row boundaries (css px, relative to the iframe document) — page breaks
  // snap to these so a row is never sliced in half across two pages.
  const rowBottoms = Array.from(iframe.contentDocument.querySelectorAll('tr'))
    .map((tr) => tr.getBoundingClientRect().bottom)
    .sort((a, b) => a - b)

  const canvas = await html2canvas(body, {
    scale: 3,
    useCORS: true,
    allowTaint: true,
    width: PAGE_PX_WIDTH,
    height: contentHeight,
  })

  document.body.removeChild(iframe)

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const imgH = (canvas.height * pageW) / canvas.width // full image height in mm
  const mmPerCssPx = imgH / contentHeight
  const pxPerPage = pageH / mmPerCssPx // how many css px worth of content fit on one page

  const sliceCanvas = document.createElement('canvas')
  const sliceCtx = sliceCanvas.getContext('2d')

  let currentTopPx = 0
  let firstPage = true
  while (currentTopPx < contentHeight - 0.5) {
    const targetBottomPx = currentTopPx + pxPerPage
    let sliceBottomPx = targetBottomPx
    if (targetBottomPx < contentHeight) {
      const candidate = rowBottoms.filter((b) => b > currentTopPx + 1 && b <= targetBottomPx).pop()
      if (candidate) sliceBottomPx = candidate
    } else {
      sliceBottomPx = contentHeight
    }

    const canvasTop = Math.round(currentTopPx * (canvas.height / contentHeight))
    const canvasBottom = Math.min(canvas.height, Math.round(sliceBottomPx * (canvas.height / contentHeight)))
    const sliceHeightCanvasPx = canvasBottom - canvasTop

    sliceCanvas.width = canvas.width
    sliceCanvas.height = sliceHeightCanvasPx
    sliceCtx.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height)
    sliceCtx.drawImage(canvas, 0, canvasTop, canvas.width, sliceHeightCanvasPx, 0, 0, canvas.width, sliceHeightCanvasPx)

    const sliceImgData = sliceCanvas.toDataURL('image/jpeg', 0.97)
    const sliceImgH = sliceHeightCanvasPx * (imgH / canvas.height)

    if (!firstPage) pdf.addPage()
    pdf.addImage(sliceImgData, 'JPEG', 0, 0, pageW, sliceImgH)

    firstPage = false
    currentTopPx = sliceBottomPx
  }

  return pdf
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
  const [awbFixedFee, setAwbFixedFee] = useState(0)

  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)

  // ── Modal state ──
  const [paymentModal,    setPaymentModal]    = useState(false)
  const [editPayment,     setEditPayment]     = useState(null)
  const [deletePayId,     setDeletePayId]     = useState(null)
  const [sendBusy,        setSendBusy]        = useState(false)
  const [importModal,     setImportModal]     = useState(false)
  const [adjustmentModal, setAdjustmentModal] = useState(null) // null | 'credit' | 'debit'
  const [editAdjustment,  setEditAdjustment]  = useState(null)
  const [deleteAdjId,     setDeleteAdjId]     = useState(null)

  // ── Filters ──
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo,   setFilterTo]   = useState('')
  const [selPeriod,  setSelPeriod]  = useState('')

  // ── Load client list + settings ──────────────────────────────────────────

  useEffect(() => {
    if (!supabase) return
    Promise.all([
      supabase.from('clients').select('id, name, contact_person, city').eq('is_active', true).order('name'),
      supabase.from('company_settings').select('invoice_overdue_days, default_awb_fixed_fee').eq('id', 1).single(),
    ]).then(([{ data: cData }, { data: settData }]) => {
      setAllClients(cData ?? [])
      setOverdueDays(settData?.invoice_overdue_days ?? 30)
      setAwbFixedFee(Number(settData?.default_awb_fixed_fee ?? 0))
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
      { data: adjData },
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
        .from('client_ledger_adjustments')
        .select('*')
        .eq('client_id', clientId)
        .order('entry_date', { ascending: true })
        .order('created_at', { ascending: true }),
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

    setEntries(buildEntries(sData ?? [], pData ?? [], adjData ?? [], obData))
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

  async function handleUpdatePayment(payload) {
    const { id, ...fields } = payload
    setSaving(true)
    const { error: err } = await supabase.from('client_payments').update(fields).eq('id', id)
    setSaving(false)
    if (err) { alert(err.message); return }
    setEditPayment(null)
    loadLedger(selClientId)
  }

  async function handleDeletePayment() {
    await supabase.from('client_payments').delete().eq('id', deletePayId)
    setDeletePayId(null)
    loadLedger(selClientId)
  }

  // ── Add/edit/delete credit & debit adjustments ────────────────────────────

  async function handleAddAdjustment(payload) {
    setSaving(true)
    const { error: err } = await supabase.from('client_ledger_adjustments').insert(payload)
    setSaving(false)
    if (err) { alert(err.message); return }
    setAdjustmentModal(null)
    loadLedger(selClientId)
  }

  async function handleUpdateAdjustment(payload) {
    const { id, ...fields } = payload
    setSaving(true)
    const { error: err } = await supabase.from('client_ledger_adjustments').update(fields).eq('id', id)
    setSaving(false)
    if (err) { alert(err.message); return }
    setEditAdjustment(null)
    loadLedger(selClientId)
  }

  async function handleDeleteAdjustment() {
    await supabase.from('client_ledger_adjustments').delete().eq('id', deleteAdjId)
    setDeleteAdjId(null)
    loadLedger(selClientId)
  }

  // ── Date label for print ──────────────────────────────────────────────────

  const dateLabel = filterFrom || filterTo
    ? `${filterFrom ? fmtDate(filterFrom) : 'Start'} — ${filterTo ? fmtDate(filterTo) : 'Today'}`
    : 'All Dates'

  // ── PDF export / send ──────────────────────────────────────────────────────

  async function handleDownloadStatementPDF() {
    setSendBusy(true)
    try {
      const pdf = await buildStatementPdf(displayEntries, client, summary, dateLabel, awbFixedFee)
      pdf.save(statementFileName(client.name))
    } catch (err) {
      alert('Could not generate the PDF: ' + err.message)
    } finally {
      setSendBusy(false)
    }
  }

  // ── Style helpers ─────────────────────────────────────────────────────────

  const INP_F = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white'

  const { role } = useAuth()
  const isDataEntry = role === 'Data Entry'

  // ── Data Entry simplified view ────────────────────────────────────────────

  if (isDataEntry) {
    const dataEntryPayments = entries.filter((e) => e.type === 'payment')

    return (
      <>
        <div className="p-6 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-navy tracking-tight">Record Client Payment</h1>
            <p className="text-sm text-gray-500 mt-0.5">Select a client, record a payment, or fix a mistake in one you already entered.</p>
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
            <Card>
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-navy">Payments recorded</p>
                <p className="text-xs text-gray-400 mt-0.5">Shipment charges and balances aren't shown here — only the payments you've recorded.</p>
              </div>
              {loading ? (
                <div className="flex justify-center py-10"><Spinner size="lg" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Description</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {dataEntryPayments.map((e) => (
                        <tr key={e.id}>
                          <td className="px-4 py-2 whitespace-nowrap text-gray-700">{fmtDate(e.date)}</td>
                          <td className="px-4 py-2 text-gray-700">{e.description}</td>
                          <td className="px-4 py-2 text-right font-mono text-success">{fmt(e.received)}</td>
                          <td className="px-4 py-2 text-right">
                            <button
                              title="Edit payment"
                              onClick={() => setEditPayment(e)}
                              className="p-1 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {dataEntryPayments.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">No payments recorded yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
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

        {editPayment && (
          <PaymentModal
            clientId={selClientId}
            existing={editPayment}
            onUpdate={handleUpdatePayment}
            onClose={() => setEditPayment(null)}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={sendBusy || !client}
                      onClick={handleDownloadStatementPDF}
                    >
                      <Download className="w-4 h-4" />Export PDF
                    </Button>

                    <Button size="sm" variant="success" onClick={() => setPaymentModal(true)}>
                      <Plus className="w-4 h-4" />Record Payment
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => setAdjustmentModal('credit')}>
                      <Plus className="w-4 h-4" />Add Credit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setAdjustmentModal('debit')}>
                      <Plus className="w-4 h-4" />Add Debit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setImportModal(true)}>
                      <Upload className="w-4 h-4" />Import Ledger Sheet
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
              <table style={{ minWidth: 1260, width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
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
                      { label: 'AWB Fee',      align: 'right' },
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
                            colSpan={12}
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
                            colSpan={10}
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
                          <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              title="Edit payment"
                              onClick={() => setEditPayment(e)}
                              className="p-1 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
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

                    // ── Credit / Debit adjustment row ────────────────────
                    if (e.type === 'credit' || e.type === 'debit') {
                      const isCredit = e.type === 'credit'
                      const color = isCredit ? '#c2410c' : '#7e22ce'
                      return (
                        <tr key={e.id} style={{ backgroundColor: isCredit ? '#fff7ed' : '#faf5ff' }}>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color }}>
                            {fmtDate(e.date)}
                          </td>
                          <td colSpan={10} style={{ padding: '7px 10px', color, fontSize: 11 }}>
                            {isCredit ? 'CREDIT: ' : 'DEBIT: '}{e.description}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color, whiteSpace: 'nowrap' }}>
                            {isCredit ? fmt(e.receivable) : ''}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color, whiteSpace: 'nowrap' }}>
                            {!isCredit ? fmt(e.received) : ''}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: e.balance > 0 ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>
                            {fmt(e.balance)}
                          </td>
                          <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              title={`Edit ${e.type}`}
                              onClick={() => setEditAdjustment(e)}
                              className="p-1 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              title={`Delete ${e.type}`}
                              onClick={() => setDeleteAdjId(e.id)}
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
                        <td style={tdR}>{fmt(awbFixedFee)}</td>
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

      {/* Add payment modal */}
      {paymentModal && selClientId && (
        <PaymentModal
          clientId={selClientId}
          onSave={handleAddPayment}
          onClose={() => setPaymentModal(false)}
          saving={saving}
        />
      )}

      {/* Edit payment modal */}
      {editPayment && (
        <PaymentModal
          clientId={selClientId}
          existing={editPayment}
          onUpdate={handleUpdatePayment}
          onClose={() => setEditPayment(null)}
          saving={saving}
        />
      )}

      {/* Import ledger sheet modal */}
      {importModal && client && (
        <LedgerImportModal
          clientId={selClientId}
          clientName={client.name}
          onImported={() => loadLedger(selClientId)}
          onClose={() => setImportModal(false)}
        />
      )}

      {/* Add credit/debit adjustment modal */}
      {adjustmentModal && selClientId && (
        <AdjustmentModal
          clientId={selClientId}
          type={adjustmentModal}
          onSave={handleAddAdjustment}
          onClose={() => setAdjustmentModal(null)}
          saving={saving}
        />
      )}

      {/* Edit credit/debit adjustment modal */}
      {editAdjustment && (
        <AdjustmentModal
          clientId={selClientId}
          type={editAdjustment.type}
          existing={editAdjustment}
          onUpdate={handleUpdateAdjustment}
          onClose={() => setEditAdjustment(null)}
          saving={saving}
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

      {/* Delete credit/debit adjustment confirm */}
      {deleteAdjId && (
        <ConfirmDialog
          title="Delete Ledger Entry"
          message="This credit/debit entry will be permanently deleted. The running balance will recalculate."
          onConfirm={handleDeleteAdjustment}
          onCancel={() => setDeleteAdjId(null)}
        />
      )}
    </>
  )
}
