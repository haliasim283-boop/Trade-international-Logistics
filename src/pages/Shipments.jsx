import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Download, Pencil, Trash2, FileText, Upload, MessageSquare, ChevronLeft, ChevronRight, Copy, Check, Bell } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { Table, Thead, Th, Tbody, Tr, Td, Tfoot } from '../components/ui/Table'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { ShipmentFormModal } from '../components/shipments/ShipmentFormModal'
import { ShipmentImportModal } from '../components/shipments/ShipmentImportModal'
import { buildBookingMessage, buildBookingPdfFile, COMMODITY_OPTIONS, AIRCRAFT_OPTIONS } from '../components/shipments/ShipmentBookingPrint'
import notificationSoundUrl from '../../notify.mp3'

const SHIPMENT_SELECT = '*, airlines(name, iata_prefix), clients(name, phone), clearing_agents(name, origin_code), form_e_suppliers(name), sales_agents(name)'

const ORIGINS      = ['PEW','ISB','MUX','SKT','LHE','KHI']
const DESTINATIONS = ['DXB','DOH','AUH','SHJ','BAH','JED','MCT','AAN','KWI','RUH','RKT','MAN','YYZ','LHR']

const FLOAT_FIELDS = new Set([
  'chargeable_weight', 'net_rate', 'pkr_exchange_rate', 'clearing_charges', 'idc_tax',
  'other_charges_due_airline', 'awb_fixed_fee', 'cass_airline_rate',
  'sales_agent_commission_per_kg', 'form_e_usd_value', 'form_e_pkr_rate', 'form_e_pkr_rate_payable',
])
const INT_FIELDS      = new Set(['pieces'])
const NULLABLE_FIELDS = new Set(['clearing_agent_id', 'form_e_supplier_id', 'sales_agent_id'])

function playShipmentAddedSound() {
  try {
    const audio = new Audio(notificationSoundUrl)
    audio.volume = 0.7
    audio.play().catch(() => {})
  } catch {
    return
  }
}

function coerceField(field, raw) {
  if (FLOAT_FIELDS.has(field)) return parseFloat(raw) || 0
  if (INT_FIELDS.has(field))   return parseInt(raw) || 1
  if (NULLABLE_FIELDS.has(field)) return raw || null
  if (field === 'destination' || field === 'origin') return raw.toUpperCase().slice(0, 3)
  return raw
}

const PAGE_SIZE = 50   // rows shown per page (first batch fetched immediately)
const BG_BATCH  = 500  // batch size for background prefetch

// Build a base Supabase query with all active filters applied (no range).
function buildShipmentsQuery({ search, filterAirline, filterClient, filterStatus, filterOrigin, filterFormE, filterFrom, filterTo, sortDateOrder = 'desc' }, { count } = {}) {
  let query = supabase
    .from('shipments')
    .select(SHIPMENT_SELECT, count ? { count: 'exact' } : undefined)
    .order('flight_date', { ascending: sortDateOrder === 'asc' })
    .order('created_at',  { ascending: sortDateOrder === 'asc' })

  if (filterAirline) query = query.eq('airline_id', filterAirline)
  if (filterClient)  query = query.eq('client_id', filterClient)
  if (filterStatus)  query = query.eq('status', filterStatus)
  if (filterOrigin)  query = query.eq('origin', filterOrigin)
  if (filterFormE === 'none') query = query.is('form_e_supplier_id', null)
  else if (filterFormE) query = query.eq('form_e_supplier_id', filterFormE)
  if (filterFrom) query = query.gte('flight_date', filterFrom)
  if (filterTo)   query = query.lte('flight_date', filterTo)
  if (search)     query = query.ilike('awb_number', `%${search}%`)

  return query
}

// Fetch the first PAGE_SIZE rows and total count — shown immediately on open.
async function fetchShipmentsFirstPage(filters) {
  const { data, count, error } = await buildShipmentsQuery(filters, { count: true })
    .range(0, PAGE_SIZE - 1)
  return { data: data ?? [], count: count ?? 0, error }
}

