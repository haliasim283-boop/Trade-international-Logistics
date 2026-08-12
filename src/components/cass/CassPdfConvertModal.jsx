import { useState, useRef, useCallback } from 'react'
import { Upload, CheckCircle, AlertTriangle, Download, FileText } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { linesFromTextContent, parseCassReport, reconcile } from '../../lib/cassPdfParser'
import { downloadCassWorkbook } from '../../lib/cassPdfExcel'

// Bundled by Vite as a same-origin asset, so it loads under the app's
// script-src 'self' CSP (a CDN worker URL would be blocked).
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function readCassPdf(file) {
  const buf = await file.arrayBuffer()
  // isEvalSupported:false keeps pdf.js off Function()/eval, which the app's
  // Content-Security-Policy (no 'unsafe-eval') would block.
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
  }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc   = await page.getTextContent()
    pages.push(linesFromTextContent(tc, page.getViewport({ scale: 1 })))
  }
  const parsed = parseCassReport(pages)
  return { parsed, check: reconcile(parsed) }
}

export function CassPdfConvertModal({ onClose }) {
  const [step,     setStep]     = useState('upload')  // upload | done
  const [dragOver, setDragOver] = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState(null)
  const [result,   setResult]   = useState(null)
  const fileRef = useRef()

  const processFile = useCallback(async (file) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload the CASS Cargo Sales Report PDF.')
      return
    }
    setError(null); setBusy(true)
    try {
      const r = await readCassPdf(file)
      if (r.parsed.awbRows.length === 0) {
        setError(
          'No AWB rows found. This does not look like a CASSLink "Cargo Sales Report" PDF — ' +
          'check you uploaded the full report rather than a single statement page.',
        )
        setBusy(false)
        return
      }
      setResult(r)
      setStep('done')
    } catch (err) {
      setError('Could not read the PDF: ' + err.message)
    }
    setBusy(false)
  }, [])

  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    processFile(e.dataTransfer.files[0])
  }

  const parsed = result?.parsed
  const check  = result?.check

  return (
    <Modal title="Convert CASS PDF to Excel" onClose={onClose} size="xl">

      {/* ── Step 1: upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Upload the fortnightly <span className="font-medium">Cargo Sales Report</span> PDF from IATA CASSLink.
            Every AWB line across all airlines is extracted into an Excel workbook, along with the
            per-airline billing summary, other-charges breakdown and the BTA adjustment.
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
            onDrop={(e) => { if (!busy) onDrop(e) }}
            onClick={() => { if (!busy) fileRef.current.click() }}
          >
            {busy ? (
              <>
                <Spinner size="lg" />
                <p className="text-sm font-medium text-gray-600 mt-3">Reading PDF…</p>
              </>
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto mb-3 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">Drop the CASS report PDF here</p>
                <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                <p className="text-xs text-gray-300 mt-3">Processed entirely in your browser — nothing is uploaded</p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".pdf" className="hidden"
              onChange={(e) => processFile(e.target.files[0])} />
          </div>
        </div>
      )}

      {/* ── Step 2: result ── */}
      {step === 'done' && parsed && (
        <div className="space-y-4">

          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-3">
            <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-green-800">
                {parsed.awbRows.length} AWB rows extracted across {parsed.airlineSummary.length} airlines
              </p>
              <p className="text-green-700 text-xs mt-0.5">
                Billing period {parsed.meta.period_start} to {parsed.meta.period_end}
                {parsed.meta.remittance_date && ` · remittance ${parsed.meta.remittance_date}`}
              </p>
            </div>
          </div>

          {/* Reconciliation against the totals CASS printed itself */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Checked against the report's own totals
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="text-left  px-3 py-1.5 font-medium">Airline</th>
                  <th className="text-right px-3 py-1.5 font-medium">AWBs</th>
                  <th className="text-right px-3 py-1.5 font-medium">Extracted total</th>
                  <th className="text-right px-3 py-1.5 font-medium">CASS stated</th>
                  <th className="text-center px-3 py-1.5 font-medium">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {check.checks.map((c) => (
                  <tr key={c.airline_prefix}>
                    <td className="px-3 py-1.5 text-gray-700">{c.airline_prefix} {c.airline_code}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-600">{c.awb_count}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-700">{fmt(c.parsed_payable)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-700">{fmt(c.stated_payable)}</td>
                    <td className="px-3 py-1.5 text-center">
                      {c.ok
                        ? <CheckCircle className="w-4 h-4 text-green-600 inline" />
                        : <span className="text-danger text-xs font-semibold">off by {fmt(c.difference)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!check.allOk && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Some airline totals don't match the figures printed in the PDF, so a row may have been
                misread. Check the highlighted airlines against the PDF before using the Excel file.
              </p>
            </div>
          )}

          {parsed.unparsed.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                <p className="font-semibold mb-1">{parsed.unparsed.length} line(s) looked like AWB rows but could not be read:</p>
                {parsed.unparsed.slice(0, 5).map((u, i) => (
                  <p key={i} className="font-mono text-[11px] truncate">p{u.page}: {u.line}</p>
                ))}
              </div>
            </div>
          )}

          {/* Sheets the workbook will contain */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <SheetTile label="AWB Detail"        count={`${parsed.awbRows.length} rows`} />
            <SheetTile label="Airline Summary"   count={`${parsed.airlineSummary.length} airlines`} />
            <SheetTile label="Other Charges"     count={parsed.otherCharges.length ? `${parsed.otherCharges.length} AWBs` : 'none'} muted={!parsed.otherCharges.length} />
            <SheetTile label="Adjustments (BTA)" count={parsed.adjustments.length ? fmt(parsed.adjustments.reduce((s, a) => s + a.amount, 0)) : 'none'} muted={!parsed.adjustments.length} />
          </div>

          {parsed.paymentSummary?.total_payable != null && (
            <div className="flex items-center justify-between bg-navy text-white rounded-lg px-4 py-3">
              <span className="text-sm font-semibold">Total Payable (all airlines + BTA)</span>
              <span className="font-mono font-bold text-lg">PKR {fmt(parsed.paymentSummary.total_payable)}</span>
            </div>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <button
              onClick={() => { setStep('upload'); setResult(null) }}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              ← Convert a different PDF
            </button>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>Close</Button>
              <Button onClick={() => downloadCassWorkbook(parsed)}>
                <Download className="w-4 h-4" /> Download Excel
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function SheetTile({ label, count, muted }) {
  return (
    <div className={`border rounded-lg px-3 py-2 ${muted ? 'border-gray-100 bg-gray-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-1.5">
        <FileText className={`w-3.5 h-3.5 ${muted ? 'text-gray-300' : 'text-accent'}`} />
        <span className={`font-medium ${muted ? 'text-gray-400' : 'text-gray-700'}`}>{label}</span>
      </div>
      <p className={`mt-0.5 font-mono ${muted ? 'text-gray-300' : 'text-gray-500'}`}>{count}</p>
    </div>
  )
}
