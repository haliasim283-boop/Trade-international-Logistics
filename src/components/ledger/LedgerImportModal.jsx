import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { Upload, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── File readers (same approach as ShipmentImportModal) ──────────────────────

// NOTE: intentionally NOT using cellDates:true — SheetJS's own Excel-serial-to-
// Date conversion is timezone-dependent internally and silently rolls dates
// back a day in timezones ahead of UTC. Reading raw numeric serials and
// converting them ourselves (see excelSerialToUTCDate below) is reliable.
function readExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  return rows.filter(row => row.some(cell => String(cell).trim() !== ''))
}

function parseCSV(text) {
  text = text.replace(/^﻿/, '')
  const rows = []
  let inQuotes = false
  let field = ''
  let current = []
  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : '\n'
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { current.push(field); field = '' }
      else if (ch === '\n' || ch === '\r') {
        current.push(field); field = ''
        if (current.some(c => c.trim() !== '')) rows.push(current)
        current = []
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++
      } else field += ch
    }
  }
  return rows
}

// ── Date parsing (same as ShipmentImportModal) ────────────────────────────────

const MONTHS = {
  january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
  july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
  jan:'01', feb:'02', mar:'03', apr:'04', jun:'06',
  jul:'07', aug:'08', sep:'09', sept:'09', oct:'10', nov:'11', dec:'12',
}

// Excel's date serial is days since 1899-12-30. Converting it via SheetJS's
// own Date-object machinery (cellDates:true) is timezone-dependent and can
// silently roll the date back a day — so we convert the raw serial ourselves.
function excelSerialToUTCDate(serial) {
  const utcDays = Math.floor(serial) - 25569 // 25569 = days between 1899-12-30 and the 1970-01-01 UNIX epoch
  return new Date(utcDays * 86400 * 1000)
}

