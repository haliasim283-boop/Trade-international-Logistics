import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Download, Pencil, Trash2, FileText, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { Table, Thead, Th, Tbody, Tr, Td, Tfoot } from '../components/ui/Table'
import { ConfirmDialog } from '../components/ui/Modal'
import { ShipmentFormModal } from '../components/shipments/ShipmentFormModal'
import { ShipmentImportModal } from '../components/shipments/ShipmentImportModal'

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_ROW = {
  'PNDNG':     '',
  'AP-BLZ':    'bg-amber-50',
  'BKD':       'bg-blue-50/60',
  'CNCLD':     'bg-red-50',
  'NO SHOW':   'bg-orange-50',
  'OFFLOADED': 'bg-purple-50',
  'SHPD':      'bg-green-50',
}

const STATUS_BADGE = {
  'PNDNG':     'bg-gray-100 text-gray-600',
  'AP-BLZ':    'bg-amber-100 text-amber-700',
  'BKD':       'bg-blue-100 text-blue-700',
  'CNCLD':     'bg-red-100 text-red-700',
  'NO SHOW':   'bg-orange-100 text-orange-700',
  'OFFLOADED': 'bg-purple-100 text-purple-700',
  'SHPD':      'bg-green-100 text-green-700',
}

const STATUSES = ['PNDNG', 'AP-BLZ', 'BKD', 'CNCLD', 'NO SHOW', 'OFFLOADED', 'SHPD']

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
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
    ['Other Charges',   (r) => r.other_charges],
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

  // ── Data state ──
  const [shipments,      setShipments]      = useState([])
  const [airlines,       setAirlines]       = useState([])
  const [clients,        setClients]        = useState([])
  const [clearingAgents, setClearingAgents] = useState([])
  const [formESuppliers, setFormESuppliers] = useState([])
  const [salesAgents,    setSalesAgents]    = useState([])
  const [idcTaxRate,     setIdcTaxRate]     = useState(0)
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

  // ── Bulk action state ──
  const [selected,   setSelected]   = useState(new Set())
  const [bulkStatus, setBulkStatus] = useState('SHPD')

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
      supabase
        .from('shipments')
        .select('*, airlines(name, iata_prefix), clients(name), clearing_agents(name), form_e_suppliers(name)')
        .order('flight_date', { ascending: false })
        .order('created_at',  { ascending: false }),
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
    if (filterOrigin  && s.origin     !== filterOrigin.toUpperCase()) return false
    if (filterFrom    && s.flight_date < filterFrom) return false
    if (filterTo      && s.flight_date > filterTo)   return false
    return true
  }), [shipments, search, filterAirline, filterClient, filterStatus, filterOrigin, filterFrom, filterTo])

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
    count:           filtered.length,
    totalWeight:     filtered.reduce((s, r) => s + parseFloat(r.chargeable_weight || 0), 0),
    totalReceivable: filtered.reduce((s, r) => s + parseFloat(r.total_receivable || 0), 0),
  }), [filtered])

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

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async function handleSave(payload) {
    setSaving(true)
    const { error } = formModal.mode === 'add'
      ? await supabase.from('shipments').insert(payload)
      : await supabase.from('shipments').update(payload).eq('id', formModal.shipment.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    setFormModal(null)
    loadAll()
  }

  async function handleDelete() {
    await supabase.from('shipments').delete().eq('id', deleteId)
    setDeleteId(null)
    loadAll()
  }

  // ── Filter helpers ───────────────────────────────────────────────────────

  const hasFilters = search || filterAirline || filterClient || filterStatus || filterOrigin || filterFrom || filterTo
  const INP_F = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white'

  function clearFilters() {
    setSearch(''); setFilterAirline(''); setFilterClient('')
    setFilterStatus(''); setFilterOrigin(''); setFilterFrom(''); setFilterTo('')
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="p-6 space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy tracking-tight">Master Shipment Log</h1>
            <p className="text-sm text-gray-500 mt-0.5">All shipments — the source of truth for all reports.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              <Upload className="w-4 h-4" />Import Excel
            </Button>
            <Button onClick={() => setFormModal({ mode: 'add' })}>
              <Plus className="w-4 h-4" />Add Shipment
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardBody className="py-3">
            <div className="flex flex-wrap gap-2 items-center">
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

              <input name="filter_origin" className={INP_F} style={{ width: 70 }} value={filterOrigin}
                onChange={(e) => setFilterOrigin(e.target.value)}
                placeholder="ORG" maxLength={3} title="Filter by origin" />

              {hasFilters && (
                <button onClick={clearFilters} className="text-xs text-accent hover:underline whitespace-nowrap">
                  Clear filters
                </button>
              )}

              <div className="ml-auto flex gap-2 items-center">
                <Button variant="ghost" size="sm" onClick={() => exportCSV(filtered)}>
                  <Download className="w-4 h-4" />Export CSV
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="bg-accent/10 border border-accent/30 rounded-lg px-4 py-2.5 flex items-center gap-4">
            <span className="text-sm font-medium text-accent">
              {selected.size} shipment{selected.size !== 1 ? 's' : ''} selected
            </span>
            <span className="text-gray-300">|</span>
            <span className="text-sm text-gray-600">Mark as</span>
            <select className={INP_F + ' py-1'} value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <Button size="sm" onClick={handleBulkStatus} disabled={saving}>
              {saving && <Spinner size="sm" />}Apply
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
                  <Th>AWB Number</Th>
                  <Th>Airline</Th>
                  <Th>Client</Th>
                  <Th>Route</Th>
                  <Th className="text-right">PCS / KGS</Th>
                  <Th className="text-right">Net Rate (PKR/kg)</Th>
                  <Th className="text-right">Total Receivable (PKR)</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </Thead>
              <Tbody>
                {filtered.map((s) => (
                  <Tr key={s.id} className={STATUS_ROW[s.status] ?? ''}>
                    <Td>
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleRow(s.id)}
                        className="w-4 h-4 accent-navy cursor-pointer" />
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDate(s.flight_date)}</Td>
                    <Td>
                      <span className="font-mono font-semibold text-navy">{s.awb_number}</span>
                    </Td>
                    <Td>{s.airlines?.name ?? '—'}</Td>
                    <Td>{s.clients?.name ?? '—'}</Td>
                    <Td>
                      <span className="font-mono text-xs tracking-wider">
                        {s.origin} → {s.destination}
                      </span>
                    </Td>
                    <Td className="text-right font-mono text-sm whitespace-nowrap">
                      {s.pieces} / {Number(s.chargeable_weight || 0).toFixed(3)}
                    </Td>
                    <Td className="text-right font-mono">PKR {fmt(s.net_rate)}</Td>
                    <Td className="text-right font-mono font-semibold text-gray-800 whitespace-nowrap">
                      PKR {fmt(s.total_receivable)}
                    </Td>
                    <Td>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_BADGE[s.status] ?? ''}`}>
                        {s.status}
                      </span>
                    </Td>
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
                        <button title="Generate Invoice"
                          onClick={() => navigate('/invoices', { state: { shipmentId: s.id } })}
                          className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-accent transition-colors">
                          <FileText className="w-4 h-4" />
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
              <Tfoot>
                <tr>
                  <td />
                  <Td colSpan={5} className="text-xs text-gray-500">
                    {totals.count} shipment{totals.count !== 1 ? 's' : ''}
                    {hasFilters ? ' (filtered)' : ''}
                  </Td>
                  <Td className="text-right font-mono font-semibold">
                    {Number(totals.totalWeight).toFixed(3)} KGS
                  </Td>
                  <Td />
                  <Td className="text-right font-mono font-semibold text-navy whitespace-nowrap">
                    PKR {fmt(totals.totalReceivable)}
                  </Td>
                  <Td colSpan={2} />
                </tr>
              </Tfoot>
            </Table>
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
    </>
  )
}
