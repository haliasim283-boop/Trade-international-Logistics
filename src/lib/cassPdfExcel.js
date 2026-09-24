// Builds the .xlsx workbook from a parsed CASS report (see cassPdfParser.js).
// The primary sheet ("CASS Summary") strictly follows the client's reconciliation
// layout (Qatar Airways QR, Salam Air, Air Arabia, Emirates, PIA, DIPP, QR Adjustment,
// Air Sial).
// Detailed sheets (AWB Detail, Airline Summary, Other Charges, BTA, Payment Summary)
// follow for full auditability.

import * as XLSX from 'xlsx'

function sheetFrom(rows, colWidths) {
  const ws = XLSX.utils.json_to_sheet(rows)
  if (colWidths) ws['!cols'] = colWidths.map((w) => ({ wch: w }))
  return ws
}

function w(...widths) { return widths }

export function buildClientSummarySheet(parsed) {
  const { awbRows = [], airlineSummary = [], adjustments = [], paymentSummary = {} } = parsed

  // Filter rows for the 3 IATA airlines in Pakistan CASS:
  // Qatar Airways: 157, Emirates: 176, PIA: 214
  const qrAwbs = awbRows.filter((r) => r.airline_prefix === '157')
  const ekAwbs = awbRows.filter((r) => r.airline_prefix === '176')
  const pkAwbs = awbRows.filter((r) => r.airline_prefix === '214')

  const qrWeight = Math.round(qrAwbs.reduce((s, r) => s + (r.weight || 0), 0) * 100) / 100
  const ekWeight = Math.round(ekAwbs.reduce((s, r) => s + (r.weight || 0), 0) * 100) / 100
  const pkWeight = Math.round(pkAwbs.reduce((s, r) => s + (r.weight || 0), 0) * 100) / 100

  const qrStmt = airlineSummary.find((s) => s.airline_prefix === '157')
  const ekStmt = airlineSummary.find((s) => s.airline_prefix === '176')
  const pkStmt = airlineSummary.find((s) => s.airline_prefix === '214')

  const qrPayable = qrStmt ? qrStmt.payable : Math.round(qrAwbs.reduce((s, r) => s + (r.net_amount_payable || 0), 0))
  const ekPayable = ekStmt ? ekStmt.payable : Math.round(ekAwbs.reduce((s, r) => s + (r.net_amount_payable || 0), 0))
  const pkPayable = pkStmt ? pkStmt.payable : Math.round(pkAwbs.reduce((s, r) => s + (r.net_amount_payable || 0), 0))

  // DIPP (IATA-Default Insurance Program):
  const dipAdj = adjustments.find((a) => a.btn_number === 'DIP' || /insurance/i.test(a.text))
  const totalCassAwbs = dipAdj?.awb_count ?? awbRows.length ?? (qrAwbs.length + ekAwbs.length + pkAwbs.length)
  const dipRate = dipAdj?.rate ?? (totalCassAwbs > 0 && dipAdj ? Math.round(dipAdj.amount / totalCassAwbs) : 1800)
  const dipAmount = dipAdj ? dipAdj.amount : (paymentSummary?.net_due_dip ?? (totalCassAwbs * dipRate))

  // Non-DIP adjustments (e.g. QR adjustments or other BTA corrections)
  const nonDipAdjs = adjustments.filter((a) => a !== dipAdj)
  const adjAmount = nonDipAdjs.reduce((s, a) => s + a.amount, 0)

  // Totals
  const totalWeight = qrWeight + ekWeight + pkWeight
  const totalAmount = qrPayable + ekPayable + pkPayable + dipAmount + adjAmount
  const totalIata   = qrPayable + ekPayable + pkPayable + dipAmount + adjAmount

  const data = [
    // Row 1: Header summary sums
    [
      '',
      '',
      { t: 'n', v: totalWeight, f: 'C3+C4+C5+C6+C8', z: '#,##0' },
      { t: 'n', v: totalAmount, f: 'SUM(D3:D8)', z: '#,##0' },
      { t: 'n', v: totalIata,   f: 'SUM(E3:E8)', z: '#,##0' },
    ],
    // Row 2: Column titles
    ['AIR LINE', "AWB'S", ' WEIGHT ', ' TOTAL AMOUNTS ', 'IATA'],
    // Row 3: Qatar Airways QR
    [
      'QATAR AIRWAYS QR',
      qrAwbs.length || '',
      qrWeight ? { t: 'n', v: qrWeight, z: '#,##0' } : '',
      qrPayable ? { t: 'n', v: qrPayable, z: '#,##0' } : '',
      qrPayable ? { t: 'n', v: qrPayable, z: '#,##0' } : '',
    ],
    // Row 4: Emirates
    [
      'EMIRATES',
      ekAwbs.length || '',
      ekWeight ? { t: 'n', v: ekWeight, z: '#,##0' } : '',
      ekPayable ? { t: 'n', v: ekPayable, z: '#,##0' } : '',
      ekPayable ? { t: 'n', v: ekPayable, z: '#,##0' } : '',
    ],
    // Row 7: PIA
    [
      'PIA',
      pkAwbs.length || '',
      pkWeight ? { t: 'n', v: pkWeight, z: '#,##0' } : '',
      pkPayable ? { t: 'n', v: pkPayable, z: '#,##0' } : '',
      pkPayable ? { t: 'n', v: pkPayable, z: '#,##0' } : '',
    ],
    // Row 8: DIPP
    [
      'DIPP',
      totalCassAwbs || '',
      dipRate ? { t: 'n', v: dipRate, z: '#,##0' } : 1800,
      dipAmount ? { t: 'n', v: dipAmount, z: '#,##0' } : '',
      dipAmount ? { t: 'n', v: dipAmount, z: '#,##0' } : '',
    ],
    // Row 9: QR Adjustment
    [
      'QR ADJESTMENT',
      '',
      '',
      adjAmount ? { t: 'n', v: adjAmount, z: '#,##0;(#,##0);"-"' } : '',
      adjAmount ? { t: 'n', v: adjAmount, z: '#,##0;(#,##0);"-"' } : '',
    ],
    // Row 10: AirSial (non-IATA row in client format)
    ['AIRSIAL PF M&C', '', '', '', ''],
    // Row 11: Blank spacer
    ['', '', '', '', ''],
  ]

  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 18 }]
  return ws
}

