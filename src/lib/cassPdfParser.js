// ── IATA CASS "Cargo Sales Report" PDF parser ────────────────────────────────
//
// The PDF CASSLink emails out every fortnight is machine-generated fixed-width
// text (not a scan), so it can be parsed reliably without any OCR or AI.
// A single report bundles several distinct sub-reports:
//
//   PAYMENT SUMMARY                    — period grand total across all airlines
//   CARGO SALES INVOICE/ADJUSTMENT     — per-AWB detail, one block per airline
//   OTHER CHARGES SPECIFICATION        — per-AWB breakdown of the "other charges"
//   EXPORT BILLING STATEMENT - AGENT   — one summary row per airline
//   ADDITIONAL ADJUSTMENTS AND CHARGES — the BTA / IATA insurance line
//
// This module is deliberately split in two halves:
//   * linesFromTextContent() turns pdf.js text items back into fixed-width lines
//   * parseCassReport()      is a pure function over those lines
// so the parsing logic can be unit-tested against real PDFs outside a browser.

// ── Line reconstruction ───────────────────────────────────────────────────────

// 2x3 affine matrix product, matching pdf.js's Util.transform. Inlined so this
// module stays dependency-free and testable outside a browser.
function matMul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

// pdf.js hands back positioned text fragments, not lines. Because the report is
// a fixed-width layout we rebuild each line onto a character grid using the x
// coordinate, which preserves column alignment and — unlike naively joining
// fragments with spaces — never splits a number like "1461877.24" in two.
//
// CASSLink emits these pages with /Rotate 90, so a fragment's raw transform has
// the text running up the page. Composing with the page viewport's transform
// converts to device space (x rightwards, y downwards) where reading order is
// the obvious one; without it every "line" comes out as a single column.
export function linesFromTextContent(textContent, viewport) {
  const vt = viewport?.transform ?? [1, 0, 0, 1, 0, 0]
  const items = (textContent.items || [])
    .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => {
      const t = matMul(vt, it.transform)
      return { str: it.str, x: t[4], y: t[5], width: it.width }
    })
  if (items.length === 0) return []

  // Estimate one character's width from the monospace body text.
  const widths = items
    .filter((it) => it.width > 0 && it.str.length > 0)
    .map((it) => it.width / it.str.length)
    .sort((a, b) => a - b)
  const charW = widths.length ? widths[Math.floor(widths.length / 2)] : 5

  // Group fragments into rows by their baseline y.
  const rows = new Map()
  for (const it of items) {
    const key = it.y.toFixed(1)
    if (!rows.has(key)) rows.set(key, [])
    rows.get(key).push(it)
  }

  // Device space y grows downwards, so ascending y is top-to-bottom.
  const ordered = [...rows.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))

  return ordered.map(([, frags]) => {
    frags.sort((a, b) => a.x - b.x)
    let line = ''
    for (const f of frags) {
      const col = Math.round(f.x / charW)
      if (col > line.length) line += ' '.repeat(col - line.length)
      line += f.str
    }
    return line.replace(/\s+$/, '')
  })
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const MONTHS = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

// CASS prints amounts as "1234.56"; corrections can carry a leading or
// trailing minus. Returns null when the token isn't a number at all.
function num(tok) {
  if (tok == null) return null
  let t = String(tok).trim().replace(/,/g, '')
  let neg = false
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1) }
  if (t.startsWith('-')) { neg = true; t = t.slice(1) }
  if (t.startsWith('(') && t.endsWith(')')) { neg = true; t = t.slice(1, -1) }
  if (!/^\d*\.?\d+$/.test(t)) return null
  const v = Number(t)
  if (!isFinite(v)) return null
  return neg ? -v : v
}

function isNum(tok) { return num(tok) !== null }

// "16-JUL-26" → "2026-07-16". CASS uses 2-digit years; these reports are
// contemporary, so 00–79 maps to 2000s and 80–99 to 1900s.
function parseCassDate(s) {
  if (!s) return null
  const m = String(s).trim().toUpperCase().match(/^(\d{1,2})-([A-Z]{3})-(\d{2})$/)
  if (!m) return null
  const [, d, mon, yy] = m
  const mm = MONTHS[mon]
  if (!mm) return null
  const year = Number(yy) <= 79 ? 2000 + Number(yy) : 1900 + Number(yy)
  return `${year}-${mm}-${String(d).padStart(2, '0')}`
}

