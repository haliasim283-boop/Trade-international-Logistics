import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Download, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { ConfirmDialog } from '../components/ui/Modal'
import { ExpenseFormModal, CATEGORIES, PAYMENT_METHODS } from '../components/expenses/ExpenseFormModal'

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
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return { from: `${y}-${m}-01`, to: now.toISOString().slice(0, 10) }
}

const METHOD_BADGE = {
  'Cash':          'bg-green-100 text-green-700',
  'Bank Transfer': 'bg-blue-100 text-blue-700',
  'Cheque':        'bg-purple-100 text-purple-700',
  'RAAST':         'bg-amber-100 text-amber-700',
}

const CAT_COLORS = [
  'bg-red-100 text-red-700', 'bg-orange-100 text-orange-700',
  'bg-amber-100 text-amber-700', 'bg-yellow-100 text-yellow-700',
  'bg-lime-100 text-lime-700', 'bg-green-100 text-green-700',
  'bg-teal-100 text-teal-700', 'bg-cyan-100 text-cyan-700',
  'bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700',
]
const catColor = (cat) => CAT_COLORS[CATEGORIES.indexOf(cat) % CAT_COLORS.length] ?? 'bg-gray-100 text-gray-600'

function exportCSV(rows) {
  const header = ['Date','Category','Payee','Amount (PKR)','Method','Bank','TRX/Ref','Description','Receipt No.']
  const lines  = rows.map((r) => [
    r.expense_date, r.category, r.payee ?? '', r.amount,
    r.payment_method, r.bank_account ?? '', r.transaction_id ?? '',
    r.description ?? '', r.receipt_number ?? '',
  ].map((v) => `"${v ?? ''}"`).join(','))
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a'); a.href = url
  a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Expenses() {
  const range = defaultRange()

  // Filters
  const [dateFrom,  setDateFrom]  = useState(range.from)
  const [dateTo,    setDateTo]    = useState(range.to)
  const [catFilter, setCatFilter] = useState('')
  const [methFilter,setMethFilter]= useState('')
  const [search,    setSearch]    = useState('')

  // Data
  const [expenses, setExpenses] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // UI
  const [modal,     setModal]     = useState(null)  // null | { mode:'add' } | { mode:'edit', row }
  const [deleteId,  setDeleteId]  = useState(null)

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError(null)
    const { data, error: e } = await supabase
      .from('expenses')
      .select('*')
      .gte('expense_date', dateFrom)
      .lte('expense_date', dateTo)
      .order('expense_date', { ascending: false })
    if (e) { setError(e.message); setLoading(false); return }
    setExpenses(data ?? [])
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  // ── Client-side filter ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return expenses.filter((r) => {
      if (catFilter  && r.category       !== catFilter)  return false
      if (methFilter && r.payment_method !== methFilter) return false
      if (q && !r.payee?.toLowerCase().includes(q) &&
               !r.description?.toLowerCase().includes(q) &&
               !r.category.toLowerCase().includes(q)) return false
      return true
    })
  }, [expenses, catFilter, methFilter, search])

  // ── Summary numbers ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total = r2(filtered.reduce((s, r) => s + Number(r.amount || 0), 0))
    const cash  = r2(filtered.filter((r) => r.payment_method === 'Cash').reduce((s, r) => s + Number(r.amount), 0))
    const bank  = r2(total - cash)

    // Group by category
    const byCategory = {}
    for (const r of filtered) {
      byCategory[r.category] = r2((byCategory[r.category] ?? 0) + Number(r.amount || 0))
    }

    return { total, cash, bank, byCategory, count: filtered.length }
  }, [filtered])

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete() {
    await supabase.from('expenses').delete().eq('id', deleteId)
    setDeleteId(null); loadData()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!supabase) return <div className="p-6 text-danger text-sm">Supabase not configured.</div>

  const sortedCats = Object.entries(summary.byCategory).sort(([, a], [, b]) => b - a)

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Expenses</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track all outgoing payments and costs</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => exportCSV(filtered)}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button onClick={() => setModal({ mode: 'add' })}>
            <Plus className="w-4 h-4" /> Add Expense
          </Button>
        </div>
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date From</label>
              <input type="date" className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date To</label>
              <input type="date" className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="min-w-[200px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
              <div className="relative">
                <select className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-accent"
                  value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                  <option value="">All Categories</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
              <div className="relative">
                <select className="border border-gray-300 rounded-md px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-accent"
                  value={methFilter} onChange={(e) => setMethFilter(e.target.value)}>
                  <option value="">All Methods</option>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Search Payee / Desc</label>
              <input className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to search…" />
            </div>
            {(catFilter || methFilter || search) && (
              <button className="text-xs text-accent hover:underline pb-2"
                onClick={() => { setCatFilter(''); setMethFilter(''); setSearch('') }}>
                Clear filters
              </button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Summary tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile label="Total Expenses" value={`PKR ${fmt(summary.total)}`} color="navy" />
        <Tile label="Number of Records" value={summary.count} color="blue" />
        <Tile label="Cash Payments" value={`PKR ${fmt(summary.cash)}`} color="green" />
        <Tile label="Bank / Cheque / RAAST" value={`PKR ${fmt(summary.bank)}`} color="purple" />
      </div>

      {/* ── Main table + Category summary (side by side on large screens) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Expenses table — takes 2/3 width */}
        <div className="xl:col-span-2">
          <Card>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">
                Expense Records
              </h3>
              <span className="text-xs text-gray-400">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
            </div>

            {loading ? (
              <div className="flex justify-center py-16"><Spinner size="lg" /></div>
            ) : error ? (
              <p className="px-4 pb-4 text-danger text-sm">{error}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[700px]">
                  <thead className="bg-navy text-white">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Date</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Category</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Payee</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Amount (PKR)</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Method</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Bank / Ref</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Description</th>
                      <th className="px-3 py-2.5 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-14 text-gray-400 text-sm">
                          No expenses found. Click "Add Expense" to record one.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(r.expense_date)}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${catColor(r.category)}`}>
                              {r.category}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-700">{r.payee || '—'}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-navy">
                            {fmt(r.amount)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${METHOD_BADGE[r.payment_method] ?? 'bg-gray-100 text-gray-600'}`}>
                              {r.payment_method}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-500">
                            <div>{r.bank_account || (r.payment_method === 'Cash' ? 'Cash' : '—')}</div>
                            {r.transaction_id && (
                              <div className="font-mono text-gray-400">{r.transaction_id}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[180px] truncate">
                            {r.description || '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex gap-1">
                              <button onClick={() => setModal({ mode: 'edit', row: r })}
                                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-navy">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setDeleteId(r.id)}
                                className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-danger">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
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
                        <td colSpan={4}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right panel: category breakdown + cash vs bank */}
        <div className="space-y-4">

          {/* Category breakdown */}
          <Card>
            <div className="px-4 pt-4 pb-2">
              <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">By Category</h3>
              <p className="text-xs text-gray-400 mt-0.5">Filtered period totals</p>
            </div>
            <div className="px-4 pb-4">
              {sortedCats.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No data</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-50">
                    {sortedCats.map(([cat, amt]) => (
                      <tr key={cat}>
                        <td className="py-2 pr-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${catColor(cat)}`}>
                            {cat}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono text-sm font-semibold text-gray-900">
                          {fmt(amt)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-300">
                      <td className="py-2 font-bold text-gray-800">Total</td>
                      <td className="py-2 text-right font-mono font-bold text-navy">{fmt(summary.total)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* Cash vs Bank */}
          <Card>
            <div className="px-4 pt-4 pb-2">
              <h3 className="font-semibold text-navy text-sm uppercase tracking-wide">Cash vs. Bank</h3>
            </div>
            <div className="px-4 pb-4 space-y-3">
              <div className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-sm text-gray-600 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 inline-block"></span> Cash
                </span>
                <span className="font-mono font-semibold text-green-700">PKR {fmt(summary.cash)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-sm text-gray-600 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> Bank / Cheque / RAAST
                </span>
                <span className="font-mono font-semibold text-blue-700">PKR {fmt(summary.bank)}</span>
              </div>
              {summary.total > 0 && (
                <>
                  <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-green-400 h-3 rounded-l-full"
                      style={{ width: `${(summary.cash / summary.total) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Cash {summary.total > 0 ? Math.round((summary.cash / summary.total) * 100) : 0}%</span>
                    <span>Bank {summary.total > 0 ? Math.round((summary.bank / summary.total) * 100) : 0}%</span>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center pt-1 border-t-2 border-gray-200">
                <span className="font-semibold text-gray-800">Total</span>
                <span className="font-mono font-bold text-navy">PKR {fmt(summary.total)}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Modals ── */}
      {modal && (
        <ExpenseFormModal
          existing={modal.row ?? null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadData() }}
        />
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Expense"
          message="This expense record will be permanently removed."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}

// ── Tile ──────────────────────────────────────────────────────────────────────
function Tile({ label, value, color }) {
  const colors = {
    navy:   'bg-indigo-50 border-indigo-100 text-indigo-900',
    blue:   'bg-blue-50   border-blue-100   text-blue-900',
    green:  'bg-green-50  border-green-100  text-green-900',
    purple: 'bg-purple-50 border-purple-100 text-purple-900',
  }
  return (
    <div className={`border rounded-xl p-4 ${colors[color] ?? colors.blue}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="font-mono font-bold text-lg leading-tight">{value}</p>
    </div>
  )
}