// Fetch every shipment AFTER the first page, in large batches, calling
// onBatch(rows) as each batch arrives. Stops early if isCancelled() returns true.
async function fetchShipmentsBackground(filters, totalCount, onBatch, isCancelled) {
  let offset = PAGE_SIZE
  while (offset < totalCount) {
    if (isCancelled()) return
    const { data, error } = await buildShipmentsQuery(filters)
      .range(offset, offset + BG_BATCH - 1)
    if (isCancelled()) return
    if (error || !data?.length) break
    onBatch(data)
    offset += BG_BATCH
  }
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
  'AP-BLZ':    'bg-amber-100/80',
  'BKD':       'bg-blue-100/80',
  'CNCLD':     'bg-red-100/80',
  'NO SHOW':   'bg-orange-100/80',
  'OFFLOADED': 'bg-purple-100/80',
  'SHPD':      'bg-green-100/80',
  'FBL':       'bg-emerald-100/80',
  'EMAILED':   'bg-teal-100/80',
}

const STATUS_BADGE = {
  'PNDNG':     'bg-gray-100 text-gray-600',
  'AP-BLZ':    'bg-amber-100 text-amber-700',
  'BKD':       'bg-blue-100 text-blue-700',
  'CNCLD':     'bg-red-100 text-red-700',
  'NO SHOW':   'bg-orange-100 text-orange-700',
  'OFFLOADED': 'bg-purple-100 text-purple-700',
  'SHPD':      'bg-green-100 text-green-700',
  'FBL':       'bg-emerald-100 text-emerald-700',
  'EMAILED':   'bg-teal-100 text-teal-700',
}

const STATUSES = ['PNDNG', 'AP-BLZ', 'BKD', 'CNCLD', 'NO SHOW', 'OFFLOADED', 'SHPD', 'FBL', 'EMAILED']

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

function r2(n) { return Math.round(Number(n || 0) * 100) / 100 }

// Shared field styling for the "Share booking confirmation" modal — keeps every
// input, select and label the same height so the two columns line up.
// SHARE_FIELD carries no width class — callers add their own (w-full, flex-1,
// w-24). Baking w-full in here would beat any width the caller sets, since
// Tailwind emits w-full after w-24 regardless of class order in the string.
const SHARE_LABEL = 'mb-1 block font-medium text-gray-700'
const SHARE_FIELD = 'min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm ' +
                    'focus:outline-none focus:ring-2 focus:ring-accent'
