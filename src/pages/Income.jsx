import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Download, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { ConfirmDialog } from '../components/ui/Modal'
import { ManualIncomeModal } from '../components/income/ManualIncomeModal'

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

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function monthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-')
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`
}

function defaultRange() {
  const now = new Date()
  const y   = now.getFullYear()
  // default: show current year
  return { from: `${y}-01-01`, to: now.toISOString().slice(0, 10) }
}

function exportCSV(rows) {
  const header = ['Date','Source','Description / Client','Amount (PKR)','Bank','TRX ID','Type']
  const lines  = rows.map((r) => [
    r.date, r.source, r.description ?? '', r.amount, r.bank_account ?? '', r.transaction_id ?? '', r.type,
  ].map((v) => `"${v ?? ''}"`).join(','))
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a'); a.href = url
  a.download = `income-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Income() {
  const range = defaultRange()

  // Filters
  const [dateFrom,    setDateFrom]    = useState(range.from)
  const [dateTo,      setDateTo]      = useState(range.to)
  const [typeFilter,  setTypeFilter]  = useState('')   // '' | 'Client Payment' | 'Manual'
  const [search,      setSearch]      = useState('')

  // Data
  const [clientPmts, setClientPmts] = useState([])
  const [manualInc,  setManualInc]  = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)

  // UI
  const [modal,    setModal]    = useState(null)  // null | { mode:'add' } | { mode:'edit', row }
  const [deleteId, setDeleteId] = useState(null)  // { id, type:'manual' }

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError(null)

    const [{ data: cpData, error: cpErr }, { data: miData, error: miErr }] = await Promise.all([
      supabase.from('client_payments')
        .select('id,payment_date,amount,payment_method,bank_account,transaction_id,description,notes,clients(name)')
        .gte('payment_date', dateFrom)
        .lte('payment_date', dateTo)
        .order('payment_date', { ascending: false }),

      supabase.from('manual_income')
        .select('*')
        .gte('income_date', dateFrom)
        .lte('income_date', dateTo)
        .order('income_date', { ascending: false }),
    ])

    if (cpErr || miErr) { setError((cpErr ?? miErr).message); setLoading(false); return }
    setClientPmts(cpData ?? [])
    setManualInc(miData ?? [])
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  // ── Merge + normalise rows ──────────────────────────────────────────────────
  const allRows = useMemo(() => {
    const cp = clientPmts.map((r) => ({
      _id:           r.id,
      type:          'Client Payment',
      date:          r.payment_date,
      source:        'Client Payment',
      description:   r.clients?.name
                       ? `${r.clients.name}${r.description ? ' — ' + r.description : ''}`
                       : (r.description ?? r.notes ?? ''),
      amount:        Number(r.amount),
      bank_account:  r.bank_account,
      transaction_id:r.transaction_id,
      editable:      false,  // client payments edited in Ledgers
    }))
    const mi = manualInc.map((r) => ({
      _id:           r.id,
      type:          'Manual',
      date:          r.income_date,
      source:        r.source,
      description:   r.description ?? '',
      amount:        Number(r.amount),
      bank_account:  r.bank_account,
      transaction_id:r.transaction_id,
      _raw:          r,
      editable:      true,
    }))
    return [...cp, ...mi].sort((a, b) => b.date.localeCompare(a.date))
  }, [clientPmts, manualInc])

  // ── Client-side filter ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRows.filter((r) => {
      if (typeFilter && r.type !== typeFilter) return false
      if (q && !r.source.toLowerCase().includes(q) &&
               !r.description.toLowerCase().includes(q)) return false
      return true
    })
  }, [allRows, typeFilter, search])

  // ── Summary ─────────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total  = r2(filtered.reduce((s, r) => s + r.amount, 0))
    const fromCP = r2(filtered.filter((r) => r.type === 'Client Payment').reduce((s, r) => s + r.amount, 0))
    const fromMI = r2(filtered.filter((r) => r.type === 'Manual').reduce((s, r) => s + r.amount, 0))

    // Group by month (YYYY-MM)
    const byMonth = {}
    for (const r of filtered) {
      const key = r.date.slice(0, 7)
      if (!byMonth[key]) byMonth[key] = { client: 0, manual: 0 }
      if (r.type === 'Client Payment') byMonth[key].client = r2(byMonth[key].client + r.amount)
      else                              byMonth[key].manual = r2(byMonth[key].manual + r.amount)
    }

    return { total, fromCP, fromMI, byMonth }
  }, [filtered])

  // ── Delete manual ───────────────────────────────────────────────────────────
  async function handleDelete() {
    await supabase.from('manual_income').delete().eq('id', deleteId)
    setDeleteId(null); loadData()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!supabase) return <div className="p-6 text-danger text-sm">Supabase not configured.</div>

  const monthKeys = Object.keys(summary.byMonth).sort((a, b) => b.localeCompare(a))

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Income</h1>
          <p className="text-sm text-gray-500 mt-0.5">Client payments + manually recorded income</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => exportCSV(filtered)}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button onClick={() => setModal({ mode: 'add' })}>
            <Plus className="w-4 h-4" /> Add Income
          </Button>
        </div>
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date From</label>
              <input type="date"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date To</label>
              <input type="date"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
              <div className="relative">
                <select
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-accent"
                  value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option value="">All Income</option>
                  <option value="Client Payment">Client Payments</option>
                  <option value="Manual">Manual Entries</option>
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Search Source / Description</label>
              <input
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to search…" />
            </div>
            {(typeFilter || search) && (
              <button className="text-xs text-accent hover:underline pb-2"
                onClick={() => { setTypeFilter(''); setSearch('') }}>
                Clear
              </button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Summary tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile label="Total Income" value={`PKR ${fmt(summary.total)}`} color="green" big />
        <Tile label="Records" value={filtered.length} color="blue" />
        <Tile label="Client Payments" value={`PKR ${fmt(summary.fromCP)}`} color="navy" />
        <Tile label="Other / Manual" value={`PKR ${fmt(summary.fromMI)}`} color="purple" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="py-8 text-center text-danger text-sm">{error}</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* ── Combined income table (2/3 width) ── */}
          <div className="xl:col-span-2">
            <Card>
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">All Income</h3>
                <span className="text-xs text-gray-400">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[620px]">
                  <thead className="bg-navy text-white">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Date</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Source</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Description / Client</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Amount (PKR)</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Bank / TRX</th>
                      <th className="px-3 py-2.5 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-14 text-gray-400 text-sm">
                          No income records found. Add client payments via Party Ledgers or click "Add Income".
                        </td>
                      </tr>
                    ) : (
                      filtered.map((r) => (
                        <tr key={`${r.type}-${r._id}`}
                          className={r.type === 'Client Payment' ? 'bg-blue-50/40 hover:bg-blue-50' : 'hover:bg-gray-50'}>
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(r.date)}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              r.type === 'Client Payment'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {r.source}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-700 text-xs">{r.description || '—'}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-green-700">
                            {fmt(r.amount)}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-500">
                            <div>{r.bank_account || '—'}</div>
                            {r.transaction_id && (
                              <div className="font-mono text-gray-400">{r.transaction_id}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {r.editable ? (
                              <div className="flex gap-1">
                                <button onClick={() => setModal({ mode: 'edit', row: r._raw })}
                                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-navy">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setDeleteId(r._id)}
                                  className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-danger">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-300" title="Edit in Party Ledgers">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot className="bg-navy text-white">
                      <tr>
                        <td colSpan={3} className="px-3 py-2.5 font-bold text-xs uppercase tracking-wide">
                          Total ({filtered.length} records)
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold">
                          PKR {fmt(summary.total)}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Note about client payments */}
              {filtered.some((r) => r.type === 'Client Payment') && (
                <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                  Client payments (blue rows) are recorded in Party Ledgers and are read-only here.
                </p>
              )}
            </Card>
          </div>

          {/* ── Right panel: Monthly totals ── */}
          <div>
            <Card>
              <div className="px-4 pt-4 pb-2">
                <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Monthly Totals</h3>
                <p className="text-xs text-gray-400 mt-0.5">Filtered records grouped by month</p>
              </div>
              <div className="px-4 pb-4">
                {monthKeys.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No data</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-1.5 text-xs font-semibold text-gray-500 uppercase">Month</th>
                        <th className="text-right py-1.5 text-xs font-semibold text-blue-500 uppercase">Client</th>
                        <th className="text-right py-1.5 text-xs font-semibold text-amber-600 uppercase">Manual</th>
                        <th className="text-right py-1.5 text-xs font-semibold text-gray-700 uppercase">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {monthKeys.map((key) => {
                        const { client, manual } = summary.byMonth[key]
                        return (
                          <tr key={key} className="hover:bg-gray-50">
                            <td className="py-2 font-medium text-gray-800">{monthLabel(key)}</td>
                            <td className="py-2 text-right font-mono text-blue-700 text-xs">
                              {client > 0 ? fmt(client) : '—'}
                            </td>
                            <td className="py-2 text-right font-mono text-amber-700 text-xs">
                              {manual > 0 ? fmt(manual) : '—'}
                            </td>
                            <td className="py-2 text-right font-mono font-semibold text-gray-900">
                              {fmt(r2(client + manual))}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-300">
                      <tr>
                        <td className="py-2 font-bold text-gray-800">Total</td>
                        <td className="py-2 text-right font-mono font-bold text-blue-700 text-xs">{fmt(summary.fromCP)}</td>
                        <td className="py-2 text-right font-mono font-bold text-amber-700 text-xs">{fmt(summary.fromMI)}</td>
                        <td className="py-2 text-right font-mono font-bold text-navy">{fmt(summary.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {modal && (
        <ManualIncomeModal
          existing={modal.row ?? null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadData() }}
        />
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Income Entry"
          message="This manual income record will be permanently removed."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}

// ── Tile ──────────────────────────────────────────────────────────────────────
function Tile({ label, value, color, big }) {
  const colors = {
    green:  'bg-green-50  border-green-100  text-green-900',
    blue:   'bg-blue-50   border-blue-100   text-blue-900',
    navy:   'bg-indigo-50 border-indigo-100 text-indigo-900',
    purple: 'bg-purple-50 border-purple-100 text-purple-900',
  }
  return (
    <div className={`border rounded-xl p-4 ${colors[color] ?? colors.blue}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className={`font-mono font-bold leading-tight ${big ? 'text-xl' : 'text-lg'}`}>{value}</p>
    </div>
  )
}