// The per-AWB "EXEC DATE AWB" column is YYMMDD, e.g. 260714 → 2026-07-14.
function parseExecDate(s) {
  const m = String(s ?? '').match(/^(\d{2})(\d{2})(\d{2})$/)
  if (!m) return null
  const [, yy, mm, dd] = m
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null
  const year = Number(yy) <= 79 ? 2000 + Number(yy) : 1900 + Number(yy)
  return `${year}-${mm}-${dd}`
}

// AWB numbers are a 3-digit airline prefix plus an 8-digit serial, written
// 214-8220-3590 throughout this app.
function fullAwb(prefix, serial) {
  if (!prefix || !serial || serial.length !== 8) return serial ?? ''
  return `${prefix}-${serial.slice(0, 4)}-${serial.slice(4)}`
}

function toks(line) { return line.trim().split(/\s+/).filter(Boolean) }

// ── Per-AWB detail row ────────────────────────────────────────────────────────

// Column order on the CARGO SALES INVOICE/ADJUSTMENT pages:
//
//   AWB SERIAL | SP IN | ORGDES | WEIGHT
//   | PREPAID: weight/valuation charges, other charges due airline
//   | COLLECT: weight/valuation charges, other charges due agent
//   | COMMISSION | INCENTIVE | NET AMOUNT BEFORE TAX | TAX WITHHELD
//   | NET AMOUNT PAYABLE | EXEC DATE AWB | AGENTS INFORMATION
//
// SP IN (special handling code, e.g. "LT" / "NC") is optional and blank on most
// rows, so the fields are consumed positionally rather than by column offset.
function parseAwbRow(line) {
  const t = toks(line)
  if (t.length < 12) return null
  if (!/^\d{8}$/.test(t[0])) return null

  let i = 1
  let spin = null
  // "LT PEWDXB" — a 2-letter SP IN only counts when a 6-letter route follows it.
  if (/^[A-Z]{2}$/.test(t[i]) && /^[A-Z]{6}$/.test(t[i + 1] ?? '')) {
    spin = t[i]
    i += 1
  }
  if (!/^[A-Z]{6}$/.test(t[i] ?? '')) return null
  const orgdes = t[i]
  i += 1

  // weight + 9 money columns, all mandatory in this layout
  const vals = []
  for (let k = 0; k < 10; k++) {
    const v = num(t[i + k])
    if (v === null) return null
    vals.push(v)
  }
  i += 10

  const execRaw = t[i] && /^\d{6}$/.test(t[i]) ? t[i] : null
  if (execRaw) i += 1

  return {
    awb_serial:                     t[0],
    spin,
    origin:                         orgdes.slice(0, 3),
    destination:                    orgdes.slice(3, 6),
    weight:                         vals[0],
    prepaid_weight_charges:         vals[1],
    prepaid_other_charges_airline:  vals[2],
    collect_weight_charges:         vals[3],
    collect_other_charges_agent:    vals[4],
    commission:                     vals[5],
    incentive:                      vals[6],
    net_amount_before_tax:          vals[7],
    tax_withheld:                   vals[8],
    net_amount_payable:             vals[9],
    exec_date:                      parseExecDate(execRaw),
    agents_information:             t.slice(i).join(' ') || null,
  }
}

// ── Other Charges Specification row ───────────────────────────────────────────

// "97223991   CC.C  15.00 CH.C  23.76 NE.C  50.00 SC.C  79.98"
function parseOtherChargesRow(line) {
  const t = toks(line)
  if (!/^\d{8}$/.test(t[0])) return null
  const charges = []
  for (let i = 1; i < t.length - 1; i++) {
    if (/^[A-Z]{2}\.[A-Z]$/.test(t[i]) && isNum(t[i + 1])) {
      charges.push({ code: t[i], amount: num(t[i + 1]) })
      i += 1
    }
  }
  if (charges.length === 0) return null
  return { awb_serial: t[0], charges }
}

// ── Export Billing Statement row ──────────────────────────────────────────────

