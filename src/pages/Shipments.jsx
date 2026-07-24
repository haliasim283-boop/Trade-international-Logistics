import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Download, Pencil, Trash2, FileText, Upload, ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { Table, Thead, Th, Tbody, Tr, Td, Tfoot } from '../components/ui/Table'
import { ConfirmDialog } from '../components/ui/Modal'
import { ShipmentFormModal } from '../components/shipments/ShipmentFormModal'
import { ShipmentImportModal } from '../components/shipments/ShipmentImportModal'

const SHIPMENT_SELECT = '*, airlines(name, iata_prefix), clients(name), clearing_agents(name, origin_code), form_e_suppliers(name), sales_agents(name)'

const ORIGINS      = ['PEW','ISB','MUX','SKT','LHE','KHI']
const DESTINATIONS = ['DXB','DOH','AUH','SHJ','BAH','JED','MCT','AAN','KWI','RUH','RKT','MAN','YYZ','LHR']

const FLOAT_FIELDS = new Set([
  'chargeable_weight', 'net_rate', 'pkr_exchange_rate', 'clearing_charges', 'idc_tax',
  'other_charges_due_airline', 'awb_fixed_fee', 'cass_airline_rate',
  'sales_agent_commission_per_kg', 'form_e_usd_value', 'form_e_pkr_rate', 'form_e_pkr_rate_payable',
])
const INT_FIELDS      = new Set(['pieces'])
const NULLABLE_FIELDS = new Set(['clearing_agent_id', 'form_e_supplier_id', 'sales_agent_id'])

function coerceField(field, raw) {
  if (FLOAT_FIELDS.has(field)) return parseFloat(raw) || 0
  if (INT_FIELDS.has(field))   return parseInt(raw) || 1
  if (NULLABLE_FIELDS.has(field)) return raw || null
  if (field === 'destination' || field === 'origin') return raw.toUpperCase().slice(0, 3)
  return raw
}

// Supabase caps any single request at its project "Max Rows" setting (1000 by
// default) — fetch in pages until a short page tells us we've got everything.
async function fetchAllShipments() {
  const CHUNK = 1000
  let all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('shipments')
      .select(SHIPMENT_SELECT)
      .order('flight_date', { ascending: false })
      .order('created_at',  { ascending: false })
      .range(from, from + CHUNK - 1)
    if (error) return { data: null, error }
    all = all.concat(data ?? [])
    if (!data || data.length < CHUNK) break
    from += CHUNK
  }
  return { data: all, error: null }
}

