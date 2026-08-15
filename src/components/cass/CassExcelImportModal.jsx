import { useState, useRef, useCallback } from 'react'
import { Upload, CheckCircle, AlertTriangle, XCircle, FileSpreadsheet } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { supabase } from '../../lib/supabase'
import {
  readSheetRows, parseCassExcel, matchToShipments, awbLookupVariants, chunk,
} from '../../lib/cassExcelImport'

function fmt(n) {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Signed display: negatives in brackets, the way the rest of the CASS page shows them.
function fmtSigned(n) {
  if (n === null || n === undefined) return '—'
  return n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n)
}

const SHIPMENT_COLS =
  'id,awb_number,flight_date,chargeable_weight,net_rate,freight_amount,' +
  'cass_airline_rate,pkr_exchange_rate,other_charges_due_airline,cass_pluss_dipp,' +
  'airlines(name,iata_prefix),clients(name)'

// Looks up every AWB in the sheet. The stored column is free text, so each AWB
// is queried under all the spellings it plausibly has (dashes, spaces, none).
async function fetchShipmentsForAwbs(rows) {
  const variants = [...new Set(rows.flatMap((r) => awbLookupVariants(r.awb)))]
  const found = []
  for (const batch of chunk(variants, 250)) {
    const { data, error } = await supabase
      .from('shipments')
      .select(SHIPMENT_COLS)
      .in('awb_number', batch)
    if (error) throw new Error(error.message)
    found.push(...(data ?? []))
  }
  return found
}