export function buildCassWorkbook(parsed, shipmentLookup = {}) {
  const { meta, paymentSummary, awbRows, airlineSummary, otherCharges, adjustments } = parsed
  const wb = XLSX.utils.book_new()

  // ── Sheet 1: CASS Summary (Client's exact format) ───────────────────────────
  XLSX.utils.book_append_sheet(wb, buildClientSummarySheet(parsed), 'CASS Summary')

  // ── Sheet 2: AWB Detail — one row per airwaybill, every airline ─────────────
  const detail = awbRows.map((r) => {
    const s = shipmentLookup?.[r.awb_number] ?? {}
    return {
      'Exec Date':          r.exec_date ?? '',
      'AWB Number':         r.awb_number,
      'Client':             s.client        ?? '',
      'Origin':             r.origin,
      'Destination':        r.destination,
      'Pieces':             s.pieces        ?? '',
      'Weight (KG)':        r.weight,
      'Net Rate':           s.net_rate      ?? '',
      'Other Charges':      s.other_charges ?? '',
      'AWB Fee':            s.awb_fee       ?? '',
      'Net Amount Payable': r.net_amount_payable,
      'PLUSS DIPP':         r.net_amount_payable,
    }
  })
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(detail, w(11, 16, 8, 11, 12, 22, 8, 12, 14, 12, 18, 18)),
    'AWB Detail',
  )

  // ── Sheet 3: Airline Summary — the Export Billing Statement ─────────────────
  const summary = airlineSummary.map((s) => ({
    'Airline Prefix':         s.airline_prefix,
    'Code':                   s.airline_code,
    'Airline':                s.airline_name ?? '',
    'Prepaid Weight Charge':  s.prepaid_weight_charge,
    'Prepaid Due Airline':    s.prepaid_due_airline,
    'Collect Weight Charge':  s.collect_weight_charge,
    'Collect Due Agent':      s.collect_due_agent,
    'Commission':             s.commission,
    'Sales Incentive':        s.sales_incentive,
    'Tax Withheld':           s.tax_withheld,
    'Payable':                s.payable,
    'Invoice Number':         s.invoice_number ?? '',
    'AWBs':                   awbRows.filter((r) => r.airline_prefix === s.airline_prefix).length,
  }))
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(summary, w(8, 6, 28, 20, 18, 20, 18, 12, 14, 12, 16, 16, 7)),
    'Airline Summary',
  )

  // ── Sheet 4: Other Charges Specification ────────────────────────────────────
  if (otherCharges.length) {
    const oc = otherCharges.map((r) => {
      const row = {
        'Airline Prefix': r.airline_prefix,
        'AWB Number':     r.awb_number,
      }
      for (const c of r.charges) row[c.code] = c.amount
      row['Total'] = Math.round(r.total * 100) / 100
      return row
    })
    XLSX.utils.book_append_sheet(wb, sheetFrom(oc, w(8, 16, 10, 10, 10, 10, 12)), 'Other Charges')
  }

  // ── Sheet 5: Additional Adjustments / BTA ───────────────────────────────────
  if (adjustments.length) {
    const adj = adjustments.map((a) => ({
      'Airline': a.airline_prefix,
      'Text':    a.text,
      'Amount':  a.amount,
      'BTN':     a.btn_number ?? '',
    }))
    XLSX.utils.book_append_sheet(wb, sheetFrom(adj, w(8, 60, 14, 8)), 'Adjustments (BTA)')
  }

  // ── Sheet 6: Payment Summary + report metadata ──────────────────────────────
  const info = [
    ['CASS Cargo Sales Report'],
    [],
    ['Agent',             meta.agent ?? ''],
    ['IATA Numeric Code', meta.iata_code ?? ''],
    ['Currency',          meta.currency ?? ''],
    ['Billing Period',    meta.period_start && meta.period_end ? `${meta.period_start} to ${meta.period_end}` : ''],
    ['Report Date',       meta.report_date ?? ''],
    ['Remittance Date',   meta.remittance_date ?? ''],
    [],
    ['PAYMENT SUMMARY',   'Net Due Airline'],
    ['Net Due - Export',  paymentSummary?.net_due_export ?? ''],
    ['Net Due - DIP',     paymentSummary?.net_due_dip ?? ''],
    ['Grand Total',       paymentSummary?.grand_total ?? ''],
    ['Total Payable',     paymentSummary?.total_payable ?? ''],
    [],
    ['Total AWBs parsed', awbRows.length],
  ]
  const ws = XLSX.utils.aoa_to_sheet(info)
  ws['!cols'] = [{ wch: 22 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Payment Summary')

  return wb
}

export function cassWorkbookFilename(parsed) {
  const p = parsed.meta.period_start && parsed.meta.period_end
    ? `${parsed.meta.period_start}_to_${parsed.meta.period_end}`
    : 'report'
  return `cass-${p}.xlsx`
}

export function downloadCassWorkbook(parsed, shipmentLookup = {}) {
  XLSX.writeFile(buildCassWorkbook(parsed, shipmentLookup), cassWorkbookFilename(parsed))
}
