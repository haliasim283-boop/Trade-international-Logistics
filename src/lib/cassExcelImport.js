// Parsing + matching for the IATA Cargo Sales Report spreadsheet.
//
// The sheet is maintained by hand, so nothing about its layout is guaranteed
// except that somewhere there is a header row carrying an AWB column and a
// "PLUSS DIPP" column. Everything here is located by header text rather than
// by fixed column index.

import * as XLSX from 'xlsx'
import { awbKey, awbLookupVariants, chunk } from './awb'

export { awbKey, awbLookupVariants, chunk }

export function r2(n) { return Math.round(Number(n || 0) * 100) / 100 }

// ── Sheet reading ─────────────────────────────────────────────────────────────

// NOTE: intentionally NOT using cellDates:true — SheetJS's Excel-serial-to-Date
// conversion is timezone-dependent and can roll dates back a day. Raw values
// are read instead and converted below.
export function readSheetRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const out = []
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils
      .sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true })
      .filter((row) => row.some((cell) => String(cell).trim() !== ''))
    if (rows.length) out.push({ name, rows })
  }
  return out
}

// Excel's date serial is days since 1899-12-30.
function excelSerialToISO(serial) {
  const utcDays = Math.floor(serial) - 25569 // days between 1899-12-30 and the UNIX epoch
  const d = new Date(utcDays * 86400 * 1000)
  const y  = d.getUTCFullYear()
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function parseDate(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && v > 1000) return excelSerialToISO(v)
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // The sheet is written DD/MM/YYYY (e.g. 14/07/2026).
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

// Cells arrive as numbers, or as strings like "1,510,614.00" / "(1,234.00)" /
// "- 450.85" when the column was typed as text.
export function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim()
  if (!s || s === '-' || s === '—') return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/[^0-9.\-]/g, '')
  if (s.startsWith('-')) { neg = true; s = s.replace(/-/g, '') }
  if (s === '' || s === '.') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

// ── Header location ───────────────────────────────────────────────────────────

function norm(v) { return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') }

// Ordered most-specific first — "NETAMOUNT" must not be claimed by the loose
// AWB test, and "$CHARGED"/"CHARGED" must never be mistaken for PLUSS DIPP.
const COLUMN_TESTS = {
  awb:       (h) => /^AWB/.test(h) || h === 'AWBNMBR' || h === 'AWBNO' || h === 'AWBNUMBER',
  plussDipp: (h) => /^PLUS+DIP+$/.test(h) || h === 'PLUSDIPP' || h === 'PLUSSDIP',
  netAmount: (h) => h === 'NETAMOUNT' || h === 'NETAMT',
  weight:    (h) => h === 'WGHT' || h === 'WEIGHT' || h === 'WEIGHTKGS' || h === 'KGS',
  date:      (h) => h === 'DATE' || h === 'FLIGHTDATE',
  origin:    (h) => h === 'ORG' || h === 'ORIGIN',
  dest:      (h) => h === 'DST' || h === 'DEST' || h === 'DESTINATION',
  party:     (h) => h === 'PARTY' || h === 'CLIENT' || h === 'SHIPPER',
}

// Scans the top of the sheet for the row that carries both an AWB column and a
// PLUSS DIPP column. Returns null if this is not a Cargo Sales Report layout.
export function findHeader(rows, maxScan = 25) {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = rows[i].map(norm)
    const cols  = {}
    for (const [key, test] of Object.entries(COLUMN_TESTS)) {
      const idx = cells.findIndex((c) => c && test(c))
      if (idx !== -1) cols[key] = idx
    }
    if (cols.awb !== undefined && cols.plussDipp !== undefined) {
      return { headerRow: i, cols }
    }
  }
  return null
}

// ── Row extraction ────────────────────────────────────────────────────────────

/**
 * Pull the columns the CASS page cares about out of every sheet in the file.
 * Rows without a usable AWB or without a PLUSS DIPP value are reported
 * separately rather than silently dropped.
 */
export function parseCassExcel(sheets) {
  const rows    = []
  const skipped = []
  const seen    = new Map()   // awbKey -> index into rows
  let sheetsRead = 0

  for (const sheet of sheets) {
    const head = findHeader(sheet.rows)
    if (!head) continue
    sheetsRead++
    const { headerRow, cols } = head

    for (let i = headerRow + 1; i < sheet.rows.length; i++) {
      const raw = sheet.rows[i]
      const at  = (key) => (cols[key] === undefined ? '' : raw[cols[key]])

      const awbRaw = String(at('awb') ?? '').trim()
      const key    = awbKey(awbRaw)
      const dipp   = parseAmount(at('plussDipp'))

      // Totals bands and blank spacer rows have no AWB — ignore them quietly.
      if (!key) {
        if (awbRaw && dipp !== null) {
          skipped.push({ sheet: sheet.name, row: i + 1, awb: awbRaw, reason: 'AWB number not recognised' })
        }
        continue
      }
      if (dipp === null) {
        skipped.push({ sheet: sheet.name, row: i + 1, awb: awbRaw, reason: 'Pluss Dipp cell is blank' })
        continue
      }

      const entry = {
        key,
        awb:        awbRaw,
        plussDipp:  r2(dipp),
        netAmount:  parseAmount(at('netAmount')),
        weight:     parseAmount(at('weight')),
        date:       parseDate(at('date')),
        origin:     String(at('origin') ?? '').trim().toUpperCase() || null,
        dest:       String(at('dest')   ?? '').trim().toUpperCase() || null,
        party:      String(at('party')  ?? '').trim() || null,
        sheet:      sheet.name,
        row:        i + 1,
      }

      // The same AWB can appear twice (a correction line). Last one wins,
      // which matches how the sheet is read by eye.
      if (seen.has(key)) rows[seen.get(key)] = entry
      else { seen.set(key, rows.length); rows.push(entry) }
    }
  }

  return { rows, skipped, sheetsRead }
}

// ── Matching against shipments already in the system ──────────────────────────

/**
 * Split parsed rows into those whose AWB exists in the system and those that
 * don't. `shipments` is whatever came back from Supabase for the candidate
 * AWB spellings.
 */
export function matchToShipments(parsedRows, shipments) {
  const byKey = new Map()
  for (const s of shipments) {
    const k = awbKey(s.awb_number)
    if (k) byKey.set(k, s)
  }

  const matched   = []
  const unmatched = []

  for (const row of parsedRows) {
    const s = byKey.get(row.key)
    if (!s) { unmatched.push(row); continue }

    const pkrRate   = Number(s.pkr_exchange_rate || 1)
    const cassRate  = Number(s.cass_airline_rate || 0)
    const pwc       = r2(Number(s.chargeable_weight || 0) * cassRate * pkrRate)
    const netAmount = r2(pwc + Number(s.other_charges_due_airline || 0))

    matched.push({
      ...row,
      shipment:      s,
      systemNet:     netAmount,
      // Only meaningful where a CASS rate was actually typed on the shipment;
      // without one the "difference" is just the billed amount over again.
      hasCassRate:   cassRate > 0,
      diff:          cassRate > 0 ? r2(row.plussDipp - netAmount) : null,
      profit:        r2(Number(s.freight_amount || 0) + Number(s.other_charges_due_airline || 0) - row.plussDipp),
      alreadySet:    s.cass_pluss_dipp !== null && s.cass_pluss_dipp !== undefined,
      changed:       s.cass_pluss_dipp === null || s.cass_pluss_dipp === undefined
                       || r2(Number(s.cass_pluss_dipp)) !== row.plussDipp,
    })
  }

  return { matched, unmatched }
}
