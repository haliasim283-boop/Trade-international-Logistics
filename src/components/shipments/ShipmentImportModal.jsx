import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { Upload, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Excel Parser ──────────────────────────────────────────────────────────────

function readExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  // Filter out completely empty rows
  return rows.filter(row => row.some(cell => String(cell).trim() !== ''))
}

// ── CSV Parser ────────────────────────────────────────────────────────────────

function parseCSV(text) {
  text = text.replace(/^﻿/, '') // strip BOM
  const rows = []
  let inQuotes = false
  let field = ''
  let current = []

  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : '\n' // sentinel newline at end

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        current.push(field); field = ''
      } else if (ch === '\n' || ch === '\r') {
        current.push(field); field = ''
        if (current.some(c => c.trim() !== '')) rows.push(current)
        current = []
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++
      } else {
        field += ch
      }
    }
  }
  return rows
}

// ── Date Parser ───────────────────────────────────────────────────────────────

const MONTHS = {
  january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
  july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
}

function parseDate(s) {
  if (!s) return null
  // Excel Date object (from SheetJS cellDates:true)
  if (s instanceof Date && !isNaN(s)) {
    const y = s.getFullYear()
    const m = String(s.getMonth() + 1).padStart(2, '0')
    const d = String(s.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const str = String(s)
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  // "Sunday, 28 December 2025" or "28 December 2025"
  const match = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/)
  if (!match) return null
  const [, day, month, year] = match
  const m = MONTHS[month.toLowerCase()]
  if (!m) return null
  return `${year}-${m}-${String(day).padStart(2, '0')}`
}

// ── Status Mapping ────────────────────────────────────────────────────────────

const STATUS_MAP = {
  shpd:        'SHPD',
  bkd:         'BKD',
  pndng:       'PNDNG',
  'ap-blz':    'AP-BLZ',
  manifested:  'BKD',
  offlioaded:  'OFFLOADED',
  offloaded:   'OFFLOADED',
  ofloaeded:   'OFFLOADED',
  returned:    'PNDNG',
  'no show':   'NO SHOW',
  cncld:       'CNCLD',
  cancelled:   'CNCLD',
}

const SKIP_STATUSES = new Set(['emailed', 'pq-00'])

function mapStatus(raw) {
  if (!raw) return 'PNDNG'
  const key = raw.trim().toLowerCase()
  if (SKIP_STATUSES.has(key)) return null
  return STATUS_MAP[key] ?? 'PNDNG'
}

// ── Row Parser ────────────────────────────────────────────────────────────────

function isCompleteAWB(awb) {
  if (!awb) return false
  const t = awb.trim()
  return t !== '' && !t.endsWith('-')
}

function parseTrackingRows(rows, airlines, clients) {
  const [headerRow, ...dataRows] = rows
  const header = headerRow.map(h => h.trim().toLowerCase())

  const col = name => header.indexOf(name.toLowerCase())

  const iDATE       = col('date')
  const iSTATUS     = col('status')
  const iPREFIX     = col('prefix')
  const iAWB_FULL   = col('column2')   // full AWB like "214-8211-7965" (column I, often hidden)
  const iAWB_SERIAL = col('awb')       // just the serial digits (column H) — fallback
  const iORG        = col('org')
  const iDST        = col('dst')
  const iPCS        = col('pcs')
  const iWGHT       = col('wght')
  const iPARTY      = col('party name')
  const iCOMMENT    = col('comments')

  // Build airline lookup by numeric IATA prefix (first 3 chars of "214-8211")
  const airlineByPrefix = {}
  airlines.forEach(a => {
    if (a.iata_prefix) airlineByPrefix[String(a.iata_prefix).toLowerCase()] = a
  })

  // Build client lookup by name (lowercase)
  const clientByExact = {}
  clients.forEach(c => { clientByExact[c.name.toLowerCase()] = c })

  function matchClient(name) {
    if (!name) return null
    const n = name.trim().toLowerCase()
    if (clientByExact[n]) return clientByExact[n]
    // Partial: DB name contains input or vice-versa
    for (const [key, c] of Object.entries(clientByExact)) {
      if (key.includes(n) || n.includes(key)) return c
    }
    return null
  }

  function matchAirline(prefixStr) {
    if (!prefixStr) return null
    const prefix = prefixStr.split('-')[0].trim().toLowerCase()
    return airlineByPrefix[prefix] ?? null
  }

  const ready     = []  // airline + client matched → can insert
  const unmatched = []  // airline or client not found → needs fix first
  const skipped   = []  // cancelled / incomplete AWB / no date → excluded

  // Helper: safely convert any cell value (string, number, Date) to a trimmed string
  const s = (v) => (v == null ? '' : String(v)).trim()

  dataRows.forEach((row, idx) => {
    // Keep date raw — parseDate handles both Date objects (Excel) and strings (CSV)
    const rawDate = iDATE >= 0 ? row[iDATE] : ''

    const rawStatus = iSTATUS  >= 0 ? s(row[iSTATUS])  : ''
    const prefix    = iPREFIX  >= 0 ? s(row[iPREFIX])  : ''
    const org       = iORG     >= 0 ? s(row[iORG]).toUpperCase().slice(0, 3) : ''
    const dst       = iDST     >= 0 ? s(row[iDST]).toUpperCase().slice(0, 3) : ''
    const party     = iPARTY   >= 0 ? s(row[iPARTY])   : ''
    const comment   = iCOMMENT >= 0 ? s(row[iCOMMENT]) : ''
    const pcs       = iPCS     >= 0 ? Math.round(parseFloat(s(row[iPCS])) || 0) : 0
    const wght      = iWGHT    >= 0 ? parseFloat(s(row[iWGHT])) || 0 : 0

    // Full AWB: prefer Column2 (hidden col I); fall back to PREFIX + AWB serial (col H)
    let awbFull = iAWB_FULL >= 0 ? s(row[iAWB_FULL]) : ''
    if (!isCompleteAWB(awbFull)) {
      const serial = iAWB_SERIAL >= 0 ? s(row[iAWB_SERIAL]) : ''
      if (prefix && serial && serial !== '-') awbFull = `${prefix}-${serial}`
    }

    const reasons = []
    const date = parseDate(rawDate)
    if (!date) reasons.push('No valid date')
    if (!isCompleteAWB(awbFull)) reasons.push('Incomplete AWB number')

    const mappedStatus = mapStatus(rawStatus)
    if (mappedStatus === null) reasons.push(`Cancelled (${rawStatus})`)

    if (reasons.length > 0) {
      skipped.push({ rowNum: idx + 2, date: s(rawDate), awb: awbFull, party, reasons })
      return
    }

    const airline = matchAirline(prefix)
    const client  = matchClient(party)

    const record = {
      rowNum:             idx + 2,
      flight_date:        date,
      awb_number:         awbFull,
      airline_id:         airline?.id ?? null,
      airlineName:        airline?.name ?? `prefix:${prefix.split('-')[0]}`,
      client_id:          client?.id ?? null,
      clientName:         client?.name ?? party,
      clientRaw:          party,
      origin:             org,
      destination:        dst,
      pieces:             pcs,
      chargeable_weight:  wght,
      net_rate:           0,
      clearing_charges:   0,
      idc_tax:            0,
      other_charges:      0,
      awb_self_uploaded:  false,
      form_e_usd_value:   0,
      form_e_pkr_rate:    0,
      form_e_supplier_id: null,
      amendment_charges:  0,
      cass_airline_rate:  0,
      clearing_agent_id:  null,
      status:             mappedStatus,
      notes:              comment || null,
    }

    if (record.airline_id && record.client_id) {
      ready.push(record)
    } else {
      const missing = []
      if (!record.airline_id) missing.push(`unknown airline prefix "${prefix.split('-')[0]}"`)
      if (!record.client_id)  missing.push(`unknown client "${party || '(blank)'}"`)
      unmatched.push({ ...record, missing })
    }
  })

  return { ready, unmatched, skipped }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShipmentImportModal({ airlines, clients, onImported, onClose }) {
  const [step,        setStep]        = useState('upload') // upload | preview | done
  const [dragOver,    setDragOver]    = useState(false)
  const [parsed,      setParsed]      = useState(null)
  const [importing,   setImporting]   = useState(false)
  const [result,      setResult]      = useState(null)
  const [showSkipped, setShowSkipped] = useState(false)
  const [error,       setError]       = useState(null)
  const fileRef = useRef()

  const processFile = useCallback((file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    setError(null)

    function finish(rows) {
      if (rows.length < 2) { setError('File appears to be empty or has no data rows.'); return }
      const result = parseTrackingRows(rows, airlines, clients)
      setParsed(result)
      setStep('preview')
    }

    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader()
      reader.onload = (e) => {
        try { finish(readExcel(e.target.result)) }
        catch (err) { setError('Error reading Excel file: ' + err.message) }
      }
      reader.readAsArrayBuffer(file)
    } else if (ext === 'csv') {
      const reader = new FileReader()
      reader.onload = (e) => {
        try { finish(parseCSV(e.target.result)) }
        catch (err) { setError('Error reading CSV file: ' + err.message) }
      }
      reader.readAsText(file, 'utf-8')
    } else {
      setError('Please upload a .xlsx or .csv file.')
    }
  }, [airlines, clients])

  function onFileChange(e) { processFile(e.target.files[0]) }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    processFile(e.dataTransfer.files[0])
  }

  async function handleImport() {
    if (!parsed?.ready?.length) return
    setImporting(true)

    const payload = parsed.ready.map(r => ({
      flight_date:        r.flight_date,
      awb_number:         r.awb_number,
      airline_id:         r.airline_id,
      client_id:          r.client_id,
      origin:             r.origin,
      destination:        r.destination,
      pieces:             r.pieces,
      chargeable_weight:  r.chargeable_weight,
      net_rate:           r.net_rate,
      clearing_charges:   r.clearing_charges,
      idc_tax:            r.idc_tax,
      other_charges:      r.other_charges,
      awb_self_uploaded:  r.awb_self_uploaded,
      form_e_usd_value:   r.form_e_usd_value,
      form_e_pkr_rate:    r.form_e_pkr_rate,
      form_e_supplier_id: r.form_e_supplier_id,
      amendment_charges:  r.amendment_charges,
      cass_airline_rate:  r.cass_airline_rate,
      clearing_agent_id:  r.clearing_agent_id,
      status:             r.status,
      notes:              r.notes,
      updated_at:         new Date().toISOString(),
    }))

    let inserted = 0
    let skippedDupes = 0
    const errors = []
    const CHUNK  = 100
    for (let i = 0; i < payload.length; i += CHUNK) {
      const chunk = payload.slice(i, i + CHUNK)
      const { data, error } = await supabase
        .from('shipments')
        .upsert(chunk, { onConflict: 'awb_number', ignoreDuplicates: true })
        .select('id')
      if (error) errors.push(error.message)
      else {
        inserted     += data?.length ?? 0
        skippedDupes += chunk.length - (data?.length ?? 0)
      }
    }

    setResult({ inserted, skippedDupes, skippedUnmatched: parsed.unmatched.length, errors })
    setImporting(false)
    setStep('done')
    if (inserted > 0) onImported()
  }

  const unmatchedClients  = parsed ? [...new Set(parsed.unmatched.filter(r => !r.client_id).map(r => r.clientRaw).filter(Boolean))] : []
  const unmatchedAirlines = parsed ? [...new Set(parsed.unmatched.filter(r => !r.airline_id).map(r => r.airlineName).filter(Boolean))] : []

  return (
    <Modal title="Import Shipments from Excel" onClose={onClose} size="xl">

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Upload your tracking sheet directly as an Excel file. The importer recognises your standard format with columns:
            <span className="font-mono text-xs ml-1 text-gray-500">DATE · STATUS · PREFIX · AWB · ORG · DST · PCS · WGHT · PARTY NAME · COMMENTS</span>
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div
            className={`border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-accent bg-accent/5' : 'border-gray-300 hover:border-accent/50 hover:bg-gray-50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current.click()}
          >
            <Upload className="w-10 h-10 mx-auto mb-3 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">Drop your Excel file here</p>
            <p className="text-xs text-gray-400 mt-1">or click to browse</p>
            <p className="text-xs text-gray-300 mt-3">Accepts .xlsx · .xls · .csv</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
          </div>
        </div>
      )}

      {/* ── Step 2: Preview ── */}
      {step === 'preview' && parsed && (
        <div className="space-y-4">

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">{parsed.ready.length} ready</p>
                <p className="text-xs text-green-600">Will be imported</p>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">{parsed.unmatched.length} need attention</p>
                <p className="text-xs text-amber-600">Unknown airline or client</p>
              </div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-3">
              <XCircle className="w-5 h-5 text-gray-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-700">{parsed.skipped.length} skipped</p>
                <p className="text-xs text-gray-500">Cancelled or no AWB/date</p>
              </div>
            </div>
          </div>

          {/* Unmatched explanation */}
          {(unmatchedClients.length > 0 || unmatchedAirlines.length > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-xs font-semibold text-amber-800">
                  These {parsed.unmatched.length} rows cannot be imported — add the missing names to Party Management first, then re-upload:
                </span>
              </div>
              {unmatchedClients.length > 0 && (
                <p className="text-xs text-amber-700 pl-6">
                  <span className="font-medium">Unknown clients:</span> {unmatchedClients.join(' · ')}
                </p>
              )}
              {unmatchedAirlines.length > 0 && (
                <p className="text-xs text-amber-700 pl-6">
                  <span className="font-medium">Unknown airline prefixes:</span> {unmatchedAirlines.join(' · ')}
                </p>
              )}
            </div>
          )}

          {/* Preview table */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Ready to import{parsed.ready.length > 50 ? ' (first 50 shown)' : ''}
              </span>
              {(parsed.unmatched.length > 0 || parsed.skipped.length > 0) && (
                <button
                  className="text-xs text-accent hover:underline"
                  onClick={() => setShowSkipped(s => !s)}
                >
                  {showSkipped ? 'Hide skipped/unmatched' : `Show skipped & unmatched (${parsed.unmatched.length + parsed.skipped.length})`}
                </button>
              )}
            </div>
            <div className="overflow-auto max-h-72">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">Date</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">AWB</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Airline</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Client</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Route</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">KGS</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {parsed.ready.slice(0, 50).map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{r.flight_date}</td>
                      <td className="px-3 py-1.5 font-mono text-navy font-semibold">{r.awb_number}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.airlineName}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.clientName}</td>
                      <td className="px-3 py-1.5 font-mono text-gray-600">{r.origin}→{r.destination}</td>
                      <td className="px-3 py-1.5 text-right text-gray-700">{r.chargeable_weight}</td>
                      <td className="px-3 py-1.5">
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{r.status}</span>
                      </td>
                    </tr>
                  ))}
                  {showSkipped && parsed.unmatched.map((r, i) => (
                    <tr key={`um-${i}`} className="bg-amber-50/50">
                      <td className="px-3 py-1.5 whitespace-nowrap text-amber-700">{r.flight_date}</td>
                      <td className="px-3 py-1.5 font-mono text-amber-700">{r.awb_number}</td>
                      <td colSpan={4} className="px-3 py-1.5 text-amber-600 italic">
                        ⚠ {r.missing.join(', ')}
                      </td>
                      <td />
                    </tr>
                  ))}
                  {showSkipped && parsed.skipped.map((r, i) => (
                    <tr key={`skip-${i}`} className="bg-gray-50/80">
                      <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{r.date}</td>
                      <td className="px-3 py-1.5 text-gray-400 font-mono">{r.awb || '—'}</td>
                      <td colSpan={4} className="px-3 py-1.5 text-gray-400 italic">
                        {r.reasons.join(', ')}
                      </td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {parsed.ready.length > 50 && (
            <p className="text-center text-xs text-gray-400">
              … and {parsed.ready.length - 50} more ready rows not shown
            </p>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <button onClick={() => { setStep('upload'); setParsed(null) }}
              className="text-sm text-gray-500 hover:text-gray-700 underline">
              ← Choose different file
            </button>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={handleImport} disabled={importing || parsed.ready.length === 0}>
                {importing && <Spinner size="sm" />}
                Import {parsed.ready.length} Shipments
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Done ── */}
      {step === 'done' && result && (
        <div className="py-8 text-center space-y-4">
          <CheckCircle className="w-14 h-14 text-green-500 mx-auto" />
          <div>
            <p className="text-xl font-bold text-gray-800">{result.inserted} shipments imported</p>
            <p className="text-sm text-gray-500 mt-1">They are now visible in the Master Shipment Log.</p>
            {result.skippedDupes > 0 && (
              <p className="text-sm text-blue-600 mt-2">
                {result.skippedDupes} already existed (same AWB number) — skipped, no duplicates created.
              </p>
            )}
            {result.skippedUnmatched > 0 && (
              <p className="text-sm text-amber-600 mt-2">
                {result.skippedUnmatched} rows skipped — add the missing clients/airlines to Party Management, then re-upload.
              </p>
            )}
            {result.errors.length > 0 && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 text-left">
                <strong>{result.errors.length} batch error(s):</strong> {result.errors.join('; ')}
              </div>
            )}
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>
      )}

    </Modal>
  )
}