const SHARE_INP   = `w-full ${SHARE_FIELD}`

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
  const [totalRows,      setTotalRows]      = useState(0)
  const [allLoaded,      setAllLoaded]      = useState(false)  // true once background fetch completes
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState(null)
  const [saving,         setSaving]         = useState(false)
  const [successNotice,  setSuccessNotice] = useState(null)

  // Incremented every time filters/sort change — used to cancel stale background fetches.
  const fetchKeyRef = useRef(0)

  // ── Modal state ──
  const [formModal,   setFormModal]   = useState(null)   // { mode, shipment? }
  const [deleteId,    setDeleteId]    = useState(null)
  const [showImport,  setShowImport]  = useState(false)
  const [shareModal,  setShareModal]  = useState(null) // shipment to share
  const [shareDetails, setShareDetails] = useState({
    flightNumber: '',
    aircraft: '',
    departureTime: '',
    departurePeriod: 'AM',
    arrivalTime: '',
    arrivalPeriod: 'AM',
    commodity: 'FRESH MEAT',
  })
  const [sharing,     setSharing]     = useState(false)
  const [pdfHint,     setPdfHint]     = useState(null)   // file name to attach in WhatsApp Web
  const [copied,      setCopied]      = useState(false)  // "Copied!" feedback on the copy button

  // ── Filter state ──
  const [search,        setSearch]        = useState('')
  const [filterAirline, setFilterAirline] = useState('')
  const [filterClient,  setFilterClient]  = useState('')
  const location = useLocation()
  const [filterStatus,  setFilterStatus]  = useState(location.state?.status ?? '')
  const [filterOrigin,  setFilterOrigin]  = useState('')
  const [filterFormE,   setFilterFormE]   = useState('')   // '' = all, 'none' = no supplier
  const [filterFrom,    setFilterFrom]    = useState('')
  const [filterTo,      setFilterTo]      = useState('')
  const [sortDateOrder, setSortDateOrder] = useState('desc')

  // ── Pagination state ──
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!successNotice) return undefined
    const timer = setTimeout(() => setSuccessNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [successNotice])


  // ── Load ────────────────────────────────────────────────────────────────

  const filters = useMemo(() => ({
    search, filterAirline, filterClient, filterStatus,
    filterOrigin, filterFormE, filterFrom, filterTo, sortDateOrder,
  }), [search, filterAirline, filterClient, filterStatus, filterOrigin, filterFormE, filterFrom, filterTo, sortDateOrder])

  const loadAll = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('Supabase not configured'); return }

    // Bump the fetch key so any in-flight background fetch from a previous
    // filter set knows to abort.
    const myKey = ++fetchKeyRef.current

    setLoading(true); setError(null); setAllLoaded(false)

    const [
      shipmentsPage,
      { data: aData },
      { data: cData },
      { data: caData },
      { data: feData },
      { data: settData },
      { data: saData },
    ] = await Promise.all([
      fetchShipmentsFirstPage(filters),
      supabase.from('airlines').select('*').eq('is_active', true).order('name'),
      supabase.from('clients').select('id, name').eq('is_active', true).order('name'),
      supabase.from('clearing_agents').select('*').eq('is_active', true).order('city'),
      supabase.from('form_e_suppliers').select('id, name').eq('is_active', true).order('name'),
      supabase.from('company_settings').select('*').eq('id', 1).single(),
      supabase.from('sales_agents').select('id, name, commission_pkr_per_kg').eq('is_active', true).order('name'),
    ])

    if (fetchKeyRef.current !== myKey) return  // filters changed while we were loading

    if (shipmentsPage.error) {
      setError(shipmentsPage.error.message)
      setLoading(false)
      return
    }

    const totalCount = shipmentsPage.count ?? 0
    setShipments(shipmentsPage.data ?? [])
    setTotalRows(totalCount)
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

    setLoading(false)

    // ── Background prefetch: fetch remaining rows silently so that pagination
    //    never needs to hit the network again.
    if (totalCount > PAGE_SIZE) {
      fetchShipmentsBackground(
        filters,
        totalCount,
        (batch) => {
          if (fetchKeyRef.current !== myKey) return  // stale, discard
          setShipments((prev) => {
            // Avoid duplicates by keying on id.
            const ids = new Set(prev.map((s) => s.id))
            return [...prev, ...batch.filter((s) => !ids.has(s.id))]
          })
        },
        () => fetchKeyRef.current !== myKey,  // isCancelled
      ).then(() => {
        if (fetchKeyRef.current === myKey) setAllLoaded(true)
      })
    } else {
      setAllLoaded(true)
    }
  }, [filters])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Filtered list ────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const list = shipments.filter((s) => {
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
      if (filterFormE === 'none') { if (s.form_e_supplier_id) return false }
      else if (filterFormE && s.form_e_supplier_id !== filterFormE) return false
      if (filterFrom    && s.flight_date < filterFrom) return false
      if (filterTo      && s.flight_date > filterTo)   return false
      return true
    })

    return [...list].sort((a, b) => {
      const da = a.flight_date || ''
      const db = b.flight_date || ''
      if (da === db) {
        return sortDateOrder === 'asc'
          ? (a.created_at || '').localeCompare(b.created_at || '')
          : (b.created_at || '').localeCompare(a.created_at || '')
      }
      return sortDateOrder === 'asc' ? da.localeCompare(db) : db.localeCompare(da)
    })
  }, [shipments, search, filterAirline, filterClient, filterStatus, filterOrigin, filterFormE, filterFrom, filterTo, sortDateOrder])

  // Reset to page 1 whenever filters/sort change
  useEffect(() => { setPage(1) }, [search, filterAirline, filterClient, filterStatus, filterOrigin, filterFormE, filterFrom, filterTo, sortDateOrder])

  // Client-side pagination over the fully-filtered list.
  const totalPages   = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage  = Math.min(page, totalPages)
  const paginated    = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  )

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
    if (formModal.mode === 'add') {
      setSuccessNotice('Shipment added successfully')
      playShipmentAddedSound()
    }
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
  function createWhatsAppUrl(shipment) {
    const message = buildBookingMessage(shipment, shipment.clients, shareDetails)
    const encoded = encodeURIComponent(message)
    return `https://web.whatsapp.com/send?text=${encoded}`
  }

  async function handleDownloadBookingPdf(shipment) {
    setSharing(true)
    try {
      const { pdf, name } = await buildBookingPdfFile(shipment, shipment.clients, shareDetails)
      pdf.save(name)
    } catch (err) {
      alert('Could not generate booking PDF: ' + err.message)
    } finally {
      setSharing(false)
    }
  }

  /**
   * Send the airway-bill PDF through WhatsApp Web: build the PDF, save it, and
   * open the WhatsApp Web chat pre-filled with the booking text. WhatsApp Web
   * has no API for attaching a file from another site, so the last step —
   * dragging/attaching the saved PDF — stays with the user.
   */
  async function handleSendPdfWhatsApp(shipment) {
    setSharing(true)
    try {
      const { pdf, name } = await buildBookingPdfFile(shipment, shipment.clients, shareDetails)
      pdf.save(name)
      window.open(createWhatsAppUrl(shipment), '_blank')
      setPdfHint(name)
    } catch (err) {
      alert('Could not generate booking PDF: ' + err.message)
    } finally {
      setSharing(false)
    }
  }

  function handleSendWhatsApp(shipment) {
    const url = createWhatsAppUrl(shipment)
    window.open(url, '_blank')
  }

  function openShareModal(shipment) {
    setShareModal(shipment)
    setShareDetails({
      flightNumber: '',
      aircraft: '',
      departureTime: '',
      departurePeriod: 'AM',
      arrivalTime: '',
      arrivalPeriod: 'AM',
      commodity: COMMODITY_OPTIONS.some((o) => o.value === String(shipment?.commodity ?? '').trim().toUpperCase())
        ? String(shipment.commodity).trim().toUpperCase()
        : 'FRESH MEAT',
    })
    setPdfHint(null)
    setCopied(false)
  }

  /**
   * Copy the booking text to the clipboard. navigator.clipboard needs a secure
   * context (https or localhost); fall back to a hidden textarea + execCommand
   * so this still works if the app is served over plain http on the LAN.
   */
  async function handleCopyMessage(shipment) {
    const message = buildBookingMessage(shipment, shipment.clients, shareDetails)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message)
      } else {
        const ta = document.createElement('textarea')
        ta.value = message
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      alert('Could not copy the message: ' + err.message)
    }
  }

  function updateShareDetail(key, value) {
    setShareDetails((prev) => ({ ...prev, [key]: value }))
  }

  // ── Filter helpers ───────────────────────────────────────────────────────

  const hasFilters = search || filterAirline || filterClient || filterStatus || filterOrigin || filterFormE || filterFrom || filterTo || sortDateOrder !== 'desc'
  const INP_F = 'shrink-0 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white'

  function clearFilters() {
    setSearch(''); setFilterAirline(''); setFilterClient('')
    setFilterStatus(''); setFilterOrigin(''); setFilterFormE(''); setFilterFrom(''); setFilterTo('')
    setSortDateOrder('desc')
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {successNotice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg"
        >
          <Bell className="h-4 w-4" />
          {successNotice}
          <button
            type="button"
            className="ml-2 text-lg leading-none text-white/80 hover:text-white"
            aria-label="Dismiss notification"
            onClick={() => setSuccessNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      <div className="p-4 sm:p-6 space-y-5">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-navy tracking-tight">Master Shipment Log</h1>
            <p className="text-sm text-gray-500 mt-0.5">All shipments — the source of truth for all reports.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              name="search"
              className={INP_F}
              style={{ minWidth: 200 }}
              placeholder="Search AWB or client…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
          <CardBody className="py-3">
            {/* Wraps onto extra rows instead of scrolling sideways — with eight
                controls the single nowrap row clipped the last of them. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {/* Sort by Date */}
              <select
                name="sort_date"
                className={INP_F}
                value={sortDateOrder}
                onChange={(e) => setSortDateOrder(e.target.value)}
                title="Sort by date"
              >
                <option value="desc">Sort by Date: Descending</option>
                <option value="asc">Sort by Date: Ascending</option>
              </select>

              {/* Fortnight shortcut */}
              <select name="fortnight" className={INP_F} onChange={applyFortnight}
                value={fortnights.find((f) => f.from === filterFrom && f.to === filterTo)?.key ?? ''}>
                <option value="">Fortnight…</option>
                {fortnights.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>


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

              {!isDataEntry && (
                <select name="filter_form_e" className={INP_F} value={filterFormE}
                  onChange={(e) => setFilterFormE(e.target.value)} title="Filter by Form E supplier">
                  <option value="">All Form E suppliers</option>
                  <option value="none">— No Form E supplier —</option>
                  {formESuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}

              {hasFilters && (
                <button onClick={clearFilters} className="shrink-0 ml-1 px-1 text-xs font-medium text-accent hover:underline whitespace-nowrap">
                  Clear filters
                </button>
              )}

            </div>
          </CardBody>
        </Card>


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
                  <Th>Actions</Th>
                  <Th>Date</Th>
                  <Th>AWB Number</Th>
                  <Th>Status</Th>
                  <Th>Client</Th>
                  <Th>Origin</Th>
                  <Th>Destination</Th>
                  <Th className="text-right">Pieces</Th>
                  <Th className="text-right">Weight (KGS)</Th>
                  {!isDataEntry && <Th className="text-right">Net Rate (PKR/kg)</Th>}
                  {!isDataEntry && <Th className="text-right">Other Charges (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">Freight Amount (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">CASS Rate (USD/kg)</Th>}
                  {!isDataEntry && <Th className="text-right">CASS Freight Total (PKR)</Th>}
                  {!isDataEntry && <Th>Clearing Agent</Th>}
                  {!isDataEntry && <Th className="text-right">Clearing Charges (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">IDC Tax (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">USD Rate</Th>}
                  {!isDataEntry && <Th className="text-right">AWB Fixed Fee (PKR)</Th>}
                  {!isDataEntry && <Th>Sales Agent</Th>}
                  {!isDataEntry && <Th className="text-right">SA Commission (PKR/kg)</Th>}
                  {!isDataEntry && <Th className="text-right">SA Commission Amt (PKR)</Th>}
                  {!isDataEntry && <Th>Form E Supplier</Th>}
                  {!isDataEntry && <Th className="text-right">Form E USD Rate (per kg)</Th>}
                  {!isDataEntry && <Th className="text-right">Form E USD Value</Th>}
                  {!isDataEntry && <Th className="text-right">Form E Rate Receivable</Th>}
                  {!isDataEntry && <Th className="text-right">Form E Rate Payable</Th>}
                  {!isDataEntry && <Th className="text-right">Form E Amount (PKR)</Th>}
                  {!isDataEntry && <Th className="text-right">Total Receivable (PKR)</Th>}
                  <Th>Airline</Th>
                  <Th>Notes</Th>
                </tr>
              </Thead>
              <Tbody>
                {paginated.map((s) => {
                  const saCommissionAmt = Number(s.chargeable_weight || 0) * Number(s.sales_agent_commission_per_kg || 0)
                  // form_e_usd_value stores the TOTAL USD; the editable cell works in USD per kg.
                  const formEUsdPerKg = Number(s.chargeable_weight || 0) > 0
                    ? r2(Number(s.form_e_usd_value || 0) / Number(s.chargeable_weight))
                    : Number(s.form_e_usd_value || 0)
                  return (
                  <Tr key={s.id} className={STATUS_ROW[s.status] ?? ''}>
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
                          <>
                            <button title="Share booking"
                              onClick={() => openShareModal(s)}
                              className="p-1.5 rounded hover:bg-green-50 text-gray-500 hover:text-success transition-colors">
                              <MessageSquare className="w-4 h-4" />
                            </button>
                            <button title="Generate Invoice"
                              onClick={() => navigate('/invoices', { state: { shipmentId: s.id } })}
                              className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-accent transition-colors">
                              <FileText className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </Td>
                    <EditableCell type="date" value={s.flight_date}
                      display={<span className="whitespace-nowrap">{fmtDate(s.flight_date)}</span>}
                      onSave={(v) => updateField(s.id, 'flight_date', v)} />
                    <EditableCell type="text" value={s.awb_number}
                      display={<span className="font-mono font-semibold text-navy whitespace-nowrap">{s.awb_number}</span>}
                      onSave={(v) => updateField(s.id, 'awb_number', v)} />
                    <EditableCell type="select" value={s.status} options={statusOptions}
                      display={
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_BADGE[s.status] ?? ''}`}>
                          {s.status}
                        </span>
                      }
                      onSave={(v) => updateField(s.id, 'status', v)} />
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
                      <EditableCell type="number" step="0.0001" align="right" value={s.net_rate}
                        display={fmt(s.net_rate)}
                        onSave={(v) => updateField(s.id, 'net_rate', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell type="number" step="0.01" align="right" value={s.other_charges_due_airline}
                        display={fmt(s.other_charges_due_airline)}
                        onSave={(v) => updateField(s.id, 'other_charges_due_airline', v)} />
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
                      <EditableCell type="number" step="0.01" align="right" value={s.pkr_exchange_rate}
                        display={fmt(s.pkr_exchange_rate)}
                        onSave={(v) => updateField(s.id, 'pkr_exchange_rate', v)} />
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
                      <EditableCell type="number" step="0.01" align="right" value={formEUsdPerKg}
                        display={fmt(formEUsdPerKg)}
                        onSave={(v) => updateField(s.id, 'form_e_usd_value', v)} />
                    )}
                    {!isDataEntry && (
                      <EditableCell disabled align="right" display={`$ ${fmt(s.form_e_usd_value)}`} />
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
                    <EditableCell type="select" value={s.airline_id} options={airlineOptions}
                      display={<span className="whitespace-nowrap">{s.airlines?.name ?? '—'}</span>}
                      onSave={(v) => updateField(s.id, 'airline_id', v)} />
                    <EditableCell type="text" value={s.notes ?? ''} display={s.notes || '—'}
                      onSave={(v) => updateField(s.id, 'notes', v)} />
                  </Tr>
                  )
                })}
              </Tbody>
              <Tfoot>
                <tr>
                  <Td />
                  {/* Date, AWB, Status, Client, Origin, Destination, Pieces */}
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
              <span className="flex items-center gap-2">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
                {!allLoaded && (
                  <span className="text-xs text-gray-400 italic">— loading remaining rows…</span>
                )}
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


      {showImport && (
        <ShipmentImportModal
          airlines={airlines}
          clients={clients}
          onImported={() => { loadAll() }}
          onClose={() => setShowImport(false)}
        />
      )}

      {shareModal && (
        <Modal title="Share booking confirmation" onClose={() => setShareModal(null)} size="lg">
          <div className="space-y-5">
            <div className="text-sm text-gray-600">
              Send this booking confirmation to <strong>{shareModal.clients?.name ?? 'client'}</strong>.
            </div>

            {/* One flat 2-column grid so every field sits on a shared row
                baseline: Flight/Departure, Aircraft/Arrival, Commodity. */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <label className="block text-sm min-w-0">
                <span className={SHARE_LABEL}>Flight number</span>
                <input
                  value={shareDetails.flightNumber}
                  onChange={(e) => updateShareDetail('flightNumber', e.target.value)}
                  className={SHARE_INP}
                  placeholder="PK-257"
                />
              </label>

              <div className="text-sm min-w-0">
                <div className={SHARE_LABEL}>Departure</div>
                <div className="flex items-center gap-2">
                  <input
                    value={shareDetails.departureTime}
                    onChange={(e) => updateShareDetail('departureTime', e.target.value)}
                    className={`flex-1 ${SHARE_FIELD}`}
                    placeholder="1:10"
                  />
                  <select
                    value={shareDetails.departurePeriod}
                    onChange={(e) => updateShareDetail('departurePeriod', e.target.value)}
                    className={`w-24 shrink-0 ${SHARE_FIELD}`}
                  >
                    <option>AM</option>
                    <option>PM</option>
                  </select>
                </div>
              </div>

              <label className="block text-sm min-w-0">
                <span className={SHARE_LABEL}>Aircraft</span>
                <select
                  value={shareDetails.aircraft}
                  onChange={(e) => updateShareDetail('aircraft', e.target.value)}
                  className={SHARE_INP}
                >
                  <option value="">— None —</option>
                  {AIRCRAFT_OPTIONS.map((reg) => (
                    <option key={reg} value={reg}>{reg}</option>
                  ))}
                </select>
              </label>

              <div className="text-sm min-w-0">
                <div className={SHARE_LABEL}>Arrival</div>
                <div className="flex items-center gap-2">
                  <input
                    value={shareDetails.arrivalTime}
                    onChange={(e) => updateShareDetail('arrivalTime', e.target.value)}
                    className={`flex-1 ${SHARE_FIELD}`}
                    placeholder="4:00"
                  />
                  <select
                    value={shareDetails.arrivalPeriod}
                    onChange={(e) => updateShareDetail('arrivalPeriod', e.target.value)}
                    className={`w-24 shrink-0 ${SHARE_FIELD}`}
                  >
                    <option>AM</option>
                    <option>PM</option>
                  </select>
                </div>
              </div>

              <label className="block text-sm min-w-0">
                <span className={SHARE_LABEL}>Commodity</span>
                <select
                  value={shareDetails.commodity}
                  onChange={(e) => updateShareDetail('commodity', e.target.value)}
                  className={SHARE_INP}
                >
                  {COMMODITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.emoji} {opt.value}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="text-xs text-gray-500">
              Reporting time is calculated automatically as 8 hours before departure. Enter the booking details above and then send the message.
            </div>

            <button
              onClick={() => handleCopyMessage(shareModal)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {copied
                ? <><Check className="w-4 h-4 text-green-600" /> Copied!</>
                : <><Copy className="w-4 h-4" /> Copy text message</>}
            </button>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                onClick={() => handleSendWhatsApp(shareModal)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-white px-4 py-3 text-sm font-semibold text-green-700 hover:bg-green-50 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                Send WhatsApp text
              </button>
              <button
                onClick={() => handleSendPdfWhatsApp(shareModal)}
                disabled={sharing}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy text-white px-4 py-3 text-sm font-semibold hover:bg-navy-light transition-colors disabled:opacity-60"
              >
                <FileText className="w-4 h-4" />
                {sharing ? 'Preparing PDF…' : 'Send PDF on WhatsApp'}
              </button>
            </div>

            {pdfHint && (
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-xs text-green-900 leading-relaxed">
                <strong>{pdfHint}</strong> was downloaded and WhatsApp Web is open in a new tab.
                Pick the chat, then attach the file with the 📎 button (or just drag it into the chat) and send.
                WhatsApp Web does not let another site attach files for you, so this last step is manual.
              </div>
            )}

            <button
              onClick={() => handleDownloadBookingPdf(shareModal)}
              disabled={sharing}
              className="w-full text-center text-xs font-medium text-gray-500 underline underline-offset-4 hover:text-gray-700 disabled:opacity-60"
            >
              Just download the PDF
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