// "157  QR  2881353.00  93027.00  0.00  0.00  0.00  0.00  0.00  2974380.00  PK-157-039628  01"
function parseBillingStatementRow(line) {
  const t = toks(line)
  if (!/^\d{3}$/.test(t[0]) || !/^[A-Z0-9]{2}$/.test(t[1] ?? '')) return null
  const vals = []
  for (let k = 0; k < 8; k++) {
    const v = num(t[2 + k])
    if (v === null) return null
    vals.push(v)
  }
  return {
    airline_prefix:          t[0],
    airline_code:            t[1],
    prepaid_weight_charge:   vals[0],
    prepaid_due_airline:     vals[1],
    collect_weight_charge:   vals[2],
    collect_due_agent:       vals[3],
    commission:              vals[4],
    sales_incentive:         vals[5],
    tax_withheld:            vals[6],
    payable:                 vals[7],
    invoice_number:          t[10] ?? null,
    billing:                 t[11] ?? null,
  }
}

// ── Main parser ───────────────────────────────────────────────────────────────

// Lines that look like AWB rows but are running totals, not shipments.
const TOTAL_MARKERS = [
  'TOTAL TAX EXEMPTED', 'GRAND', 'CARRIED', 'BROUGHT', 'TOTAL',
  'RECAPITULATION', 'SUB TOTAL', 'SUBTOTAL',
]

function isTotalLine(line) {
  const up = line.trim().toUpperCase()
  return TOTAL_MARKERS.some((m) => up.startsWith(m))
}

/**
 * @param {string[][]} pages  Lines per page, in document order.
 * @returns parsed report — meta, per-AWB rows, per-airline summary, other
 *          charges, BTA adjustments, payment summary, and any unparsed rows.
 */
