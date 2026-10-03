import * as XLSX from 'xlsx'

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9,
  october: 9, nov: 10, november: 10, dec: 11, december: 11,
}

// Normalise an OCR-read month token: strip non-alpha, map common OCR
// confusions (0→o, 1→l, 8→b) so '0ct','0c†','Gct' all map to 'oct'.
function normalizeMonth(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/8/g, 'b')
    .replace(/[^a-z]/g, '')
}

const HEADER_ALIASES = {
  rowNumber: ['#', 'row', 'no'],
  prefix: ['prefix', 'airline prefix'],
  awb: ['awb', 'awb number', 'air waybill'],
  origin: ['orig', 'origin'],
  destination: ['dest', 'destination'],
  flightDetails: ['flight details', 'flight detail'],
  flightDate: ['flight date', 'date'],
  flightTime: ['flight time', 'departure time', 'time'],
  nature: ['nature of goods', 'commodity'],
  priceClass: ['price class', 'class'],
  pieces: ['pieces', 'pcs'],
  weight: ['weight', 'weight kg', 'kgs'],
  volume: ['volume'],
  status: ['status', 'booking status'],
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function excelSerialToDate(serial) {
  const date = new Date((Math.floor(serial) - 25569) * 86400000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function parseDate(value, flightDetails, today = new Date()) {
  if (typeof value === 'number' && value > 1000) return excelSerialToDate(value)
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
  }

  const text = String(value ?? '').trim()
  const source = text || String(flightDetails ?? '')
  const iso = source.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`

  // CargoSpot Flight Details format: "ISB-JED; PK9937 / 09-Oct (KK)"
  // The date always comes AFTER the "/" separator.
  // OCR frequently merges the slash + spaces into adjacent digits:
  //   "PK261 / 08-Oct"  →  "PK261108-Oct"  (slash→'1', spaces dropped)
  // Strategy:
  //   1. If a "/" exists in the string, only search the text after the LAST slash
  //      (the clean date segment).  Fall back to the full string if that fails.
  //   2. Use a GLOBAL regex WITHOUT a \b word-boundary before the day digits so
  //      "08" inside "PK261108-Oct" is still found.
  //   3. Take the LAST valid day-month match in the candidate string so that
  //      flight-number digits (e.g. "261") don't beat the real date ("08").

  const slashIdx = source.lastIndexOf('/')
  const candidates = slashIdx >= 0 ? [source.slice(slashIdx + 1), source] : [source]
  const dayMonthRe = /(\d{1,2})[-\s]+([a-z0-9]{3,9})/gi

  for (const candidate of candidates) {
    let last = null
    let m
    const re = new RegExp(dayMonthRe.source, 'gi')
    while ((m = re.exec(candidate)) !== null) {
      const mon = MONTHS[normalizeMonth(m[2])]
      if (mon !== undefined && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
        last = { day: Number(m[1]), month: mon }
      }
    }
    if (!last) continue

    const now = new Date(today)
    let result = new Date(now.getFullYear(), last.month, last.day)
    if (result < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      result = new Date(now.getFullYear() + 1, last.month, last.day)
    }
    if (result.getMonth() !== last.month) continue
    return `${result.getFullYear()}-${String(last.month + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`
  }

  return ''
}

function parseTime(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i)
  if (!match) return ''
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const period = match[3]?.toUpperCase()
  if (minute > 59 || hour > (period ? 12 : 23) || (period && hour < 1)) return ''
  if (period === 'PM' && hour !== 12) hour += 12
  if (period === 'AM' && hour === 12) hour = 0
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseNumber(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function cell(row, indexes, name) {
  const index = indexes[name]
  return index === undefined ? '' : row[index] ?? ''
}

function findHeader(rows) {
  return rows.findIndex((row) => {
    const values = row.map(normalizeHeader)
    const has = (...aliases) => aliases.some((alias) => values.includes(alias))
    return has(...HEADER_ALIASES.awb) && has(...HEADER_ALIASES.origin) && has(...HEADER_ALIASES.destination)
  })
}

export function parseCargoSpotRows(rows, today = new Date()) {
  const headerIndex = findHeader(rows)
  if (headerIndex < 0) throw new Error('Could not find the CargoSpot header row (Prefix, AWB, Orig, Dest).')

  const header = rows[headerIndex].map(normalizeHeader)
  const indexes = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = header.findIndex((name) => aliases.includes(name))
    if (index >= 0) indexes[field] = index
  }

  const bookings = []
  const skipped = []
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    if (!row.some((value) => String(value ?? '').trim())) return
    const prefix = String(cell(row, indexes, 'prefix')).trim().replace(/\D/g, '')
    const rawAwb = String(cell(row, indexes, 'awb')).trim().replace(/\s/g, '')
    const awb = rawAwb.includes('-') ? rawAwb : (prefix ? `${prefix}-${rawAwb}` : rawAwb)
    const flightDetails = String(cell(row, indexes, 'flightDetails')).trim()
    const flightDate = parseDate(cell(row, indexes, 'flightDate'), flightDetails, today)
    const origin = String(cell(row, indexes, 'origin')).trim().toUpperCase().slice(0, 3)
    const destination = String(cell(row, indexes, 'destination')).trim().toUpperCase().slice(0, 3)
    const rowNumber = parseNumber(cell(row, indexes, 'rowNumber')) ?? headerIndex + offset + 2

    const missing = []
    if (!awb) missing.push('AWB')
    if (!flightDate) missing.push('flight date')
    if (!origin) missing.push('origin')
    if (!destination) missing.push('destination')
    if (missing.length) {
      skipped.push({
        rowNumber,
        awb,
        origin,
        destination,
        flightDetails,
        reason: `Could not read ${missing.join(', ')}`,
      })
      return
    }

    bookings.push({
      awb_number: awb,
      prefix,
      origin,
      destination,
      flight_date: flightDate,
      flight_time: parseTime(cell(row, indexes, 'flightTime')) || '00:00',
      flight_details: flightDetails,
      nature_of_goods: String(cell(row, indexes, 'nature')).trim(),
      price_class: String(cell(row, indexes, 'priceClass')).trim(),
      pieces: parseNumber(cell(row, indexes, 'pieces')),
      weight_kg: parseNumber(cell(row, indexes, 'weight')),
      volume: parseNumber(cell(row, indexes, 'volume')),
      booking_status: String(cell(row, indexes, 'status')).trim() || 'Confirmed',
    })
  })

  return { bookings, skipped }
}

export async function readCargoSpotFile(file, today = new Date()) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('The selected file has no worksheets.')
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
  return parseCargoSpotRows(rows, today)
}