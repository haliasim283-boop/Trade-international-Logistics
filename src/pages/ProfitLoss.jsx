import { useState, useEffect, useCallback } from 'react'
import { Download, Printer, TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function r2(n) { return Math.round(Number(n || 0) * 100) / 100 }
function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

// ── Period presets ────────────────────────────────────────────────────────────

function thisMonth() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth() + 1
  const ms = String(m).padStart(2, '0')
  const last = new Date(y, m, 0).getDate()
  return { from: `${y}-${ms}-01`, to: `${y}-${ms}-${String(last).padStart(2, '0')}` }
}
function lastMonth() {
  const last = new Date(new Date().getFullYear(), new Date().getMonth(), 0)
  const y = last.getFullYear(), m = last.getMonth() + 1
  const ms = String(m).padStart(2, '0')
  const lastDay = new Date(y, m, 0).getDate()
  return { from: `${y}-${ms}-01`, to: `${y}-${ms}-${String(lastDay).padStart(2, '0')}` }
}
function thisQuarter() {
  const now = new Date()
  const y = now.getFullYear(), q = Math.floor(now.getMonth() / 3)
  const start = new Date(y, q * 3, 1)
  const fm = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
  return { from: fm, to: now.toISOString().slice(0, 10) }
}
function thisYear() {
  const now = new Date()
  return { from: `${now.getFullYear()}-01-01`, to: now.toISOString().slice(0, 10) }
}
function prevPeriod(from, to) {
  const start = new Date(from), end = new Date(to)
  const days = Math.round((end - start) / 86400000) + 1
  const newEnd = new Date(start); newEnd.setDate(newEnd.getDate() - 1)
  const newStart = new Date(newEnd); newStart.setDate(newStart.getDate() - days + 1)
  return { from: newStart.toISOString().slice(0, 10), to: newEnd.toISOString().slice(0, 10) }
}

// ── Fetch P&L data ────────────────────────────────────────────────────────────

async function fetchPL(from, to) {
  const [
    { data: cpData,  error: e1 },
    { data: miData,  error: e2 },
    { data: shData,  error: e3 },
    { data: expData, error: e4 },
  ] = await Promise.all([
    supabase.from('client_payments').select('amount').gte('payment_date', from).lte('payment_date', to),
    supabase.from('manual_income').select('amount').gte('income_date', from).lte('income_date', to),
    supabase.from('shipments')
      .select('chargeable_weight, pkr_exchange_rate, airlines(cass_commission_usd_per_kg)')
      .gte('flight_date', from).lte('flight_date', to),
    supabase.from('expenses').select('category, amount').gte('expense_date', from).lte('expense_date', to),
  ])
  if (e1 || e2 || e3 || e4) throw e1 || e2 || e3 || e4

  const clientReceipts   = r2((cpData  || []).reduce((s, r) => s + Number(r.amount), 0))
  const otherIncome      = r2((miData  || []).reduce((s, r) => s + Number(r.amount), 0))
  const commissionEarned = r2((shData  || []).reduce((s, r) => {
    const w    = Number(r.chargeable_weight || 0)
    const rate = Number(r.pkr_exchange_rate || 1)
    return s + w * Number(r.airlines?.cass_commission_usd_per_kg || 0) * rate
  }, 0))
  const totalIncome = r2(clientReceipts + commissionEarned + otherIncome)

  const catSum = {}
  for (const e of (expData || [])) {
    catSum[e.category] = r2((catSum[e.category] || 0) + Number(e.amount))
  }
  const cassPayments    = r2(catSum['Airline Payments (CASS)']      || 0)
  const formEPayments   = r2(catSum['Form E Supplier Payments']      || 0)
  const clearingPayments= r2(catSum['Clearing Agent Payments']       || 0)
  const salaries        = r2(catSum['Salaries']                      || 0)
  const rent            = r2(catSum['Rent']                          || 0)
  const utilities       = r2(catSum['Utilities']                     || 0)
  const otherOffice     = r2(
    (catSum['Office / Stationery'] || 0) +
    (catSum['IATA / CASS Fees']    || 0) +
    (catSum['Bank Charges']        || 0) +
    (catSum['Miscellaneous']       || 0)
  )
  const directCosts  = r2(cassPayments + formEPayments + clearingPayments)
  const opExpenses   = r2(salaries + rent + utilities + otherOffice)
  const totalExpenses= r2(directCosts + opExpenses)
  const grossProfit      = r2(totalIncome - directCosts)
  const operatingProfit  = r2(grossProfit - opExpenses)

  return {
    clientReceipts, commissionEarned, otherIncome, totalIncome,
    cassPayments, formEPayments, clearingPayments, directCosts,
    salaries, rent, utilities, otherOffice, opExpenses, totalExpenses,
    grossProfit, operatingProfit,
  }
}