// ── Inline-editable table cell ──────────────────────────────────────────────
function EditableCell({ value, display, type = 'text', options, onSave, align, step, disabled }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)
  const [saving,  setSaving]  = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select?.() }
  }, [editing])

  const alignCls = align === 'right' ? 'text-right font-mono' : ''

  if (disabled) {
    return <Td className={alignCls}>{display}</Td>
  }

  async function commit(newVal) {
    if (String(newVal ?? '') === String(value ?? '')) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(newVal)
      setEditing(false)
    } catch (err) {
      alert(err.message ?? 'Failed to save')
    }
    setSaving(false)
  }

  if (!editing) {
    return (
      <Td
        className={`cursor-pointer hover:bg-blue-50 hover:ring-1 hover:ring-inset hover:ring-accent/40 ${alignCls}`}
        onClick={() => { setDraft(value); setEditing(true) }}
        title="Click to edit"
      >
        {saving ? <Spinner size="sm" /> : (display ?? <span className="text-gray-300">—</span>)}
      </Td>
    )
  }

  if (type === 'select') {
    return (
      <Td className="p-1">
        <select
          ref={inputRef}
          className="w-full border border-accent rounded px-1.5 py-1 text-xs focus:outline-none bg-white"
          value={draft ?? ''}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setEditing(false)}
        >
          <option value="">—</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Td>
    )
  }

  return (
    <Td className="p-1">
      <input
        ref={inputRef}
        type={type}
        step={step}
        className={`w-full border border-accent rounded px-1.5 py-1 text-xs focus:outline-none ${align === 'right' ? 'text-right font-mono' : ''}`}
        value={draft ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    </Td>
  )
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_ROW = {
  'PNDNG':     '',
  'AP-BLZ':    'bg-amber-50',
  'BKD':       'bg-blue-50/60',
  'CNCLD':     'bg-red-50',
  'NO SHOW':   'bg-orange-50',
  'OFFLOADED': 'bg-purple-50',
  'SHPD':      'bg-green-50',
  'EMAILED':   'bg-teal-50',
}

const STATUS_BADGE = {
  'PNDNG':     'bg-gray-100 text-gray-600',
  'AP-BLZ':    'bg-amber-100 text-amber-700',
  'BKD':       'bg-blue-100 text-blue-700',
  'CNCLD':     'bg-red-100 text-red-700',
  'NO SHOW':   'bg-orange-100 text-orange-700',
  'OFFLOADED': 'bg-purple-100 text-purple-700',
  'SHPD':      'bg-green-100 text-green-700',
  'EMAILED':   'bg-teal-100 text-teal-700',
}

const STATUSES = ['PNDNG', 'AP-BLZ', 'BKD', 'CNCLD', 'NO SHOW', 'OFFLOADED', 'SHPD', 'EMAILED']

const PAGE_SIZE = 50

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

function fmtRate(n) {
  return Number(n || 0).toFixed(4)
}

function exportCSV(rows) {
  const cols = [
    ['Date',            (r) => r.flight_date],
    ['AWB Number',      (r) => r.awb_number],
    ['Airline',         (r) => r.airlines?.name ?? ''],
    ['Client',          (r) => r.clients?.name ?? ''],
    ['Origin',          (r) => r.origin],
    ['Destination',     (r) => r.destination],
    ['Pieces',          (r) => r.pieces],
    ['Weight (KGS)',    (r) => r.chargeable_weight],
    ['Net Rate',        (r) => r.net_rate],
    ['Clearing Chgs',   (r) => r.clearing_charges],
    ['IDC Tax',         (r) => r.idc_tax],
    ['Other Charges',   (r) => r.awb_upload_charges],
    ['Form E Amt',      (r) => r.form_e_amount_pkr],
    ['Amendment',       (r) => r.amendment_charges],
    ['CASS Rate',       (r) => r.cass_airline_rate],
    ['Total Receivable',(r) => r.total_receivable],
    ['Status',          (r) => r.status],
  ]
  const header = cols.map(([h]) => `"${h}"`).join(',')
  const lines = rows.map((r) =>
    cols.map(([, fn]) => `"${fn(r) ?? ''}"`).join(',')
  )
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `shipments-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Shipments() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const isDataEntry = role === 'Data Entry'

  // ── Data state ──
  const [shipments,      setShipments]      = useState([])
  const [airlines,       setAirlines]       = useState([])
  const [clients,        setClients]        = useState([])
  const [clearingAgents, setClearingAgents] = useState([])
  const [formESuppliers, setFormESuppliers] = useState([])
  const [salesAgents,    setSalesAgents]    = useState([])
  const [idcTaxRate,     setIdcTaxRate]     = useState(0)
  const [fixedUsdRate,   setFixedUsdRate]   = useState(0)
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState(null)
  const [saving,         setSaving]         = useState(false)

  // ── Modal state ──
  const [formModal,   setFormModal]   = useState(null)   // { mode, shipment? }
  const [deleteId,    setDeleteId]    = useState(null)
  const [showImport,  setShowImport]  = useState(false)

  // ── Filter state ──
  const [search,        setSearch]        = useState('')
  const [filterAirline, setFilterAirline] = useState('')
  const [filterClient,  setFilterClient]  = useState('')
  const [filterStatus,  setFilterStatus]  = useState('')
  const [filterOrigin,  setFilterOrigin]  = useState('')
  const [filterFrom,    setFilterFrom]    = useState('')
  const [filterTo,      setFilterTo]      = useState('')

  // ── Pagination state ──
  const [page, setPage] = useState(1)

  // ── Bulk action state ──
  const [selected,    setSelected]    = useState(new Set())
  const [bulkStatus,  setBulkStatus]  = useState('SHPD')
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // ── Load ────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('Supabase not configured'); return }
    setLoading(true); setError(null)

    const [
      { data: sData, error: sErr },
      { data: aData },
      { data: cData },
      { data: caData },
      { data: feData },
      { data: settData },
      { data: saData },
    ] = await Promise.all([
      fetchAllShipments(),
      supabase.from('airlines').select('*').eq('is_active', true).order('name'),
      supabase.from('clients').select('id, name').eq('is_active', true).order('name'),
      supabase.from('clearing_agents').select('*').eq('is_active', true).order('city'),
      supabase.from('form_e_suppliers').select('id, name').eq('is_active', true).order('name'),
      supabase.from('company_settings').select('*').eq('id', 1).single(),
      supabase.from('sales_agents').select('id, name, commission_pkr_per_kg').eq('is_active', true).order('name'),
    ])

    if (sErr) { setError(sErr.message) }
    else {
      setShipments(sData ?? [])
      setAirlines(aData ?? [])
      setClients(cData ?? [])
      setClearingAgents(caData ?? [])
      setFormESuppliers(feData ?? [])
      setIdcTaxRate(parseFloat(settData?.idc_tax_rate ?? 0))
      setSalesAgents(saData ?? [])
      // Only use fixed rate if today falls within the 15-day window
      const rate      = parseFloat(settData?.fixed_usd_pkr_rate ?? 0)
      const validFrom = settData?.fixed_usd_rate_valid_from
      if (rate && validFrom) {
        const from  = new Date(validFrom)
        const until = new Date(from); until.setDate(until.getDate() + 14)
        const today = new Date().toISOString().slice(0, 10)
        const f     = validFrom.slice(0, 10)
        const u     = until.toISOString().slice(0, 10)
        setFixedUsdRate(today >= f && today <= u ? rate : 0)
      } else {
        setFixedUsdRate(0)
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Filtered list ────────────────────────────────────────────────────────

  const filtered = useMemo(() => shipments.filter((s) => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !s.awb_number?.toLowerCase().includes(q) &&
        !s.clients?.name?.toLowerCase().includes(q)
      ) return false
    }
    if (filterAirline && s.airline_id !== filterAirline) return false
    if (filterClient  && s.client_id  !== filterClient)  return false
    if (filterStatus  && s.status     !== filterStatus)  return false
    if (filterOrigin  && s.origin     !== filterOrigin) return false
    if (filterFrom    && s.flight_date < filterFrom) return false
    if (filterTo      && s.flight_date > filterTo)   return false
    return true
  }), [shipments, search, filterAirline, filterClient, filterStatus, filterOrigin, filterFrom, filterTo])

  // Reset to page 1 whenever the filtered result set changes
  useEffect(() => { setPage(1) }, [search, filterAirline, filterClient, filterStatus, filterOrigin, filterFrom, filterTo])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, currentPage])

  // ── Fortnight options (derived from loaded dates) ────────────────────────

  const fortnights = useMemo(() => {
    const seen = new Set()
    const result = []
    shipments.forEach((s) => {
      const [y, m, d] = s.flight_date.split('-').map(Number)
      const p = d <= 15 ? 1 : 2
      const key = `${y}-${String(m).padStart(2, '0')}-${p}`
      if (!seen.has(key)) {
        seen.add(key)
        const monthName = new Date(y, m - 1).toLocaleString('en-US', { month: 'long' })
        const last = new Date(y, m, 0).getDate()
        result.push({
          key,
          label: `${monthName} ${y} — Period ${p} (${p === 1 ? '1–15' : `16–${last}`})`,
          from: `${y}-${String(m).padStart(2, '0')}-${p === 1 ? '01' : '16'}`,
          to:   `${y}-${String(m).padStart(2, '0')}-${p === 1 ? '15' : String(last).padStart(2, '0')}`,
        })
      }
    })
    return result.sort((a, b) => b.key.localeCompare(a.key))
  }, [shipments])

  function applyFortnight(e) {
    const fn = fortnights.find((f) => f.key === e.target.value)
    if (fn) { setFilterFrom(fn.from); setFilterTo(fn.to) }
    else     { setFilterFrom('');    setFilterTo('') }
  }

  // ── Summary totals ───────────────────────────────────────────────────────

  const totals = useMemo(() => ({
    totalReceivable: filtered.reduce((s, r) => s + parseFloat(r.total_receivable || 0), 0),
  }), [filtered])

  // ── Dropdown option lists for inline editing ────────────────────────────
  const airlineOptions       = useMemo(() => airlines.map((a) => ({ value: a.id, label: `${a.name} (${a.iata_prefix})` })), [airlines])
  const clientOptions        = useMemo(() => clients.map((c) => ({ value: c.id, label: c.name })), [clients])
  const clearingAgentOptions = useMemo(() => clearingAgents.map((a) => ({ value: a.id, label: `${a.name} (${a.origin_code})` })), [clearingAgents])
  const formESupplierOptions = useMemo(() => formESuppliers.map((s) => ({ value: s.id, label: s.name })), [formESuppliers])
  const salesAgentOptions    = useMemo(() => salesAgents.map((a) => ({ value: a.id, label: a.name })), [salesAgents])
  const originOptions        = ORIGINS.map((o) => ({ value: o, label: o }))
  const destinationOptions   = DESTINATIONS.map((d) => ({ value: d, label: d }))
  const statusOptions        = STATUSES.map((s) => ({ value: s, label: s }))

  // ── Selection / bulk ─────────────────────────────────────────────────────

  const allSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map((s) => s.id)))
  }

  function toggleRow(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleBulkStatus() {
    if (!selected.size) return
    setSaving(true)
    await supabase
      .from('shipments')
      .update({ status: bulkStatus, updated_at: new Date().toISOString() })
      .in('id', [...selected])
    setSaving(false)
    setSelected(new Set())
    loadAll()
  }

  async function handleBulkDelete() {
    if (!selected.size) return
    setSaving(true)
    const ids = [...selected]
    const CHUNK = 100
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await supabase.from('shipments').delete().in('id', ids.slice(i, i + CHUNK))
      if (error) { setSaving(false); alert(error.message); loadAll(); return }
    }
    setSaving(false)
    setBulkDeleting(false)
    setSelected(new Set())
    loadAll()
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async function handleSave(payload) {
    setSaving(true)

    let dupQuery = supabase.from('shipments').select('id').eq('awb_number', payload.awb_number)
    if (formModal.mode === 'edit') dupQuery = dupQuery.neq('id', formModal.shipment.id)
    const { data: dupRows, error: dupErr } = await dupQuery.limit(1)
    if (dupErr) { setSaving(false); alert(dupErr.message); return }
    if (dupRows && dupRows.length > 0) {
      setSaving(false)
      alert('AWB number already exists in shipment')
      return
    }

    const { error } = formModal.mode === 'add'
      ? await supabase.from('shipments').insert(payload)
      : await supabase.from('shipments').update(payload).eq('id', formModal.shipment.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    setFormModal(null)
    loadAll()
  }

  async function handleDelete() {
    const { error } = await supabase.from('shipments').delete().eq('id', deleteId)
    if (error) { alert(error.message); return }
    setDeleteId(null)
    loadAll()
  }

  // ── Inline cell edit ─────────────────────────────────────────────────────

  async function refreshRow(id) {
    const { data } = await supabase.from('shipments').select(SHIPMENT_SELECT).eq('id', id).single()
    if (data) setShipments((prev) => prev.map((s) => (s.id === id ? data : s)))
  }

  async function updateField(id, field, rawValue) {
    let value = coerceField(field, rawValue)
    if (field === 'form_e_usd_value') {
      // The cell shows/edits a USD rate per kg; the column stores the total USD value.
      const row = shipments.find((r) => r.id === id)
      value = r2(Number(row?.chargeable_weight || 0) * (parseFloat(rawValue) || 0))
    }
    const payload = { [field]: value, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('shipments').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    await refreshRow(id)
  }

  // ── Filter helpers ───────────────────────────────────────────────────────

  const hasFilters = search || filterAirline || filterClient || filterStatus || filterOrigin || filterFrom || filterTo
  const INP_F = 'shrink-0 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white'

  function clearFilters() {
    setSearch(''); setFilterAirline(''); setFilterClient('')
    setFilterStatus(''); setFilterOrigin(''); setFilterFrom(''); setFilterTo('')
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="p-4 sm:p-6 space-y-5">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-navy tracking-tight">Master Shipment Log</h1>
            <p className="text-sm text-gray-500 mt-0.5">All shipments — the source of truth for all reports.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isDataEntry && (
              <Button size="sm" className="sm:text-sm sm:px-4 sm:py-2" variant="secondary" onClick={() => exportCSV(filtered)}>
                <Download className="w-4 h-4" />Export CSV
              </Button>
            )}
            <Button size="sm" className="sm:text-sm sm:px-4 sm:py-2" variant="secondary" onClick={() => setShowImport(true)}>
              <Upload className="w-4 h-4" />Import Excel
            </Button>
            <Button size="sm" className="sm:text-sm sm:px-4 sm:py-2" onClick={() => setFormModal({ mode: 'add' })}>
              <Plus className="w-4 h-4" />Add Shipment
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardBody className="py-3 overflow-x-auto">
            <div className="flex flex-nowrap gap-2 items-center min-w-0">
              <input
                name="search"
                className={INP_F}
                style={{ minWidth: 160 }}
                placeholder="Search AWB or client…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              {/* Fortnight shortcut */}
              <select name="fortnight" className={INP_F} onChange={applyFortnight}
                value={fortnights.find((f) => f.from === filterFrom && f.to === filterTo)?.key ?? ''}>
                <option value="">Fortnight…</option>
                {fortnights.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>

              <input type="date" name="filter_from" className={INP_F} value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)} title="From date" />
              <input type="date" name="filter_to" className={INP_F} value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)} title="To date" />

              <select name="filter_airline" className={INP_F} value={filterAirline} onChange={(e) => setFilterAirline(e.target.value)}>
                <option value="">All airlines</option>
                {airlines.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>

              <select name="filter_client" className={INP_F} value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
                <option value="">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <select name="filter_status" className={INP_F} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>

              <select name="filter_origin" className={INP_F} value={filterOrigin}
                onChange={(e) => setFilterOrigin(e.target.value)} title="Filter by origin">
                <option value="">All origins</option>
                {['PEW','ISB','MUX','SKT','LHE','KHI'].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>

              {hasFilters && (
                <button onClick={clearFilters} className="text-xs text-accent hover:underline whitespace-nowrap">
                  Clear filters
                </button>
              )}

            </div>
          </CardBody>
        </Card>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="bg-accent/10 border border-accent/30 rounded-lg px-4 py-2.5 flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="text-sm font-medium text-accent">
              {selected.size} shipment{selected.size !== 1 ? 's' : ''} selected
            </span>
            <span className="text-gray-300 hidden sm:inline">|</span>
            <span className="text-sm text-gray-600">Mark as</span>
            <select className={INP_F + ' py-1'} value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <Button size="sm" onClick={handleBulkStatus} disabled={saving}>
              {saving && <Spinner size="sm" />}Apply
            </Button>
            <span className="text-gray-300 hidden sm:inline">|</span>
            <Button size="sm" variant="danger" onClick={() => setBulkDeleting(true)} disabled={saving}>
              <Trash2 className="w-4 h-4" />Delete selected
            </Button>
            <button className="ml-auto text-xs text-gray-400 hover:text-gray-600"
              onClick={() => setSelected(new Set())}>
              Deselect all
            </button>
          </div>
        )}

        {/* Shipment table */}
        <Card>
          {loading ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : error ? (
            <div className="py-10 text-center text-danger text-sm">{error}</div>
          ) : shipments.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-base font-medium">No shipments yet</p>
              <p className="text-sm mt-1">Click "Add Shipment" to log your first shipment.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-base font-medium">No shipments match your filters.</p>
            </div>
          ) : (
            <Table>
              <Thead>
                <tr>
                  <Th className="w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 accent-navy cursor-pointer" />
                  </Th>
                  <Th>Date</Th>
                  <Th>Actions</Th>
                  <Th>AWB Number</Th>
                  <Th>Airline</Th>
                  <Th>Client</Th>
                  <Th>Origin</Th>
                  <Th>Destination</Th>
                  <Th className="text-right">Pieces</Th>
                  <Th className="text-right">Weight (KGS)</Th>
                  {!isDataEntry && <Th className="text-right">USD Rate</Th>}
                  {!isDataEntry && <Th className="text-right">Net Rate (PKR/kg)</Th>}
                  {!isDataEntry && <Th className="text-right">Freight Amount (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">CASS Rate (USD/kg)</Th>}
                  {!isDataEntry && <Th className="text-right">CASS Freight Total (PKR)</Th>}
                  {!isDataEntry && <Th>Clearing Agent</Th>}
                  {!isDataEntry && <Th className="text-right">Clearing Charges (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">IDC Tax (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">Other Charges (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">AWB Fixed Fee (PKR)</Th>}
                  {!isDataEntry && <Th>Sales Agent</Th>}
                  {!isDataEntry && <Th className="text-right">SA Commission (PKR/kg)</Th>}
                  {!isDataEntry && <Th className="text-right">SA Commission Amt (PKR)</Th>}
                  {!isDataEntry && <Th>Form E Supplier</Th>}
                  {!isDataEntry && <Th className="text-right">Form E USD Value</Th>}
                  {!isDataEntry && <Th className="text-right">Form E Rate Receivable</Th>}
                  {!isDataEntry && <Th className="text-right">Form E Rate Payable</Th>}
                  {!isDataEntry && <Th className="text-right">Form E Amount (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">Total Receivable (PKR)</Th>}
                  <Th>Status</Th>
                  <Th>Notes</Th>
                </tr>
              </Thead>
              <Tbody>
                {paginated.map((s) => {
                  const saCommissionAmt = Number(s.chargeable_weight || 0) * Number(s.sales_agent_commission_per_kg || 0)
                  return (
                  <Tr key={s.id} className={STATUS_ROW[s.status] ?? ''}>
                    <Td>
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleRow(s.id)}
                        className="w-4 h-4 accent-navy cursor-pointer" />
                    </Td>
                    <EditableCell type="date" value={s.flight_date}
                      display={<span className="whitespace-nowrap">{fmtDate(s.flight_date)}</span>}
                      onSave={(v) => updateField(s.id, 'flight_date', v)} />
                    <Td>
                      <div className="flex gap-1">
                        <button title="Edit"
                          onClick={() => setFormModal({ mode: 'edit', shipment: s })}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-navy transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button title="Delete"
                          onClick={() => setDeleteId(s.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-danger transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {!isDataEntry && (
                          <button title="Generate Invoice"
                            onClick={() => navigate('/invoices', { state: { shipmentId: s.id } })}
                            className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-accent transition-colors">
                            <FileText className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </Td>
                    <EditableCell type="text" value={s.awb_number}
                      display={<span className="font-mono font-semibold text-navy whitespace-nowrap">{s.awb_number}</span>}
                      onSave={(v) => updateField(s.id, 'awb_number', v)} />
                    <EditableCell type="select" value={s.airline_id} options={airlineOptions}
                      display={<span className="whitespace-nowrap">{s.airlines?.name ?? '—'}</span>}
                      onSave={(v) => updateField(s.id, 'airline_id', v)} />
                    <EditableCell type="select" value={s.client_id} options={clientOptions}
                      display={<span className="whitespace-nowrap">{s.clients?.name ?? '—'}</span>}
                      onSave={(v) => updateField(s.id, 'client_id', v)} />
                    <EditableCell type="select" value={s.origin} options={originOptions}
                      display={<span className="font-mono text-xs tracking-wider">{s.origin}</span>}
                      onSave={(v) => updateField(s.id, 'origin', v)} />
                    <EditableCell type="select" value={s.destination} options={destinationOptions}
                      display={<span className="font-mono text-xs tracking-wider">{s.destination}</span>}
                      onSave={(v) => updateField(s.id, 'destination', v)} />
                    <EditableCell type="number" align="right" value={s.pieces} display={s.pieces}
                      onSave={(v) => updateField(s.id, 'pieces', v)} />
                    <EditableCell type="number" step="0.001" align="right" value={s.chargeable_weight}
                      display={Number(s.chargeable_weight || 0).toFixed(3)}
                      onSave={(v) => updateField(s.id, 'chargeable_weight', v)} />
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.pkr_exchange_rate}
                        display={fmt(s.pkr_exchange_rate)}
                        onSave={(v) => updateField(s.id, 'pkr_exchange_rate', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.0001" align="right" value={s.net_rate}
                        display={fmt(s.net_rate)}
                        onSave={(v) => updateField(s.id, 'net_rate', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell disabled align="right" display={`PKR ${fmt(s.freight_amount)}`} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.0001" align="right" value={s.cass_airline_rate}
                        display={fmtRate(s.cass_airline_rate)}
                        onSave={(v) => updateField(s.id, 'cass_airline_rate', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell disabled align="right" display={`PKR ${fmt(s.cass_freight_total)}`} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="select" value={s.clearing_agent_id} options={clearingAgentOptions}
                        display={<span className="whitespace-nowrap">{s.clearing_agents?.name ?? '—'}</span>}
                        onSave={(v) => updateField(s.id, 'clearing_agent_id', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.clearing_charges}
                        display={fmt(s.clearing_charges)}
                        onSave={(v) => updateField(s.id, 'clearing_charges', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.idc_tax}
                        display={fmt(s.idc_tax)}
                        onSave={(v) => updateField(s.id, 'idc_tax', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.other_charges_due_airline}
                        display={fmt(s.other_charges_due_airline)}
                        onSave={(v) => updateField(s.id, 'other_charges_due_airline', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.awb_fixed_fee}
                        display={fmt(s.awb_fixed_fee)}
                        onSave={(v) => updateField(s.id, 'awb_fixed_fee', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="select" value={s.sales_agent_id} options={salesAgentOptions}
                        display={<span className="whitespace-nowrap">{s.sales_agents?.name ?? '—'}</span>}
                        onSave={(v) => updateField(s.id, 'sales_agent_id', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.sales_agent_commission_per_kg}
                        display={fmt(s.sales_agent_commission_per_kg)}
                        onSave={(v) => updateField(s.id, 'sales_agent_commission_per_kg', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell disabled align="right" display={fmt(saCommissionAmt)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="select" value={s.form_e_supplier_id} options={formESupplierOptions}
                        display={<span className="whitespace-nowrap">{s.form_e_suppliers?.name ?? '—'}</span>}
                        onSave={(v) => updateField(s.id, 'form_e_supplier_id', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.form_e_usd_value}
                        display={fmt(s.form_e_usd_value)}
                        onSave={(v) => updateField(s.id, 'form_e_usd_value', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.form_e_pkr_rate}
                        display={fmt(s.form_e_pkr_rate)}
                        onSave={(v) => updateField(s.id, 'form_e_pkr_rate', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.form_e_pkr_rate_payable}
                        display={fmt(s.form_e_pkr_rate_payable)}
                        onSave={(v) => updateField(s.id, 'form_e_pkr_rate_payable', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell disabled align="right" display={`PKR ${fmt(s.form_e_amount_pkr)}`} />
                    )}
                    {!isDataEntry && (
                      <EditableCell disabled align="right"
                        display={<span className="font-semibold text-gray-800">PKR {fmt(s.total_receivable)}</span>} />
                    )}
                    <EditableCell type="select" value={s.status} options={statusOptions}
                      display={
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_BADGE[s.status] ?? ''}`}>
                          {s.status}
                        </span>
                      }
                      onSave={(v) => updateField(s.id, 'status', v)} />
                    <EditableCell type="text" value={s.notes ?? ''} display={s.notes || '—'}
                      onSave={(v) => updateField(s.id, 'notes', v)} />
                  </Tr>
                  )
                })}
              </Tbody>
              <Tfoot>
                <tr>
                  <td />
                  <Td />
                  {/* Actions, AWB, Airline, Client, Origin, Destination, Pieces */}
                  <Td /><Td /><Td /><Td /><Td /><Td /><Td />
                  <Td />
                  {!isDataEntry && Array.from({ length: 18 }).map((_, i) => <Td key={i} />)}
                  {!isDataEntry && (
                    <Td className="text-right font-mono font-semibold text-navy whitespace-nowrap">
                      PKR {fmt(totals.totalReceivable)}
                    </Td>
                  )}
                  <Td /><Td />
                </tr>
              </Tfoot>
            </Table>
          )}
          {!loading && !error && filtered.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 text-sm text-gray-600">
              <span>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="w-4 h-4" />Previous
                </Button>
                <span className="text-xs text-gray-500 whitespace-nowrap">Page {currentPage} of {totalPages}</span>
                <Button size="sm" variant="secondary" disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next<ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Add / Edit modal */}
      {formModal && (
        <ShipmentFormModal
          mode={formModal.mode}
          shipment={formModal.shipment}
          airlines={airlines}
          clients={clients}
          clearingAgents={clearingAgents}
          formESuppliers={formESuppliers}
          salesAgents={salesAgents}
          idcTaxRate={idcTaxRate}
          fixedUsdRate={fixedUsdRate}
          onSave={handleSave}
          onClose={() => setFormModal(null)}
          saving={saving}
        />
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Shipment"
          message="This shipment will be permanently deleted. Any linked invoice data is kept."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {bulkDeleting && (
        <ConfirmDialog
          title="Delete Shipments"
          message={`${selected.size} shipment${selected.size !== 1 ? 's' : ''} will be permanently deleted. Any linked invoice data is kept.`}
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleting(false)}
        />
      )}

      {showImport && (
        <ShipmentImportModal
          airlines={airlines}
          clients={clients}
          onImported={() => { loadAll() }}
          onClose={() => setShowImport(false)}
        />
      )}
    </>
  )
}