export function CassExcelImportModal({ onClose, onImported }) {
  const [step,     setStep]     = useState('upload')   // upload | preview | done
  const [dragOver, setDragOver] = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState(null)
  const [fileName, setFileName] = useState('')
  const [result,   setResult]   = useState(null)       // { matched, unmatched, skipped, sheetsRead }
  const [saved,    setSaved]    = useState(0)
  const fileRef = useRef()

  const processFile = useCallback(async (file) => {
    if (!file) return
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) {
      setError('Please upload the CASS sales report as .xlsx, .xls or .csv.')
      return
    }
    setError(null); setBusy(true); setFileName(file.name)
    try {
      const sheets = readSheetRows(await file.arrayBuffer())
      const parsed = parseCassExcel(sheets)

      if (parsed.sheetsRead === 0) {
        setError(
          'No sheet in this file has both an AWB column and a "PLUSS DIPP" column. ' +
          'Check the header row is intact and the columns are named as in the CASS sales report.',
        )
        setBusy(false); return
      }
      if (parsed.rows.length === 0) {
        setError('The header row was found but no AWB lines carried a Pluss Dipp value.')
        setBusy(false); return
      }

      const shipments = await fetchShipmentsForAwbs(parsed.rows)
      const { matched, unmatched } = matchToShipments(parsed.rows, shipments)

      setResult({ matched, unmatched, skipped: parsed.skipped, sheetsRead: parsed.sheetsRead })
      setStep('preview')
    } catch (err) {
      setError('Could not read the file: ' + err.message)
    }
    setBusy(false)
  }, [])

  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    if (!busy) processFile(e.dataTransfer.files[0])
  }

  // Only rows whose value actually differs are written, so re-running the same
  // import is a no-op rather than a few hundred pointless updates.
  const toWrite = result?.matched.filter((m) => m.changed) ?? []

  async function handleImport() {
    setBusy(true); setError(null)
    const stamp = new Date().toISOString()
    let done = 0
    try {
      for (const batch of chunk(toWrite, 20)) {
        const results = await Promise.all(batch.map((m) =>
          supabase
            .from('shipments')
            .update({ cass_pluss_dipp: m.plussDipp, cass_pluss_dipp_imported_at: stamp })
            .eq('id', m.shipment.id),
        ))
        const failed = results.find((r) => r.error)
        if (failed) throw new Error(failed.error.message)
        done += batch.length
        setSaved(done)
      }
      setStep('done')
      onImported?.()
    } catch (err) {
      setError(`Saved ${done} of ${toWrite.length} rows, then failed: ${err.message}`)
    }
    setBusy(false)
  }

  return (
    <Modal title="Import CASS Sales Report (Excel)" onClose={onClose} size="xl">

      {/* ── Step 1: upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Upload the IATA <span className="font-medium">Cargo Sales Report</span> spreadsheet. Its
            AWB numbers are matched against shipments already in the system and the{' '}
            <span className="font-medium">PLUSS DIPP</span> amount is stored against each match, so the
            CASS page can show it beside the Minus Other figure the app calculates itself.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div
            className={`border-2 border-dashed rounded-xl p-14 text-center transition-colors ${
              busy ? 'border-gray-200 bg-gray-50 cursor-wait'
                   : dragOver ? 'border-accent bg-accent/5 cursor-pointer'
                   : 'border-gray-300 hover:border-accent/50 hover:bg-gray-50 cursor-pointer'
            }`}
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => { if (!busy) fileRef.current.click() }}
          >
            {busy ? (
              <>
                <Spinner size="lg" />
                <p className="text-sm font-medium text-gray-600 mt-3">Reading sheet and matching AWBs…</p>
              </>
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto mb-3 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">Drop the sales report spreadsheet here</p>
                <p className="text-xs text-gray-400 mt-1">or click to browse — .xlsx, .xls, .csv</p>
                <p className="text-xs text-gray-300 mt-3">Nothing is saved until you confirm on the next screen</p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" className="hidden"
              onChange={(e) => processFile(e.target.files[0])} />
          </div>

          <div className="text-xs text-gray-400 space-y-1">
            <p className="font-medium text-gray-500">Columns read from the sheet:</p>
            <p>
              <span className="font-mono">AWB NMBR</span>, <span className="font-mono">PLUSS DIPP</span> (required) ·{' '}
              <span className="font-mono">DATE</span>, <span className="font-mono">ORG</span>,{' '}
              <span className="font-mono">DST</span>, <span className="font-mono">WGHT</span>,{' '}
              <span className="font-mono">NET AMOUNT</span>, <span className="font-mono">PARTY</span> (shown for checking only)
            </p>
            <p>Everything else in the sheet is ignored.</p>
          </div>
        </div>
      )}

      {/* ── Step 2: preview ── */}
      {step === 'preview' && result && (
        <div className="space-y-4">

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatTile label="Matched"   value={result.matched.length}   tone="green" />
            <StatTile label="To update" value={toWrite.length}          tone="blue" />
            <StatTile label="No shipment" value={result.unmatched.length} tone={result.unmatched.length ? 'amber' : 'gray'} />
            <StatTile label="Rows skipped" value={result.skipped.length} tone={result.skipped.length ? 'amber' : 'gray'} />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {result.matched.length === 0 ? (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                None of the AWBs in <span className="font-medium">{fileName}</span> exist in the system yet.
                Add the shipments first, then import again.
              </p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Matched AWBs
                </span>
                <span className="text-xs text-gray-400">
                  Diff = Pluss Dipp − Net Amount · Profit = Freight − Pluss Dipp
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white sticky top-0 shadow-sm">
                    <tr className="text-gray-500">
                      <th className="text-left  px-3 py-1.5 font-medium">AWB</th>
                      <th className="text-left  px-3 py-1.5 font-medium">Client</th>
                      <th className="text-right px-3 py-1.5 font-medium">Net Amount</th>
                      <th className="text-right px-3 py-1.5 font-medium">Pluss Dipp</th>
                      <th className="text-right px-3 py-1.5 font-medium">Diff</th>
                      <th className="text-right px-3 py-1.5 font-medium">Profit</th>
                      <th className="text-left  px-3 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {result.matched.map((m) => (
                      <tr key={m.key} className={m.changed ? '' : 'text-gray-400'}>
                        <td className="px-3 py-1.5 font-mono text-navy">{m.shipment.awb_number}</td>
                        <td className="px-3 py-1.5 text-gray-600 truncate max-w-[140px]">
                          {m.shipment.clients?.name || m.party || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {m.hasCassRate ? fmt(m.systemNet) : <span className="text-gray-300">no rate</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-navy">{fmt(m.plussDipp)}</td>
                        <td className={`px-3 py-1.5 text-right font-mono ${
                          m.diff === null ? 'text-gray-300' : m.diff < 0 ? 'text-green-600' : 'text-amber-700'
                        }`}>
                          {fmtSigned(m.diff)}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-mono ${
                          m.profit < 0 ? 'text-danger' : 'text-green-700'
                        }`}>
                          {fmtSigned(m.profit)}
                        </td>
                        <td className="px-3 py-1.5">
                          {!m.changed
                            ? <span className="text-gray-400">unchanged</span>
                            : m.alreadySet
                              ? <span className="text-amber-700">overwrite {fmt(m.shipment.cass_pluss_dipp)}</span>
                              : <span className="text-green-700">new</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.unmatched.length > 0 && (
            <details className="border border-amber-200 bg-amber-50 rounded-lg">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-amber-800">
                {result.unmatched.length} AWB(s) in the sheet have no shipment in the system — these are left alone
              </summary>
              <div className="px-3 pb-3 max-h-40 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <tbody>
                    {result.unmatched.map((u) => (
                      <tr key={u.key} className="text-amber-900">
                        <td className="py-0.5 font-mono">{u.awb}</td>
                        <td className="py-0.5 pl-3">{u.party || ''}</td>
                        <td className="py-0.5 pl-3">{u.origin && u.dest ? `${u.origin}→${u.dest}` : ''}</td>
                        <td className="py-0.5 pl-3 text-right font-mono">{fmt(u.plussDipp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {result.skipped.length > 0 && (
            <details className="border border-gray-200 rounded-lg">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-500">
                {result.skipped.length} sheet row(s) skipped
              </summary>
              <div className="px-3 pb-3 max-h-40 overflow-y-auto text-[11px] text-gray-500">
                {result.skipped.map((s, i) => (
                  <p key={i} className="py-0.5">
                    <span className="font-mono">{s.sheet}!row {s.row}</span>
                    {s.awb ? ` · ${s.awb}` : ''} — {s.reason}
                  </p>
                ))}
              </div>
            </details>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <button
              onClick={() => { setStep('upload'); setResult(null); setError(null) }}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
              disabled={busy}
            >
              ← Choose a different file
            </button>
            <div className="flex gap-3 items-center">
              {busy && <span className="text-xs text-gray-500">Saving {saved}/{toWrite.length}…</span>}
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={handleImport} disabled={busy || toWrite.length === 0}>
                <FileSpreadsheet className="w-4 h-4" />
                {toWrite.length === 0 ? 'Nothing to import' : `Import ${toWrite.length} AWB${toWrite.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: done ── */}
      {step === 'done' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
            <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-green-800">
                Pluss Dipp saved for {saved} AWB{saved !== 1 ? 's' : ''}
              </p>
              <p className="text-green-700 text-xs mt-0.5">
                The Pluss Dipp, Diff and Profit columns now show these figures on the CASS report for
                whichever airline and period each AWB falls into.
              </p>
            </div>
          </div>
          {result?.unmatched.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <XCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                {result.unmatched.length} AWB(s) from the sheet were not in the system and were skipped.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button
              onClick={() => { setStep('upload'); setResult(null); setSaved(0); setError(null) }}
              className="text-sm text-gray-500 hover:text-gray-700 underline mr-auto"
            >
              Import another file
            </button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function StatTile({ label, value, tone }) {
  const tones = {
    green: 'border-green-200 bg-green-50 text-green-800',
    blue:  'border-blue-200  bg-blue-50  text-blue-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    gray:  'border-gray-100  bg-gray-50  text-gray-400',
  }
  return (
    <div className={`border rounded-lg px-3 py-2 ${tones[tone] ?? tones.gray}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="font-mono font-bold text-lg leading-tight">{value}</p>
    </div>
  )
}