export function parseCassReport(pages) {
  const meta = {
    agent:          null,
    iata_code:      null,
    currency:       null,
    period_start:   null,
    period_end:     null,
    remittance_date: null,
    report_date:    null,
  }

  const awbRows        = []   // per-AWB detail across every airline
  const airlineSummary = []   // Export Billing Statement rows
  const otherCharges   = []   // Other Charges Specification rows
  const adjustments    = []   // Additional Adjustments and Charges (BTA)
  const airlineTotals  = []   // per-airline recapitulation totals
  const unparsed       = []   // AWB-looking lines we could not read
  let paymentSummary   = null

  // Airline name lookup harvested from the invoice page headers.
  const airlineNames = {}

  for (let p = 0; p < pages.length; p++) {
    const lines = pages[p]
    const pageText = lines.join('\n').toUpperCase()

    // ── Page-level metadata (repeated in every page header) ──────────────────
    for (const line of lines) {
      if (!meta.iata_code) {
        const m = line.match(/IATA NUMERIC CODE\s*:?\s*([\d\- /]+?)(?:\s{2,}|$)/i)
        if (m) meta.iata_code = m[1].trim()
      }
      if (!meta.currency) {
        const m = line.match(/CURRENCY\s*:?\s*([A-Z]{3})\b/i)
        if (m) meta.currency = m[1].toUpperCase()
      }
      if (!meta.period_start) {
        const m = line.match(/BILLING PERIOD\s*:?\s*(\d{1,2}-[A-Za-z]{3}-\d{2})\s*-\s*(\d{1,2}-[A-Za-z]{3}-\d{2})/i)
        if (m) {
          meta.period_start = parseCassDate(m[1])
          meta.period_end   = parseCassDate(m[2])
        }
      }
      if (!meta.remittance_date) {
        const m = line.match(/REMITTANCE DATE\s*:?\s*(\d{1,2}-[A-Za-z]{3}-\d{2})/i)
        if (m) meta.remittance_date = parseCassDate(m[1])
      }
      if (!meta.report_date) {
        const m = line.match(/\bDATE\s*:\s*(\d{1,2}-[A-Za-z]{3}-\d{2})/i)
        if (m) meta.report_date = parseCassDate(m[1])
      }
    }

    // ── Which sub-report is this page? ──────────────────────────────────────
    // Match on the title in the page's own header band only. The Export
    // Billing Statement carries a footnote mentioning "Additional Adjustments
    // and Charges (BTA)", which would otherwise misidentify that page.
    const header      = lines.slice(0, 3).join('\n').toUpperCase()
    const isInvoice   = header.includes('CARGO SALES INVOICE/ADJUSTMENT')
    const isOtherChg  = header.includes('OTHER CHARGES SPECIFICATION')
    const isBilling   = header.includes('EXPORT BILLING STATEMENT')
    const isAdjust    = header.includes('ADDITIONAL ADJUSTMENTS AND CHARGES')
    const isPaySumm   = header.includes('PAYMENT SUMMARY')

    // Airline this page belongs to (invoice + other-charges pages carry it).
    let airlinePrefix = null
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/AIRLINE\s*:\s*(\d{3})\b/i)
      if (m) {
        airlinePrefix = m[1]
        // The airline's trading name sits on the next line, in the same
        // right-hand column as the "AIRLINE :" label.
        const labelCol = lines[i].toUpperCase().indexOf('AIRLINE')
        const next = lines[i + 1] ?? ''
        const name = next.slice(labelCol).trim()
        if (name && !airlineNames[airlinePrefix]) airlineNames[airlinePrefix] = name
        break
      }
    }

    // ── Payment Summary ─────────────────────────────────────────────────────
    if (isPaySumm && !paymentSummary) {
      const ps = { net_due_export: null, net_due_dip: null, grand_total: null, total_payable: null }
      for (const line of lines) {
        const t = toks(line)
        const up = line.toUpperCase()
        if (up.includes('NET DUE') && up.includes('EXPORT')) {
          ps.net_due_export = num(t.find((x, i) => i > 0 && isNum(x)))
        } else if (up.includes('NET DUE') && up.includes('DIP')) {
          ps.net_due_dip = num(t.find((x, i) => i > 0 && isNum(x)))
        } else if (up.trim().startsWith('GRAND TOTAL')) {
          ps.grand_total = num(t.find((x) => isNum(x)))
        } else if (up.trim().startsWith('TOTAL PAYABLE')) {
          ps.total_payable = num(t.find((x) => isNum(x)))
        }
      }
      if (ps.total_payable !== null || ps.grand_total !== null) paymentSummary = ps
    }

    // ── Agent name (payment summary + statement pages) ──────────────────────
    // "AGENT:" shares its printed line with whatever sits in the right-hand
    // columns ("PAGE : 1", "AIRLINE : 157"), and those columns often land on
    // their own reconstructed lines because their baseline differs slightly.
    // The agent's name is the next line that actually starts in the left
    // margin; deeply indented lines belong to another column.
    if (!meta.agent) {
      const idx = lines.findIndex((l) => /^\s*AGENT\s*:/i.test(l))
      if (idx >= 0) {
        const rest = lines[idx].replace(/^\s*AGENT\s*:/i, '')
        let name = /^\s{2,}/.test(rest) ? '' : rest.trim()
        for (let k = idx + 1; !name && k <= idx + 4 && k < lines.length; k++) {
          if (/^\s{0,10}\S/.test(lines[k])) name = lines[k].trim().split(/\s{2,}/)[0].trim()
        }
        meta.agent = name || null
      }
    }

    // ── Per-AWB detail ──────────────────────────────────────────────────────
    if (isInvoice && airlinePrefix) {
      for (const line of lines) {
        if (isTotalLine(line)) continue
        if (!/^\s*\d{8}\s/.test(line)) continue
        const row = parseAwbRow(line)
        if (row) {
          awbRows.push({
            ...row,
            airline_prefix: airlinePrefix,
            airline_name:   airlineNames[airlinePrefix] ?? null,
            awb_number:     fullAwb(airlinePrefix, row.awb_serial),
            page:           p + 1,
          })
        } else {
          unparsed.push({ page: p + 1, line: line.trim() })
        }
      }

      // Recapitulation totals — used to verify we captured every row.
      const recapIdx = lines.findIndex((l) => /^\s*RECAPITULATION/i.test(l))
      if (recapIdx >= 0) {
        const rec = { airline_prefix: airlinePrefix, airline_name: airlineNames[airlinePrefix] ?? null }
        for (const line of lines.slice(recapIdx)) {
          const up = line.toUpperCase()
          const lastNum = toks(line).filter(isNum).pop()
          if (up.includes('TOTAL PREPAID CHARGES DUE AIRLINE')) rec.total_prepaid_due_airline = num(lastNum)
          else if (up.includes('NET TOTAL DUE AIRLINE')) {
            const nums = toks(line).filter(isNum).map(num)
            rec.net_total_due_airline = nums[0] ?? null
            if (up.includes('NET AFTER ROUNDING')) rec.net_after_rounding = nums[nums.length - 1] ?? null
          } else if (up.includes('TAX WITHHELD DUE AIRLINE')) rec.tax_withheld = num(lastNum)
          else if (up.includes('COMMISSION DUE AGENT')) rec.commission_due_agent = num(lastNum)
        }
        if (Object.keys(rec).length > 2) airlineTotals.push(rec)
      }
    }

    // ── Other Charges Specification ─────────────────────────────────────────
    if (isOtherChg && airlinePrefix) {
      for (const line of lines) {
        if (isTotalLine(line)) continue
        if (!/^\s*\d{8}\s/.test(line)) continue
        const row = parseOtherChargesRow(line)
        if (row) {
          otherCharges.push({
            airline_prefix: airlinePrefix,
            awb_number:     fullAwb(airlinePrefix, row.awb_serial),
            awb_serial:     row.awb_serial,
            charges:        row.charges,
            total:          row.charges.reduce((s, c) => s + c.amount, 0),
          })
        }
      }
    }

    // ── Export Billing Statement ────────────────────────────────────────────
    if (isBilling) {
      for (const line of lines) {
        if (isTotalLine(line)) continue
        const row = parseBillingStatementRow(line)
        if (row) {
          airlineSummary.push({ ...row, airline_name: airlineNames[row.airline_prefix] ?? null })
        }
      }
    }

    // ── Additional Adjustments and Charges (BTA) ────────────────────────────
    if (isAdjust) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isTotalLine(line)) continue
        const t = toks(line)
        if (t.length < 3 || !/^\d{3}$/.test(t[0])) continue
        // Last numeric token is the amount; anything after it is the BTN number.
        let amtIdx = -1
        for (let k = t.length - 1; k >= 1; k--) {
          if (isNum(t[k]) && t[k].includes('.')) { amtIdx = k; break }
        }
        if (amtIdx < 0) continue
        // The charge description wraps onto any number of following lines
        // (e.g. "IATA-Default Insurance" / "Program"); they carry no amount.
        const cont = []
        for (let k = i + 1; k < lines.length; k++) {
          const c = lines[k].trim()
          if (!c || /^\d{3}\s/.test(c) || isTotalLine(c) || /^-+$/.test(c)) break
          if (toks(c).some((x) => isNum(x) && x.includes('.'))) break
          cont.push(c)
        }
        adjustments.push({
          airline_prefix: t[0],
          text:           [t.slice(1, amtIdx).join(' '), ...cont].join(' ').trim(),
          amount:         num(t[amtIdx]),
          btn_number:     t.slice(amtIdx + 1).join(' ') || null,
        })
      }
    }
  }

  // Fill in airline names harvested later in the document.
  for (const r of awbRows)        if (!r.airline_name) r.airline_name = airlineNames[r.airline_prefix] ?? null
  for (const r of airlineSummary) if (!r.airline_name) r.airline_name = airlineNames[r.airline_prefix] ?? null

  return {
    meta,
    paymentSummary,
    awbRows,
    airlineSummary,
    airlineTotals,
    otherCharges,
    adjustments,
    unparsed,
  }
}