// ── Print ─────────────────────────────────────────────────────────────────────

function printPL(data, prevData, from, to, prevFrom, prevTo) {
  const win = window.open('', '_blank', 'width=820,height=960')
  if (!win) return
  const cmp = prevData != null
  const fmtN = (n) => `PKR ${fmt(n)}`
  const chg = (c, p) => {
    const d = r2(c - (p || 0))
    const pct = p ? Math.round((d / Math.abs(p)) * 100) : 0
    const col = d >= 0 ? '#16a34a' : '#dc2626'
    return `<span style="color:${col}">${d >= 0 ? '+' : ''}${fmt(d)} (${d >= 0 ? '+' : ''}${pct}%)</span>`
  }
  const row = (lbl, c, p, bold, indent) => {
    const s = bold ? 'font-weight:700;background:#f8fafc;' : ''
    const i = indent ? 'padding-left:28px;' : ''
    return `<tr>
      <td style="${s}${i}padding:6px 10px;border-bottom:1px solid #f0f0f0">${lbl}</td>
      <td style="${s}text-align:right;padding:6px 10px;font-family:monospace;border-bottom:1px solid #f0f0f0">${fmtN(c)}</td>
      ${cmp ? `<td style="${s}text-align:right;padding:6px 10px;font-family:monospace;border-bottom:1px solid #f0f0f0">${fmtN(p||0)}</td>
               <td style="${s}text-align:right;padding:6px 10px;font-size:11px;border-bottom:1px solid #f0f0f0">${chg(c,p)}</td>` : ''}`
  }
  const sec = (t) =>
    `<tr style="background:#1a2744;color:white"><td colspan="${cmp ? 4 : 2}" style="padding:8px 10px;font-weight:700;letter-spacing:1px;font-size:12px;text-transform:uppercase">${t}</td></tr>`
  const netRow = (lbl, c, p) => {
    const isProfit = c >= 0
    const bg = isProfit ? '#f0fdf4' : '#fef2f2'
    const clr = isProfit ? '#166534' : '#991b1b'
    return `<tr style="background:${bg}">
      <td style="padding:10px 10px;font-weight:800;font-size:14px;color:${clr}">${lbl}</td>
      <td style="text-align:right;padding:10px 10px;font-family:monospace;font-weight:800;font-size:14px;color:${clr}">${fmtN(c)}</td>
      ${cmp ? `<td style="text-align:right;padding:10px 10px;font-family:monospace;font-weight:700;color:${(p||0)>=0?'#16a34a':'#dc2626'}">${fmtN(p||0)}</td>
               <td style="text-align:right;padding:10px 10px;font-size:11px">${chg(c,p)}</td>` : ''}`
  }
  win.document.write(`<!DOCTYPE html><html><head><title>P&L</title>
  <style>body{font-family:Arial,sans-serif;font-size:13px;margin:20px}table{width:100%;border-collapse:collapse}
  @media print{button{display:none}}</style></head><body>
  <h1 style="color:#1a2744;font-size:20px;margin-bottom:4px">TRADE INTERNATIONAL LOGISTICS</h1>
  <p style="color:#555;margin-bottom:4px">Profit &amp; Loss Statement</p>
  <p style="color:#555;margin-bottom:16px">Period: ${fmtDate(from)} – ${fmtDate(to)}${cmp ? ` | Previous: ${fmtDate(prevFrom)} – ${fmtDate(prevTo)}` : ''}</p>
  <table>
    <tr style="background:#1a2744;color:white">
      <th style="padding:8px 10px;text-align:left">Description</th>
      <th style="padding:8px 10px;text-align:right">Current Period</th>
      ${cmp ? '<th style="padding:8px 10px;text-align:right">Previous Period</th><th style="padding:8px 10px;text-align:right">Change</th>' : ''}
    </tr>
    ${sec('INCOME')}
    ${row('Client Receipts', data.clientReceipts, prevData?.clientReceipts, false, true)}
    ${row('Commission Earned (Airlines)', data.commissionEarned, prevData?.commissionEarned, false, true)}
    ${row('Other / Manual Income', data.otherIncome, prevData?.otherIncome, false, true)}
    ${row('TOTAL INCOME', data.totalIncome, prevData?.totalIncome, true, false)}
    ${sec('DIRECT COSTS')}
    ${row('CASS / Airline Payments', data.cassPayments, prevData?.cassPayments, false, true)}
    ${row('Form E Supplier Payments', data.formEPayments, prevData?.formEPayments, false, true)}
    ${row('Clearing Agent Payments', data.clearingPayments, prevData?.clearingPayments, false, true)}
    ${row('Total Direct Costs', data.directCosts, prevData?.directCosts, true, false)}
    ${sec('GROSS PROFIT')}
    ${netRow(data.grossProfit >= 0 ? 'GROSS PROFIT' : 'GROSS LOSS', data.grossProfit, prevData?.grossProfit)}
    ${sec('OPERATING EXPENSES')}
    ${row('Salaries', data.salaries, prevData?.salaries, false, true)}
    ${row('Rent', data.rent, prevData?.rent, false, true)}
    ${row('Utilities', data.utilities, prevData?.utilities, false, true)}
    ${row('Other Office Expenses', data.otherOffice, prevData?.otherOffice, false, true)}
    ${row('Total Operating Expenses', data.opExpenses, prevData?.opExpenses, true, false)}
    ${sec('NET PROFIT / LOSS')}
    ${netRow(data.operatingProfit >= 0 ? 'NET PROFIT' : 'NET LOSS', data.operatingProfit, prevData?.operatingProfit)}
  </table>
  <p style="font-size:11px;color:#aaa;margin-top:20px">Generated ${new Date().toLocaleDateString('en-GB')} — Trade International Logistics</p>
  </body></html>`)
  win.document.close()
  setTimeout(() => { win.focus(); win.print() }, 400)
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(data, prevData, from, to) {
  const cmp = prevData != null
  const h = cmp ? ['Description', 'Current', 'Previous', 'Change', 'Change %'] : ['Description', 'Amount (PKR)']
  const mk = (lbl, c, p) => {
    if (!cmp) return [lbl, c]
    const d = r2(c - (p || 0)), pct = p ? Math.round((d / Math.abs(p)) * 100) : 0
    return [lbl, c, p ?? 0, d, `${pct}%`]
  }
  const rows = [
    h,
    ['--- INCOME ---'],
    mk('Client Receipts', data.clientReceipts, prevData?.clientReceipts),
    mk('Commission Earned', data.commissionEarned, prevData?.commissionEarned),
    mk('Other Income', data.otherIncome, prevData?.otherIncome),
    mk('TOTAL INCOME', data.totalIncome, prevData?.totalIncome),
    ['--- DIRECT COSTS ---'],
    mk('CASS / Airline Payments', data.cassPayments, prevData?.cassPayments),
    mk('Form E Supplier Payments', data.formEPayments, prevData?.formEPayments),
    mk('Clearing Agent Payments', data.clearingPayments, prevData?.clearingPayments),
    mk('Total Direct Costs', data.directCosts, prevData?.directCosts),
    ['--- GROSS ---'],
    mk('GROSS PROFIT', data.grossProfit, prevData?.grossProfit),
    ['--- OPERATING EXPENSES ---'],
    mk('Salaries', data.salaries, prevData?.salaries),
    mk('Rent', data.rent, prevData?.rent),
    mk('Utilities', data.utilities, prevData?.utilities),
    mk('Other Office', data.otherOffice, prevData?.otherOffice),
    mk('Total Operating Expenses', data.opExpenses, prevData?.opExpenses),
    ['--- NET ---'],
    mk('NET OPERATING PROFIT', data.operatingProfit, prevData?.operatingProfit),
  ]
  const csv = rows.map((r) => (Array.isArray(r) ? r : [r]).map((v) => `"${v ?? ''}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url
  a.download = `pnl-${from}-to-${to}.csv`
  a.click(); URL.revokeObjectURL(url)
}

// ── Table rows (module-level to avoid recreation on render) ───────────────────

function SectionRow({ title, compare }) {
  const cols = compare ? 4 : 2
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-2.5 bg-navy text-white text-xs font-bold uppercase tracking-widest">
        {title}
      </td>
    </tr>
  )
}

function DataRow({ label, curr, prev, indent, compare }) {
  const d    = compare ? r2(curr - (prev || 0)) : 0
  const pct  = compare && prev ? Math.round((d / Math.abs(prev)) * 100) : 0
  return (
    <tr className="hover:bg-gray-50/60">
      <td className={`px-4 py-2.5 text-sm text-gray-700 ${indent ? 'pl-9' : ''}`}>{label}</td>
      <td className="px-4 py-2.5 text-right font-mono text-sm text-gray-800">PKR {fmt(curr)}</td>
      {compare && (
        <>
          <td className="px-4 py-2.5 text-right font-mono text-sm text-gray-400">PKR {fmt(prev ?? 0)}</td>
          <td className={`px-4 py-2.5 text-right font-mono text-xs ${d >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {d >= 0 ? '+' : ''}{fmt(d)}&nbsp;({d >= 0 ? '+' : ''}{pct}%)
          </td>
        </>
      )}
    </tr>
  )
}

function SubtotalRow({ label, curr, prev, compare }) {
  const d   = compare ? r2(curr - (prev || 0)) : 0
  const pct = compare && prev ? Math.round((d / Math.abs(prev)) * 100) : 0
  return (
    <tr className="bg-gray-50 border-t border-gray-200">
      <td className="px-4 py-2.5 text-sm font-bold text-navy">{label}</td>
      <td className="px-4 py-2.5 text-right font-mono font-bold text-navy text-sm">PKR {fmt(curr)}</td>
      {compare && (
        <>
          <td className="px-4 py-2.5 text-right font-mono font-bold text-gray-400 text-sm">PKR {fmt(prev ?? 0)}</td>
          <td className={`px-4 py-2.5 text-right font-mono text-xs ${d >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {d >= 0 ? '+' : ''}{fmt(d)}&nbsp;({d >= 0 ? '+' : ''}{pct}%)
          </td>
        </>
      )}
    </tr>
  )
}

function NetRow({ label, curr, prev, compare }) {
  const isProfit = curr >= 0
  const d   = compare ? r2(curr - (prev || 0)) : 0
  const pct = compare && prev ? Math.round((d / Math.abs(prev)) * 100) : 0
  return (
    <tr className={`border-t-2 ${isProfit ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
      <td className={`px-4 py-3.5 font-extrabold text-sm uppercase tracking-wide ${isProfit ? 'text-green-900' : 'text-red-900'}`}>
        {label}
      </td>
      <td className={`px-4 py-3.5 text-right font-mono font-extrabold text-sm ${isProfit ? 'text-green-700' : 'text-red-700'}`}>
        PKR {fmt(curr)}
      </td>
      {compare && (
        <>
          <td className={`px-4 py-3.5 text-right font-mono font-bold text-sm ${(prev ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            PKR {fmt(prev ?? 0)}
          </td>
          <td className={`px-4 py-3.5 text-right font-mono text-xs ${d >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {d >= 0 ? '+' : ''}{fmt(d)}&nbsp;({d >= 0 ? '+' : ''}{pct}%)
          </td>
        </>
      )}
    </tr>
  )
}

// ── PLTable ───────────────────────────────────────────────────────────────────

function PLTable({ data, prevData, compare }) {
  const TH = ({ children, right }) => (
    <th className={`px-4 py-3 text-xs font-bold uppercase tracking-wide text-white ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[520px]">
          <thead className="bg-navy">
            <tr>
              <TH>Description</TH>
              <TH right>Current Period</TH>
              {compare && <><TH right>Previous Period</TH><TH right>Change</TH></>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <SectionRow title="Income" compare={compare} />
            <DataRow label="Client Receipts"              curr={data.clientReceipts}   prev={prevData?.clientReceipts}   indent compare={compare} />
            <DataRow label="Commission Earned (Airlines)" curr={data.commissionEarned}  prev={prevData?.commissionEarned} indent compare={compare} />
            <DataRow label="Other / Manual Income"        curr={data.otherIncome}       prev={prevData?.otherIncome}      indent compare={compare} />
            <SubtotalRow label="Total Income"             curr={data.totalIncome}       prev={prevData?.totalIncome}      compare={compare} />

            <SectionRow title="Direct Costs" compare={compare} />
            <DataRow label="CASS / Airline Payments"    curr={data.cassPayments}     prev={prevData?.cassPayments}     indent compare={compare} />
            <DataRow label="Form E Supplier Payments"   curr={data.formEPayments}    prev={prevData?.formEPayments}    indent compare={compare} />
            <DataRow label="Clearing Agent Payments"    curr={data.clearingPayments} prev={prevData?.clearingPayments} indent compare={compare} />
            <SubtotalRow label="Total Direct Costs"     curr={data.directCosts}      prev={prevData?.directCosts}      compare={compare} />

            <NetRow label={data.grossProfit >= 0 ? 'Gross Profit' : 'Gross Loss'}
              curr={data.grossProfit} prev={prevData?.grossProfit} compare={compare} />

            <SectionRow title="Operating Expenses" compare={compare} />
            <DataRow label="Salaries"              curr={data.salaries}    prev={prevData?.salaries}    indent compare={compare} />
            <DataRow label="Rent"                  curr={data.rent}        prev={prevData?.rent}        indent compare={compare} />
            <DataRow label="Utilities"             curr={data.utilities}   prev={prevData?.utilities}   indent compare={compare} />
            <DataRow label="Other Office Expenses" curr={data.otherOffice} prev={prevData?.otherOffice} indent compare={compare} />
            <SubtotalRow label="Total Operating Expenses" curr={data.opExpenses} prev={prevData?.opExpenses} compare={compare} />

            <NetRow label={data.operatingProfit >= 0 ? 'Net Profit' : 'Net Loss'}
              curr={data.operatingProfit} prev={prevData?.operatingProfit} compare={compare} />
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── NetCard ───────────────────────────────────────────────────────────────────

function NetCard({ label, value, color }) {
  const c = {
    green:  'bg-green-50  border-green-200  text-green-900  [&_.val]:text-green-700',
    red:    'bg-red-50    border-red-200    text-red-900    [&_.val]:text-red-700',
    blue:   'bg-blue-50   border-blue-200   text-blue-900   [&_.val]:text-blue-700',
  }
  const sign = value < 0 ? '−' : ''
  return (
    <div className={`border rounded-xl p-4 ${c[color] ?? c.blue}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="val font-mono font-bold text-lg leading-tight">
        {sign}PKR {fmt(Math.abs(value))}
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PRESETS = [
  ['thisMonth',   'This Month'],
  ['lastMonth',   'Last Month'],
  ['thisQuarter', 'This Quarter'],
  ['thisYear',    'This Year'],
  ['custom',      'Custom'],
]

const PRESET_FN = {
  thisMonth:   thisMonth,
  lastMonth:   lastMonth,
  thisQuarter: thisQuarter,
  thisYear:    thisYear,
}

export default function ProfitLoss() {
  const init = thisMonth()
  const [preset,   setPreset]   = useState('thisMonth')
  const [dateFrom, setDateFrom] = useState(init.from)
  const [dateTo,   setDateTo]   = useState(init.to)
  const [compare,  setCompare]  = useState(false)

  const [data,     setData]     = useState(null)
  const [prevData, setPrevData] = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  function applyPreset(p) {
    setPreset(p)
    if (PRESET_FN[p]) { const r = PRESET_FN[p](); setDateFrom(r.from); setDateTo(r.to) }
  }

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError(null)
    try {
      const curr = await fetchPL(dateFrom, dateTo)
      setData(curr)
      if (compare) {
        const prev = prevPeriod(dateFrom, dateTo)
        setPrevData(await fetchPL(prev.from, prev.to))
      } else {
        setPrevData(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, compare])

  useEffect(() => { load() }, [load])

  const prev = prevPeriod(dateFrom, dateTo)

  if (!supabase) return <div className="p-6 text-danger text-sm">Supabase not configured.</div>

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Profit &amp; Loss</h1>
          <p className="text-sm text-gray-500 mt-0.5">Period income, direct costs &amp; net profit</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => data && exportCSV(data, prevData, dateFrom, dateTo)}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button variant="secondary" onClick={() => data && printPL(data, prevData, dateFrom, dateTo, prev.from, prev.to)}>
            <Printer className="w-4 h-4" /> Print
          </Button>
        </div>
      </div>

      {/* Period selector */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Period</label>
              <div className="flex flex-wrap gap-1">
                {PRESETS.map(([p, lbl]) => (
                  <button key={p} onClick={() => applyPreset(p)}
                    className={`px-3 py-1.5 text-xs rounded-md border font-medium transition-colors ${
                      preset === p ? 'bg-navy text-white border-navy' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
              <input type="date" value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPreset('custom') }}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
              <input type="date" value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPreset('custom') }}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-accent" />
                Compare to previous period
              </label>
            </div>
          </div>
          {compare && (
            <p className="mt-2 text-xs text-gray-400">
              Previous period: {fmtDate(prev.from)} – {fmtDate(prev.to)}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="py-10 text-center text-danger text-sm">{error}</div>
      ) : data ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* P&L table */}
          <div className="xl:col-span-2">
            <PLTable data={data} prevData={prevData} compare={compare} />
          </div>

          {/* Summary sidebar */}
          <div className="space-y-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">Summary</div>
            <NetCard label="Total Income"            value={data.totalIncome}      color="blue" />
            <NetCard label="Total Expenses"          value={data.totalExpenses}    color="red" />
            <NetCard label="Gross Profit"            value={data.grossProfit}      color={data.grossProfit      >= 0 ? 'green' : 'red'} />
            <NetCard label="Net Operating Profit"    value={data.operatingProfit}  color={data.operatingProfit  >= 0 ? 'green' : 'red'} />

            {/* Margin indicator */}
            {data.totalIncome > 0 && (
              <div className="border rounded-xl p-4 bg-white">
                <p className="text-xs font-medium text-gray-500 mb-2">Profit Margin</p>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${data.operatingProfit >= 0 ? 'bg-green-500' : 'bg-red-400'}`}
                    style={{ width: `${Math.max(0, Math.min(100, Math.abs(data.operatingProfit) / data.totalIncome * 100))}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-400">0%</span>
                  <span className={`text-xs font-bold ${data.operatingProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {data.operatingProfit >= 0 ? '' : '-'}{Math.round(Math.abs(data.operatingProfit) / data.totalIncome * 100)}%
                  </span>
                </div>
              </div>
            )}

            {compare && prevData && (
              <div className="border rounded-xl p-4 bg-indigo-50 border-indigo-100">
                <p className="text-xs font-medium text-indigo-700 mb-2 uppercase tracking-wide">vs Previous Period</p>
                <div className="space-y-1.5">
                  {[
                    ['Income',  data.totalIncome,     prevData.totalIncome],
                    ['Profit',  data.operatingProfit, prevData.operatingProfit],
                  ].map(([lbl, c, p]) => {
                    const d = r2(c - p)
                    return (
                      <div key={lbl} className="flex justify-between text-xs">
                        <span className="text-indigo-600">{lbl}</span>
                        <span className={`font-mono font-bold ${d >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {d >= 0 ? '+' : ''}PKR {fmt(d)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {data.operatingProfit >= 0 ? (
                <TrendingUp className="w-5 h-5 text-green-500" />
              ) : (
                <TrendingDown className="w-5 h-5 text-red-500" />
              )}
              <span className={`text-sm font-medium ${data.operatingProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {data.operatingProfit >= 0 ? 'Profitable' : 'Running a loss'} this period
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
