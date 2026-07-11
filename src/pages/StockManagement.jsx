import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Trash2, ChevronDown, CheckCircle2, Clock, PackageOpen, Save } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { Table, Thead, Th, Tbody, Tr, Td } from '../components/ui/Table'
import { ConfirmDialog } from '../components/ui/Modal'
import { AddAwbStockModal } from '../components/stock/AddAwbStockModal'

const SEL = 'border border-gray-300 rounded-md px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-accent bg-white'
const INP = 'border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

function normalizeAwb(s) {
  return (s ?? '').toString().replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function fmtDate(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

const STATE_BADGE = {
  used:      { label: 'Used',      cls: 'bg-green-100 text-green-700',  icon: CheckCircle2 },
  reserved:  { label: 'Reserved',  cls: 'bg-amber-100 text-amber-700',  icon: Clock },
  available: { label: 'Available', cls: 'bg-gray-100 text-gray-600',    icon: PackageOpen },
}

export default function StockManagement() {
  const { role } = useAuth()
  const canEdit = role !== 'Report Viewer' && role !== 'Invoice Agent'

  const [airlines, setAirlines] = useState([])
  const [stock, setStock]       = useState([])
  const [shipments, setShipments] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const [airlineFilter, setAirlineFilter] = useState('')
  const [statusFilter, setStatusFilter]   = useState('')
  const [search, setSearch]               = useState('')

  const [addModalOpen, setAddModalOpen] = useState(false)
  const [saving, setSaving]             = useState(false)
  const [deleteId, setDeleteId]         = useState(null)

  const [prefixDraft, setPrefixDraft] = useState('')
  const [savingPrefix, setSavingPrefix] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('Supabase not configured'); return }
    setLoading(true); setError(null)
    const [airlinesRes, stockRes, shipmentsRes] = await Promise.all([
      supabase.from('airlines').select('*').eq('is_active', true).order('name'),
      supabase.from('awb_stock').select('*').order('prefix').order('awb_serial'),
      supabase.from('shipments').select('id, awb_number, status, flight_date, clients(name)'),
    ])
    if (airlinesRes.error)  { setError(airlinesRes.error.message);  setLoading(false); return }
    if (stockRes.error)     { setError(stockRes.error.message);     setLoading(false); return }
    if (shipmentsRes.error) { setError(shipmentsRes.error.message); setLoading(false); return }
    setAirlines(airlinesRes.data ?? [])
    setStock(stockRes.data ?? [])
    setShipments(shipmentsRes.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!airlineFilter) { setPrefixDraft(''); return }
    const a = airlines.find((x) => x.id === airlineFilter)
    setPrefixDraft(a?.current_awb_prefix ?? '')
  }, [airlineFilter, airlines])

  const shipmentByAwb = useMemo(() => {
    const map = new Map()
    for (const s of shipments) {
      const key = normalizeAwb(s.awb_number)
      if (key) map.set(key, s)
    }
    return map
  }, [shipments])

  const airlineById = useMemo(() => {
    const map = new Map()
    for (const a of airlines) map.set(a.id, a)
    return map
  }, [airlines])

  const existingKeys = useMemo(() => {
    const set = new Set()
    for (const row of stock) set.add(`${row.airline_id}|${row.prefix}|${row.awb_serial}`)
    return set
  }, [stock])

  const enriched = useMemo(() => {
    return stock.map((row) => {
      const key = normalizeAwb(`${row.prefix}${row.awb_serial}`)
      const match = shipmentByAwb.get(key)
      let state = 'available'
      if (match && match.status === 'SHPD') state = 'used'
      else if (match) state = 'reserved'
      return { ...row, state, shipment: match ?? null }
    })
  }, [stock, shipmentByAwb])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (airlineFilter && r.airline_id !== airlineFilter) return false
      if (statusFilter && r.state !== statusFilter) return false
      if (q && !r.prefix.toLowerCase().includes(q) && !r.awb_serial.toLowerCase().includes(q)) return false
      return true
    })
  }, [enriched, airlineFilter, statusFilter, search])

  const summary = useMemo(() => {
    const base = airlineFilter ? enriched.filter((r) => r.airline_id === airlineFilter) : enriched
    return {
      total: base.length,
      used: base.filter((r) => r.state === 'used').length,
      reserved: base.filter((r) => r.state === 'reserved').length,
      available: base.filter((r) => r.state === 'available').length,
    }
  }, [enriched, airlineFilter])

  async function handleAddStock(rows) {
    setSaving(true)
    const { error } = await supabase.from('awb_stock').insert(rows)
    setSaving(false)
    if (error) { alert(error.message); return }
    setAddModalOpen(false)
    load()
  }

  async function handleDelete() {
    await supabase.from('awb_stock').delete().eq('id', deleteId)
    setDeleteId(null); load()
  }

  async function handleSavePrefix() {
    if (!airlineFilter) return
    setSavingPrefix(true)
    const { error } = await supabase.from('airlines')
      .update({ current_awb_prefix: prefixDraft.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', airlineFilter)
    setSavingPrefix(false)
    if (error) { alert(error.message); return }
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error)   return <div className="py-8 text-center text-danger text-sm">{error}</div>
  if (!supabase) return <div className="p-6 text-danger text-sm">Supabase not configured.</div>

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Stock Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track AWB numbers issued by each airline and see which have been used</p>
        </div>
        {canEdit && (
          <Button onClick={() => setAddModalOpen(true)} disabled={airlines.length === 0}>
            <Plus className="w-4 h-4" /> Add AWB Numbers
          </Button>
        )}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Total in Stock', summary.total, 'text-navy'],
          ['Available',      summary.available, 'text-gray-600'],
          ['Reserved',       summary.reserved, 'text-amber-600'],
          ['Used',           summary.used, 'text-green-600'],
        ].map(([label, value, cls]) => (
          <Card key={label}>
            <CardBody className="py-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-xl font-bold ${cls}`}>{value}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="min-w-[220px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Airline</label>
              <div className="relative">
                <select className={`${SEL} w-full`} value={airlineFilter} onChange={(e) => setAirlineFilter(e.target.value)}>
                  <option value="">All Airlines</option>
                  {airlines.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>
            <div className="min-w-[160px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <div className="relative">
                <select className={`${SEL} w-full`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All Statuses</option>
                  <option value="available">Available</option>
                  <option value="reserved">Reserved</option>
                  <option value="used">Used</option>
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
              <input className={`${INP} w-full`} value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search prefix or serial…" />
            </div>

            {airlineFilter && canEdit && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Default Prefix for this Airline</label>
                <div className="flex gap-2">
                  <input className={`${INP} font-mono`} value={prefixDraft} onChange={(e) => setPrefixDraft(e.target.value)}
                    placeholder="e.g. 157-9678" />
                  <Button size="md" variant="secondary" onClick={handleSavePrefix} disabled={savingPrefix}>
                    {savingPrefix ? <Spinner size="sm" /> : <Save className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-base font-medium">No AWB numbers in stock</p>
            <p className="text-sm mt-1">
              {airlines.length === 0
                ? 'Add an airline in Party Management first.'
                : 'Click "Add AWB Numbers" to add a block from an airline.'}
            </p>
          </div>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Airline</Th><Th>Prefix</Th><Th>AWB Serial</Th><Th>Full AWB Number</Th>
                <Th>Date Received</Th><Th>Status</Th><Th>Shipment</Th><Th>Actions</Th>
              </tr>
            </Thead>
            <Tbody>
              {filtered.map((r) => {
                const badge = STATE_BADGE[r.state]
                const Icon = badge.icon
                const airline = airlineById.get(r.airline_id)
                return (
                  <Tr key={r.id}>
                    <Td>{airline?.name ?? '—'}</Td>
                    <Td className="font-mono">{r.prefix}</Td>
                    <Td className="font-mono">{r.awb_serial}</Td>
                    <Td className="font-mono text-gray-500">{r.prefix}-{r.awb_serial}</Td>
                    <Td>{fmtDate(r.received_date)}</Td>
                    <Td>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>
                        <Icon className="w-3 h-3" /> {badge.label}
                      </span>
                    </Td>
                    <Td className="text-gray-500">
                      {r.shipment
                        ? <>{r.shipment.clients?.name ?? '—'} <span className="text-gray-400">· {fmtDate(r.shipment.flight_date)}</span></>
                        : '—'}
                    </Td>
                    <Td>
                      {canEdit && r.state !== 'used' && (
                        <button title="Delete" onClick={() => setDeleteId(r.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-danger transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        )}
      </Card>

      {addModalOpen && (
        <AddAwbStockModal
          airlines={airlines}
          defaultAirlineId={airlineFilter || airlines[0]?.id}
          existingKeys={existingKeys}
          onSave={handleAddStock}
          onClose={() => setAddModalOpen(false)}
          saving={saving}
        />
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete AWB Number"
          message="This AWB number will be removed from stock. This cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