function parseDate(s) {
  if (s === null || s === undefined || s === '') return null
  if (typeof s === 'number' && s > 1000) {
    const d = excelSerialToUTCDate(s)
    const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  if (s instanceof Date && !isNaN(s)) {
    const y = s.getUTCFullYear(), m = String(s.getUTCMonth() + 1).padStart(2, '0'), d = String(s.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const str = String(s)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  // "Sunday, 28 December 2025", "28 December 2025", or "5-Jun-2026" (spaces or hyphens, full or abbreviated month)
  const match = str.match(/(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{4})/)
  if (match) {
    const [, day, month, year] = match
    const m = MONTHS[month.toLowerCase()]
    if (m) return `${year}-${m}-${String(day).padStart(2, '0')}`
  }
  // M/D/YYYY or D/M/YYYY numeric slash formats
  const slash = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const [, a, b, year] = slash
    return `${year}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`
  }
  return null
}

// ── Bank / payment-method detection from free-text description ───────────────

const BANK_KEYWORDS = [
  ['sindh',  'Sindh Bank'],
  ['bahl',   'Bank Al Habib'],
  ['habib',  'Bank Al Habib'],
  ['hmb',    'HMB'],
  ['habib metro', 'HMB'],
  ['hbl',    'HBL'],
  ['bok',    'BOK'],
  ['askari', 'Askari'],
  ['meezan', 'Meezan'],
  ['soneri', 'Soneri'],
]

function detectBank(text) {
  const t = text.toLowerCase()
  for (const [kw, bank] of BANK_KEYWORDS) if (t.includes(kw)) return bank
  return 'Other'
}

function detectMethod(text) {
  const t = text.toLowerCase()
  if (t.includes('raast')) return 'RAAST'
  if (t.includes('cheque') || t.includes('chq')) return 'Cheque'
  if (t.includes('cash')) return 'Cash'
  if (t.includes('remit') || t.includes('foreign') || t.includes('dxb') || t.includes('convert')) return 'Foreign Remittance'
  return 'Bank Transfer'
}

function detectTransactionId(text) {
  const m = text.match(/ref\.?\s*(?:no\.?)?\s*#?\s*([A-Za-z0-9]+)/i)
  return m ? m[1] : null
}

// ── AWB shape check ────────────────────────────────────────────────────────────

function isAwbLike(str) {
  if (!str) return false
  const t = String(str).trim()
  return /^\d[\d\s-]{4,}\d$/.test(t) && /-/.test(t)
}

function normalizeAwb(str) {
  return String(str || '').replace(/[\s]/g, '').trim()
}

function digitsOnly(str) {
  return String(str || '').replace(/\D/g, '')
}

function paymentSignature(date, amount, description) {
  const amt = Math.round(Number(amount || 0) * 100) / 100
  const desc = String(description || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return `${date}|${amt}|${desc}`
}

function matchAirline(awb, airlines) {
  const prefix = String(awb || '').split('-')[0].trim().toLowerCase()
  if (!prefix) return null
  return airlines.find(a => String(a.iata_prefix || '').toLowerCase() === prefix) ?? null
}

// ── Header row detection (skips any leading title/summary rows) ──────────────

function normHeader(h) { return String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, '') }

function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map(normHeader)
    const hasDate = cells.includes('date')
    const hasAwb  = cells.some(c => c.startsWith('awb'))
    if (hasDate && hasAwb) return i
  }
  return -1
}

// ── Row parser ─────────────────────────────────────────────────────────────────

function parseLedgerRows(rows, existingShipments, airlines, existingPayments, existingAdjustments, awbFixedFee) {
  const headerIdx = findHeaderRowIndex(rows)
  if (headerIdx === -1) {
    throw new Error('Could not find a header row with DATE and AWB NO. columns in the first 10 rows of the sheet. Check the file has those column headers.')
  }
  const headerRow = rows[headerIdx]
  const dataRows  = rows.slice(headerIdx + 1)
  const norm = normHeader
  const header = headerRow.map(norm)
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(norm(n))
      if (i >= 0) return i
    }
    return -1
  }

  const iDATE       = col('date')
  const iAWB        = col('awb no.', 'awb no', 'awb')
  const iORG        = col('org')
  const iDST        = col('dst')
  const iPCS        = col('pcs')
  const iWGHT       = col('wght', 'weight')
  const iNETRATE    = col('net rate')
  const iOTHER      = col('other chrgs', 'other charges')
  const iCLEARING   = col('clearing chrgs', 'clearing charges')
  const iFORME      = col('form e')
  const iRECEIVABLE = col('receivable')
  const iRECEIVED   = col('received')

  const s = (v) => (v == null ? '' : String(v)).trim()
  const num = (v) => { const n = parseFloat(s(v).replace(/,/g, '')); return isNaN(n) ? 0 : n }

  // Index existing shipments for this client by exact + digits-only AWB
  const byExact = {}
  const byDigits = {}
  for (const sh of existingShipments) {
    byExact[normalizeAwb(sh.awb_number)] = sh
    byDigits[digitsOnly(sh.awb_number)] = sh
  }

  const shipmentUpdates = []  // matched existing shipment, receivable reconciles
  const shipmentCreates = []  // no existing shipment, but enough data to create one
  const needsReview     = []  // can't safely update or create
  const payments        = []  // "amount received" rows to insert
  const duplicatePayments = []  // already recorded (in DB or earlier in this same file) — skipped
  const needsClassification = []  // has a description + a non-zero amount, but isn't a shipment or "received" row — user picks Credit/Debit/Skip
  const duplicateAdjustments = []  // already recorded as a credit/debit adjustment — skipped
  const skipped         = []  // blank / unparseable rows

  const existingPaymentSigs = new Set(
    (existingPayments ?? []).map(p => paymentSignature(p.payment_date, p.amount, p.description))
  )
  const existingAdjSigs = new Set(
    (existingAdjustments ?? []).map(a => paymentSignature(a.entry_date, a.amount, a.description))
  )
  const seenInFile = new Set()
  const seenAdjInFile = new Set()

  dataRows.forEach((row, idx) => {
    const rowNum = idx + 2
    const rawDate = iDATE >= 0 ? row[iDATE] : ''
    const date = parseDate(rawDate)
    const awbRaw = iAWB >= 0 ? s(row[iAWB]) : ''
    const received = iRECEIVED >= 0 ? num(row[iRECEIVED]) : 0

    if (isAwbLike(awbRaw)) {
      // ── Shipment row (update existing, or create if not in master log yet) ──
      if (!date) { skipped.push({ rowNum, reason: 'No valid date', text: awbRaw }); return }

      const netRate    = iNETRATE  >= 0 ? num(row[iNETRATE])  : 0
      const otherChrgs = iOTHER    >= 0 ? num(row[iOTHER])    : 0
      const clearing   = iCLEARING >= 0 ? num(row[iCLEARING]) : 0
      const formE      = iFORME    >= 0 ? num(row[iFORME])    : 0
      const receivable = iRECEIVABLE >= 0 ? num(row[iRECEIVABLE]) : 0
      const weight     = iWGHT >= 0 ? num(row[iWGHT]) : 0
      // The sheet's OTHER CHRGS already bundles the AWB fixed fee in — split it back
      // out so total_receivable (which adds other_charges_due_airline + awb_fixed_fee
      // separately) doesn't double-count it.
      const otherChargesSplit = Math.round((otherChrgs - awbFixedFee) * 100) / 100

      const norm = normalizeAwb(awbRaw)
      const match = byExact[norm] ?? byDigits[digitsOnly(awbRaw)] ?? null

      if (!match) {
        // Not in the master log yet — try to create it from the ledger row itself
        const origin      = iORG >= 0 ? s(row[iORG]).toUpperCase().slice(0, 3) : ''
        const destination  = iDST >= 0 ? s(row[iDST]).toUpperCase().slice(0, 3) : ''
        const pieces        = iPCS >= 0 ? Math.round(num(row[iPCS])) : 0
        const airline        = matchAirline(awbRaw, airlines)

        if (!airline || !origin || !destination || weight <= 0) {
          const missing = []
          if (!airline) missing.push(`unknown airline prefix "${awbRaw.split('-')[0]}"`)
          if (!origin || !destination) missing.push('missing ORG/DST')
          if (weight <= 0) missing.push('missing weight')
          needsReview.push({
            rowNum, date, awb_number: awbRaw,
            reason: `Not in Master Shipment Log and can't auto-create: ${missing.join(', ')}`,
            net_rate: netRate, other_charges_due_airline: otherChrgs, clearing_charges: clearing, form_e_pkr: formE, receivable,
          })
          return
        }

        const freight = Math.round(weight * netRate * 100) / 100
        const expectedTotal = Math.round((freight + clearing + otherChrgs + formE) * 100) / 100

        const createRecord = {
          awb_number: awbRaw,
          flight_date: date,
          airline_id: airline.id,
          airlineName: airline.name,
          origin, destination, pieces,
          chargeable_weight: weight,
          net_rate: netRate,
          clearing_charges: clearing,
          idc_tax: 0,
          other_charges_due_airline: otherChargesSplit,
          awb_fixed_fee: awbFixedFee,
          form_e_usd_value: formE,
          form_e_pkr_rate: formE > 0 ? 1 : 0,
          status: 'SHPD',
          sheetReceivable: receivable,
          expectedTotal,
        }

        if (receivable > 0 && Math.abs(expectedTotal - receivable) > 1) {
          needsReview.push({ ...createRecord, reason: `Receivable mismatch: sheet says ${receivable}, computed ${expectedTotal}` })
        } else {
          shipmentCreates.push(createRecord)
        }
        return
      }

      const w = weight || Number(match.chargeable_weight || 0)
      const freight = Math.round(w * netRate * 100) / 100
      const expectedTotal = Math.round((freight + clearing + otherChrgs + formE) * 100) / 100

      const record = {
        shipmentId: match.id,
        awb_number: match.awb_number,
        date,
        net_rate: netRate,
        clearing_charges: clearing,
        other_charges_due_airline: otherChargesSplit,
        awb_fixed_fee: awbFixedFee,
        form_e_usd_value: formE,
        form_e_pkr_rate: formE > 0 ? 1 : 0,
        sheetReceivable: receivable,
        expectedTotal,
      }

      if (receivable > 0 && Math.abs(expectedTotal - receivable) > 1) {
        needsReview.push({ ...record, reason: `Receivable mismatch: sheet says ${receivable}, computed ${expectedTotal}` })
      } else {
        shipmentUpdates.push(record)
      }
    } else if (received > 0) {
      // ── Payment row ──
      if (!date) { skipped.push({ rowNum, reason: 'No valid date', text: awbRaw }); return }
      const description = awbRaw || '(no description)'
      const sig = paymentSignature(date, received, description)

      if (existingPaymentSigs.has(sig) || seenInFile.has(sig)) {
        duplicatePayments.push({ rowNum, payment_date: date, amount: received, description })
        return
      }
      seenInFile.add(sig)

      payments.push({
        rowNum,
        payment_date: date,
        amount: received,
        payment_method: detectMethod(description),
        bank_account: detectBank(description),
        transaction_id: detectTransactionId(description),
        description,
      })
    } else {
      // ── Neither a shipment nor a "received" row — might be a manual credit/debit
      // entry (refund, deduction, loan, etc.) recorded in a different column. We
      // can't safely guess which side of the ledger it belongs on, so surface it
      // for the user to classify instead of silently dropping or misfiling it.
      const description = awbRaw
      if (!date || !description) {
        skipped.push({ rowNum, reason: !date ? 'No valid date' : 'Blank / unrecognised row', text: awbRaw })
        return
      }

      const receivableVal = iRECEIVABLE >= 0 ? num(row[iRECEIVABLE]) : 0
      const otherVal      = iOTHER      >= 0 ? num(row[iOTHER])      : 0
      const clearingVal   = iCLEARING   >= 0 ? num(row[iCLEARING])   : 0
      const formEVal      = iFORME      >= 0 ? num(row[iFORME])      : 0

      let amount = 0
      for (const v of [receivableVal, otherVal, clearingVal, formEVal]) {
        if (Math.abs(v) > Math.abs(amount)) amount = v
      }
      if (amount === 0) {
        // Fallback: some sheets don't use the standard column set at all — scan
        // every other cell in the row for the largest non-zero number.
        for (let ci = 0; ci < row.length; ci++) {
          if (ci === iDATE || ci === iAWB) continue
          const v = num(row[ci])
          if (Math.abs(v) > Math.abs(amount)) amount = v
        }
      }

      if (amount === 0) {
        skipped.push({ rowNum, reason: 'Blank / unrecognised row', text: awbRaw })
        return
      }

      amount = Math.abs(Math.round(amount * 100) / 100)
      const sig = paymentSignature(date, amount, description)
      if (existingAdjSigs.has(sig) || seenAdjInFile.has(sig)) {
        duplicateAdjustments.push({ rowNum, date, amount, description })
        return
      }
      seenAdjInFile.add(sig)

      needsClassification.push({ rowNum, date, amount, description })
    }
  })

  return { shipmentUpdates, shipmentCreates, needsReview, payments, duplicatePayments, needsClassification, duplicateAdjustments, skipped }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LedgerImportModal({ clientId, clientName, onImported, onClose }) {
  const [step,      setStep]      = useState('upload') // upload | preview | done
  const [dragOver,  setDragOver]  = useState(false)
  const [parsed,    setParsed]    = useState(null)
  const [importing, setImporting] = useState(false)
  const [result,    setResult]    = useState(null)
  const [error,     setError]     = useState(null)
  const [showAll,   setShowAll]   = useState(false)
  const [classifications, setClassifications] = useState({}) // rowNum -> { type: 'skip'|'credit'|'debit', amount }
  const fileRef = useRef()

  const processFile = useCallback((file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    setError(null)

    async function finish(rows) {
      if (rows.length < 2) { setError('File appears to be empty or has no data rows.'); return }
      const [
        { data: existingShipments, error: shErr },
        { data: airlines, error: alErr },
        { data: existingPayments, error: payErr },
        { data: existingAdjustments, error: adjErr },
        { data: companySettings, error: csErr },
      ] = await Promise.all([
        supabase.from('shipments').select('id, awb_number, chargeable_weight').eq('client_id', clientId),
        supabase.from('airlines').select('id, name, iata_prefix'),
        supabase.from('client_payments').select('payment_date, amount, description').eq('client_id', clientId),
        supabase.from('client_ledger_adjustments').select('entry_date, amount, description').eq('client_id', clientId),
        supabase.from('company_settings').select('default_awb_fixed_fee').eq('id', 1).single(),
      ])
      if (shErr) { setError(shErr.message); return }
      if (alErr) { setError(alErr.message); return }
      if (payErr) { setError(payErr.message); return }
      if (adjErr) { setError(adjErr.message); return }
      if (csErr) { setError(csErr.message); return }
      const awbFixedFee = Number(companySettings?.default_awb_fixed_fee ?? 0)
      try {
        const result = parseLedgerRows(rows, existingShipments ?? [], airlines ?? [], existingPayments ?? [], existingAdjustments ?? [], awbFixedFee)
        setParsed(result)
        setClassifications(Object.fromEntries(
          result.needsClassification.map(r => [r.rowNum, { type: 'skip', amount: r.amount }])
        ))
        setStep('preview')
      } catch (err) {
        setError(err.message)
      }
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
  }, [clientId])

  function onFileChange(e) { processFile(e.target.files[0]) }
  function onDrop(e) { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]) }

  async function handleImport() {
    if (!parsed) return
    setImporting(true)

    let updated = 0
    const updateErrors = []
    const CHUNK = 10
    for (let i = 0; i < parsed.shipmentUpdates.length; i += CHUNK) {
      const chunk = parsed.shipmentUpdates.slice(i, i + CHUNK)
      const results = await Promise.all(chunk.map(r =>
        supabase.from('shipments').update({
          net_rate:                  r.net_rate,
          clearing_charges:          r.clearing_charges,
          other_charges_due_airline: r.other_charges_due_airline,
          awb_fixed_fee:             r.awb_fixed_fee,
          form_e_usd_value:          r.form_e_usd_value,
          form_e_pkr_rate:           r.form_e_pkr_rate,
        }).eq('id', r.shipmentId)
      ))
      for (const { error: err } of results) {
        if (err) updateErrors.push(err.message)
        else updated++
      }
    }

    let created = 0
    const createErrors = []
    if (parsed.shipmentCreates.length > 0) {
      const createPayload = parsed.shipmentCreates.map(r => ({
        flight_date:                r.flight_date,
        awb_number:                 r.awb_number,
        airline_id:                 r.airline_id,
        client_id:                  clientId,
        origin:                     r.origin,
        destination:                r.destination,
        pieces:                     r.pieces,
        chargeable_weight:          r.chargeable_weight,
        net_rate:                   r.net_rate,
        clearing_charges:           r.clearing_charges,
        idc_tax:                    r.idc_tax,
        other_charges_due_airline:  r.other_charges_due_airline,
        awb_fixed_fee:              r.awb_fixed_fee,
        form_e_usd_value:           r.form_e_usd_value,
        form_e_pkr_rate:            r.form_e_pkr_rate,
        status:                     r.status,
      }))
      const CHUNK_C = 10
      for (let i = 0; i < createPayload.length; i += CHUNK_C) {
        const chunk = createPayload.slice(i, i + CHUNK_C)
        const results = await Promise.all(chunk.map(row =>
          supabase.from('shipments').insert(row).select('id')
        ))
        for (const { error: err } of results) {
          if (err) createErrors.push(err.message)
          else created++
        }
      }
    }

    let inserted = 0
    const paymentErrors = []
    if (parsed.payments.length > 0) {
      const payload = parsed.payments.map(p => ({
        client_id:      clientId,
        payment_date:   p.payment_date,
        amount:         p.amount,
        payment_method: p.payment_method,
        bank_account:   p.bank_account,
        transaction_id: p.transaction_id,
        description:    p.description,
      }))
      const CHUNK2 = 100
      for (let i = 0; i < payload.length; i += CHUNK2) {
        const chunk = payload.slice(i, i + CHUNK2)
        const { data, error: err } = await supabase.from('client_payments').insert(chunk).select('id')
        if (err) paymentErrors.push(err.message)
        else inserted += data?.length ?? 0
      }
    }

    let classified = 0
    const adjustmentErrors = []
    const adjPayload = parsed.needsClassification
      .map(r => ({ r, cls: classifications[r.rowNum] ?? { type: 'skip', amount: r.amount } }))
      .filter(({ cls }) => cls.type === 'credit' || cls.type === 'debit')
      .map(({ r, cls }) => ({
        client_id:   clientId,
        type:        cls.type,
        entry_date:  r.date,
        amount:      Number(cls.amount) || 0,
        description: r.description,
        notes:       null,
      }))
      .filter(row => row.amount > 0)

    if (adjPayload.length > 0) {
      const CHUNK3 = 100
      for (let i = 0; i < adjPayload.length; i += CHUNK3) {
        const chunk = adjPayload.slice(i, i + CHUNK3)
        const { data, error: err } = await supabase.from('client_ledger_adjustments').insert(chunk).select('id')
        if (err) adjustmentErrors.push(err.message)
        else classified += data?.length ?? 0
      }
    }

    setResult({ updated, created, inserted, classified, updateErrors, createErrors, paymentErrors, adjustmentErrors })
    setImporting(false)
    setStep('done')
    if (updated > 0 || created > 0 || inserted > 0 || classified > 0) onImported()
  }

  const classifyCount = parsed
    ? parsed.needsClassification.filter((r) => (classifications[r.rowNum]?.type ?? 'skip') !== 'skip').length
    : 0

  return (
    <Modal title={`Import Ledger Sheet — ${clientName}`} onClose={onClose} size="xl">

      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Upload this client's ledger Excel sheet. Rows with an AWB number update that shipment's
            rates/charges if it's already in the Master Shipment Log — and if it isn't, one is
            created directly from this sheet (airline resolved from the AWB prefix, same as the
            Master Log importer). Rows like "AMOUNT RECEIVED ..." are recorded as payments. Any other
            row with a description and an amount (refunds, deductions, manual adjustments, etc.) is
            shown to you before import so you can choose whether it's a Credit, a Debit, or should be skipped.
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
            <p className="text-sm font-medium text-gray-700">Drop the ledger file here</p>
            <p className="text-xs text-gray-400 mt-1">or click to browse</p>
            <p className="text-xs text-gray-300 mt-3">Accepts .xlsx · .xls · .csv</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
          </div>
        </div>
      )}

      {step === 'preview' && parsed && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-green-800">{parsed.shipmentUpdates.length} rate updates</p>
              <p className="text-xs text-green-600">Matched existing shipments</p>
            </div>
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-teal-800">{parsed.shipmentCreates.length} new shipments</p>
              <p className="text-xs text-teal-600">Not in Master Log — will be created</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-blue-800">{parsed.payments.length} payments</p>
              <p className="text-xs text-blue-600">Will be recorded on the ledger</p>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-indigo-800">{parsed.needsClassification.length} credit/debit?</p>
              <p className="text-xs text-indigo-600">Choose Credit/Debit/Skip below</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-purple-800">{parsed.duplicatePayments.length + parsed.duplicateAdjustments.length} duplicates</p>
              <p className="text-xs text-purple-600">Already recorded — will be skipped</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-amber-800">{parsed.needsReview.length} need review</p>
              <p className="text-xs text-amber-600">Unmatched airline or mismatched total</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-gray-700">{parsed.skipped.length} skipped</p>
              <p className="text-xs text-gray-500">Blank / unrecognised rows</p>
            </div>
          </div>

          {parsed.needsReview.length > 0 && (
            <div className="border border-amber-200 rounded-lg overflow-hidden">
              <div className="bg-amber-50 px-3 py-2 border-b border-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-semibold text-amber-800">Needs manual review — will NOT be imported</span>
              </div>
              <div className="overflow-auto max-h-40">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-amber-100">
                    {parsed.needsReview.map((r, i) => (
                      <tr key={i} className="bg-amber-50/40">
                        <td className="px-3 py-1.5 whitespace-nowrap text-amber-700">{r.date ?? ''}</td>
                        <td className="px-3 py-1.5 font-mono text-amber-700">{r.awb_number}</td>
                        <td className="px-3 py-1.5 text-amber-600 italic">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {parsed.needsClassification.length > 0 && (
            <div className="border border-indigo-200 rounded-lg overflow-hidden">
              <div className="bg-indigo-50 px-3 py-2 border-b border-indigo-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-semibold text-indigo-800">
                  Not a shipment or a payment — choose how to import each row (defaults to Skip)
                </span>
              </div>
              <div className="overflow-auto max-h-56">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Description</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Import as</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-100">
                    {parsed.needsClassification.map((r) => {
                      const cls = classifications[r.rowNum] ?? { type: 'skip', amount: r.amount }
                      return (
                        <tr key={r.rowNum} className={cls.type === 'skip' ? '' : 'bg-indigo-50/40'}>
                          <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{r.date}</td>
                          <td className="px-3 py-1.5 text-gray-700">{r.description}</td>
                          <td className="px-3 py-1.5 text-right">
                            <input
                              type="number" step="0.01"
                              className="w-24 border border-gray-300 rounded px-1.5 py-0.5 text-right text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                              value={cls.amount}
                              onChange={(e) => setClassifications((c) => ({ ...c, [r.rowNum]: { ...cls, amount: e.target.value } }))}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              className="border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                              value={cls.type}
                              onChange={(e) => setClassifications((c) => ({ ...c, [r.rowNum]: { ...cls, type: e.target.value } }))}
                            >
                              <option value="skip">Skip</option>
                              <option value="credit">Credit (adds to balance)</option>
                              <option value="debit">Debit (reduces balance)</option>
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Preview</span>
              <button className="text-xs text-accent hover:underline" onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Show fewer' : 'Show all'}
              </button>
            </div>
            <div className="overflow-auto max-h-72">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">AWB / Description</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(showAll ? parsed.shipmentUpdates : parsed.shipmentUpdates.slice(0, 30)).map((r, i) => (
                    <tr key={`u-${i}`} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{r.date}</td>
                      <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Rate update</span></td>
                      <td className="px-3 py-1.5 font-mono text-navy">{r.awb_number}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.expectedTotal.toLocaleString()}</td>
                    </tr>
                  ))}
                  {(showAll ? parsed.shipmentCreates : parsed.shipmentCreates.slice(0, 30)).map((r, i) => (
                    <tr key={`c-${i}`} className="hover:bg-gray-50 bg-teal-50/30">
                      <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{r.flight_date}</td>
                      <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 rounded text-xs font-medium bg-teal-100 text-teal-700">New shipment</span></td>
                      <td className="px-3 py-1.5 font-mono text-navy">{r.awb_number} <span className="text-gray-400">({r.airlineName})</span></td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.expectedTotal.toLocaleString()}</td>
                    </tr>
                  ))}
                  {(showAll ? parsed.payments : parsed.payments.slice(0, 30)).map((r, i) => (
                    <tr key={`p-${i}`} className="hover:bg-gray-50 bg-blue-50/30">
                      <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{r.payment_date}</td>
                      <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Payment</span></td>
                      <td className="px-3 py-1.5 text-gray-700">{r.description}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-green-700">{r.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <button onClick={() => { setStep('upload'); setParsed(null) }}
              className="text-sm text-gray-500 hover:text-gray-700 underline">
              ← Choose different file
            </button>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={handleImport} disabled={importing || (parsed.shipmentUpdates.length === 0 && parsed.shipmentCreates.length === 0 && parsed.payments.length === 0 && classifyCount === 0)}>
                {importing && <Spinner size="sm" />}
                Import {parsed.shipmentUpdates.length} updates + {parsed.shipmentCreates.length} new + {parsed.payments.length} payments{classifyCount > 0 ? ` + ${classifyCount} credit/debit` : ''}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="py-8 text-center space-y-4">
          <CheckCircle className="w-14 h-14 text-green-500 mx-auto" />
          <div>
            <p className="text-xl font-bold text-gray-800">
              {result.updated} updated · {result.created} created · {result.inserted} payments recorded · {result.classified} credit/debit recorded
            </p>
            {result.updateErrors.length > 0 && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 text-left">
                <strong>{result.updateErrors.length} update error(s):</strong> {result.updateErrors.join('; ')}
              </div>
            )}
            {result.createErrors.length > 0 && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 text-left">
                <strong>{result.createErrors.length} create error(s):</strong> {result.createErrors.join('; ')}
              </div>
            )}
            {result.paymentErrors.length > 0 && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 text-left">
                <strong>{result.paymentErrors.length} payment error(s):</strong> {result.paymentErrors.join('; ')}
              </div>
            )}
            {result.adjustmentErrors.length > 0 && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 text-left">
                <strong>{result.adjustmentErrors.length} credit/debit error(s):</strong> {result.adjustmentErrors.join('; ')}
              </div>
            )}
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>
      )}

    </Modal>
  )
}
