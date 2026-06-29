import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus, Pencil, Trash2, Download, Copy, Eye, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { Table, Thead, Th, Tbody, Tr, Td } from '../components/ui/Table'
import { ConfirmDialog } from '../components/ui/Modal'
import { InvoiceFormModal } from '../components/invoices/InvoiceFormModal'
import { InvoicePrintView, buildPrintHTML } from '../components/invoices/InvoicePrintView'

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  'Draft':          'bg-gray-100 text-gray-600',
  'Sent':           'bg-blue-100 text-blue-700',
  'Partially Paid': 'bg-amber-100 text-amber-700',
  'Paid':           'bg-green-100 text-green-700',
}

const STATUSES = ['Draft', 'Sent', 'Partially Paid', 'Paid']

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

function isOverdue(inv, days) {
  if (inv.status === 'Paid') return false
  const [y, m, d] = inv.invoice_date.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  due.setDate(due.getDate() + days)
  return due < new Date()
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Invoices() {
  const location = useLocation()

  // ── Data ──
  const [invoices,        setInvoices]        = useState([])
  const [clients,         setClients]         = useState([])
  const [clearingAgents,  setClearingAgents]  = useState([])
  const [overdueDays,     setOverdueDays]     = useState(30)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [saving,      setSaving]      = useState(false)

  // ── Modal / overlay state ──
  const [formModal,    setFormModal]    = useState(null)   // { mode, invoice?, shipment? }
  const [printInvoice, setPrintInvoice] = useState(null)   // invoice object to preview/print
  const [deleteId,     setDeleteId]     = useState(null)

  // ── Filter state ──
  const [search,       setSearch]       = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFrom,   setFilterFrom]   = useState('')
  const [filterTo,     setFilterTo]     = useState('')

  // ── Load ─────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('Supabase not configured'); return }
    setLoading(true); setError(null)

    const [
      { data: invData, error: invErr },
      { data: cData },
      { data: caData },
      { data: settData },
    ] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, clients(name, city)')
        .order('invoice_date', { ascending: false })
        .order('created_at',   { ascending: false }),
      supabase.from('clients').select('id, name, city').eq('is_active', true).order('name'),
      supabase.from('clearing_agents').select('id, name, city, origin_code, per_shipment_charge').eq('is_active', true).order('city'),
      supabase.from('company_settings').select('invoice_overdue_days').eq('id', 1).single(),
    ])

    if (invErr) { setError(invErr.message) }
    else {
      setInvoices(invData  ?? [])
      setClients(cData     ?? [])
      setClearingAgents(caData ?? [])
      setOverdueDays(settData?.invoice_overdue_days ?? 30)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Auto-open from shipment navigation ───────────────────────────────────

  useEffect(() => {
    const shipmentId = location.state?.shipmentId
    if (!shipmentId || !supabase) return

    supabase
      .from('shipments')
      .select('*, airlines(name), clients(name, city)')
      .eq('id', shipmentId)
      .single()
      .then(({ data }) => {
        if (data) setFormModal({ mode: 'add', shipment: data })
      })

    // Wipe state so re-navigation doesn't re-open
    window.history.replaceState({}, '', window.location.pathname)
  }, [location.state])

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => invoices.filter((inv) => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !inv.invoice_number?.toLowerCase().includes(q) &&
        !inv.awb_number?.toLowerCase().includes(q) &&
        !inv.clients?.name?.toLowerCase().includes(q)
      ) return false
    }
    if (filterClient && inv.client_id   !== filterClient) return false
    if (filterStatus && inv.status      !== filterStatus) return false
    if (filterFrom   && inv.invoice_date <  filterFrom)   return false
    if (filterTo     && inv.invoice_date >  filterTo)     return false
    return true
  }), [invoices, search, filterClient, filterStatus, filterFrom, filterTo])

  // ── Summary ───────────────────────────────────────────────────────────────

  const totalFiltered = useMemo(
    () => filtered.reduce((s, inv) => s + Number(inv.total_amount || 0), 0),
    [filtered]
  )

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async function handleSave(payload) {
    setSaving(true)
    const isAdd = formModal.mode === 'add'
    const { error: err } = isAdd
      ? await supabase.from('invoices').insert(payload)
      : await supabase
          .from('invoices')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', formModal.invoice.id)

    setSaving(false)
    if (err) { alert(err.message); return }
    setFormModal(null)
    loadAll()
  }

  async function handleDelete() {
    await supabase.from('invoices').delete().eq('id', deleteId)
    setDeleteId(null)
    loadAll()
  }

  async function handleDownloadPDF(inv) {
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ])

    const clientName = inv.clients?.name ?? ''
    const clientCity = inv.clients?.city ?? ''
    const html = buildPrintHTML(inv, clientName, clientCity)

    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;height:1px;border:none;'
    document.body.appendChild(iframe)

    await new Promise(resolve => {
      iframe.onload = resolve
      iframe.contentDocument.open()
      iframe.contentDocument.write(html)
      iframe.contentDocument.close()
    })

    await new Promise(r => setTimeout(r, 400))

    const body = iframe.contentDocument.body
    const contentHeight = body.scrollHeight
    iframe.style.height = contentHeight + 'px'

    const canvas = await html2canvas(body, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      width: 794,
      height: contentHeight,
    })

    document.body.removeChild(iframe)

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const pageW  = pdf.internal.pageSize.getWidth()
    const pageH  = pdf.internal.pageSize.getHeight()
    const imgH   = (canvas.height * pageW) / canvas.width
    const imgData = canvas.toDataURL('image/jpeg', 0.97)

    let remaining = imgH
    let yOffset   = 0
    pdf.addImage(imgData, 'JPEG', 0, yOffset, pageW, imgH)
    remaining -= pageH

    while (remaining > 0) {
      yOffset -= pageH
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, yOffset, pageW, imgH)
      remaining -= pageH
    }

    pdf.save(`Invoice-${inv.invoice_number}.pdf`)
  }

  function handleDuplicate(inv) {
    // Strip the auto-generated invoice_number / invoice_seq so Supabase assigns a new one
    const copy = { ...inv }
    delete copy.invoice_number
    delete copy.invoice_seq
    delete copy.id
    delete copy.created_at
    delete copy.updated_at
    copy.invoice_date = new Date().toISOString().slice(0, 10)
    copy.status       = 'Draft'
    setFormModal({ mode: 'add', invoice: copy })
  }

  // ── Filter helpers ────────────────────────────────────────────────────────

  const hasFilters = search || filterClient || filterStatus || filterFrom || filterTo
  const INP_F = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white'

  function clearFilters() {
    setSearch(''); setFilterClient(''); setFilterStatus(''); setFilterFrom(''); setFilterTo('')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="p-6 space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy tracking-tight">Invoices</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Generate, track, and print client invoices.
            </p>
          </div>
          <Button onClick={() => setFormModal({ mode: 'add' })}>
            <Plus className="w-4 h-4" />New Invoice
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardBody className="py-3">
            <div className="flex flex-wrap gap-2 items-center">
              <input
                name="search"
                className={INP_F}
                style={{ minWidth: 200 }}
                placeholder="Search invoice no., AWB, client…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <select name="filter_client" className={INP_F} value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
                <option value="">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <select name="filter_status" className={INP_F} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>

              <input
                type="date"
                name="filter_from"
                className={INP_F}
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                title="From date"
              />
              <input
                type="date"
                name="filter_to"
                className={INP_F}
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                title="To date"
              />

              {hasFilters && (
                <button onClick={clearFilters} className="text-xs text-accent hover:underline whitespace-nowrap">
                  Clear filters
                </button>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Invoice table */}
        <Card>
          {loading ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : error ? (
            <div className="py-10 text-center text-danger text-sm">{error}</div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-base font-medium">No invoices yet</p>
              <p className="text-sm mt-1">
                Click "New Invoice" or use the{' '}
                <span className="text-accent">invoice icon</span> in Master Shipment Log to generate one from a shipment.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-base font-medium">No invoices match your filters.</p>
            </div>
          ) : (
            <>
              <Table>
                <Thead>
                  <tr>
                    <Th>Invoice No.</Th>
                    <Th>Date</Th>
                    <Th>Client</Th>
                    <Th>AWB Number</Th>
                    <Th>Route</Th>
                    <Th className="text-right">Total (PKR)</Th>
                    <Th>Status</Th>
                    <Th>Actions</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {filtered.map((inv) => {
                    const overdue = isOverdue(inv, overdueDays)
                    return (
                      <Tr key={inv.id} className={overdue ? 'bg-red-50 hover:bg-red-100' : ''}>
                        <Td>
                          <span className="font-mono font-semibold text-navy">{inv.invoice_number}</span>
                        </Td>
                        <Td className="whitespace-nowrap">{fmtDate(inv.invoice_date)}</Td>
                        <Td>{inv.clients?.name ?? '—'}</Td>
                        <Td><span className="font-mono text-sm">{inv.awb_number}</span></Td>
                        <Td>
                          <span className="font-mono text-xs tracking-wider">
                            {inv.origin} → {inv.destination}
                          </span>
                        </Td>
                        <Td className="text-right font-mono font-semibold whitespace-nowrap">
                          {fmt(inv.total_amount)}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_BADGE[inv.status] ?? ''}`}>
                              {inv.status}
                            </span>
                            {overdue && (
                              <span title={`Unpaid — overdue by more than ${overdueDays} days`} className="flex-shrink-0">
                                <AlertTriangle className="w-3.5 h-3.5 text-danger" />
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td>
                          <div className="flex gap-0.5">
                            <button
                              title="View / Print"
                              onClick={() => setPrintInvoice(inv)}
                              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-navy transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              title="Edit"
                              onClick={() => setFormModal({ mode: 'edit', invoice: inv })}
                              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-navy transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              title="Duplicate as new Draft"
                              onClick={() => handleDuplicate(inv)}
                              className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-accent transition-colors"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button
                              title="Download PDF"
                              onClick={() => handleDownloadPDF(inv)}
                              className="p-1.5 rounded hover:bg-green-50 text-gray-500 hover:text-green-700 transition-colors"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              title="Delete"
                              onClick={() => setDeleteId(inv.id)}
                              className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-danger transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>

              {/* Footer totals */}
              <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex justify-between items-center text-sm">
                <span className="text-gray-500">
                  {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
                  {hasFilters ? ' (filtered)' : ''}
                </span>
                <span className="font-mono font-semibold text-navy">
                  Total: PKR {fmt(totalFiltered)}
                </span>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Form modal (create / edit) ───────────────────────────────────── */}
      {formModal && (
        <InvoiceFormModal
          mode={formModal.mode}
          invoice={formModal.invoice}
          shipment={formModal.shipment}
          clients={clients}
          clearingAgents={clearingAgents}
          onSave={handleSave}
          onClose={() => setFormModal(null)}
          saving={saving}
        />
      )}

      {/* ── Print / preview overlay ──────────────────────────────────────── */}
      {printInvoice && (
        <InvoicePrintView
          invoice={printInvoice}
          clientName={printInvoice.clients?.name ?? ''}
          clientCity={printInvoice.clients?.city ?? ''}
          onClose={() => setPrintInvoice(null)}
        />
      )}

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteId && (
        <ConfirmDialog
          title="Delete Invoice"
          message="This invoice will be permanently deleted. This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  )
}