// ── Reconciliation ────────────────────────────────────────────────────────────

// Cross-checks the per-AWB rows we extracted against the totals CASS printed
// itself. A mismatch means the parser dropped or misread a row, so the caller
// can warn instead of silently handing over a short report.
export function reconcile(parsed) {
  const byAirline = {}
  for (const r of parsed.awbRows) {
    const k = r.airline_prefix
    if (!byAirline[k]) byAirline[k] = { count: 0, weight: 0, payable: 0 }
    byAirline[k].count  += 1
    byAirline[k].weight += r.weight
    byAirline[k].payable += r.net_amount_payable
  }

  const checks = parsed.airlineSummary.map((s) => {
    const got = byAirline[s.airline_prefix] ?? { count: 0, weight: 0, payable: 0 }
    // CASS rounds the statement's payable to whole rupees; allow 1 unit.
    const diff = Math.round((got.payable - s.payable) * 100) / 100
    return {
      airline_prefix: s.airline_prefix,
      airline_code:   s.airline_code,
      awb_count:      got.count,
      parsed_payable: Math.round(got.payable * 100) / 100,
      stated_payable: s.payable,
      difference:     diff,
      ok:             Math.abs(diff) <= 1,
    }
  })

  return { checks, allOk: checks.length > 0 && checks.every((c) => c.ok) }
}
