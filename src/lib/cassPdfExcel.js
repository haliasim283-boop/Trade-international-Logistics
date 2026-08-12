// Builds the .xlsx workbook from a parsed CASS report (see cassPdfParser.js).
// Sheet layout mirrors the sub-reports inside the PDF so each one can be
// checked against the original page it came from.

import * as XLSX from 'xlsx'

function sheetFrom(rows, colWidths) {
  const ws = XLSX.utils.json_to_sheet(rows)
  if (colWidths) ws['!cols'] = colWidths.map((w) => ({ wch: w }))
  return ws
}

function w(...widths) { return widths }

export function buildCassWorkbook(parsed) {
  const { meta, paymentSummary, awbRows, airlineSummary, otherCharges, adjustments } = parsed
  const wb = XLSX.utils.book_new()

  // ── AWB Detail — one row per airwaybill, every airline ──────────────────────
  const detail = awbRows.map((r, i) => ({
    'SN':                       i + 1,
    'Airline Prefix':           r.airline_prefix,
    'Airline':                  r.airline_name ?? '',
    'AWB Number':               r.awb_number,
    'AWB Serial':               r.awb_serial,
    'SP IN':                    r.spin ?? '',
    'Origin':                   r.origin,
    'Destination':              r.destination,
    'Exec Date':                r.exec_date ?? '',
    'Weight (KG)':              r.weight,
    'Prepaid Weight Charges':   r.prepaid_weight_charges,
    'Prepaid Other Chgs (Airline)': r.prepaid_other_charges_airline,
    'Collect Weight Charges':   r.collect_weight_charges,
    'Collect Other Chgs (Agent)':   r.collect_other_charges_agent,
    'Commission':               r.commission,
    'Incentive':                r.incentive,
    'Net Amount Before Tax':    r.net_amount_before_tax,
    'Tax Withheld':             r.tax_withheld,
    'Net Amount Payable':       r.net_amount_payable,
  }))
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(detail, w(5, 8, 28, 16, 11, 6, 8, 11, 11, 12, 20, 22, 20, 22, 12, 11, 20, 12, 18)),
    'AWB Detail',
  )

  // ── Airline Summary — the Export Billing Statement ──────────────────────────
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

  // ── Other Charges Specification ─────────────────────────────────────────────
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

  // ── Additional Adjustments / BTA ────────────────────────────────────────────
  if (adjustments.length) {
    const adj = adjustments.map((a) => ({
      'Airline': a.airline_prefix,
      'Text':    a.text,
      'Amount':  a.amount,
      'BTN':     a.btn_number ?? '',
    }))
    XLSX.utils.book_append_sheet(wb, sheetFrom(adj, w(8, 60, 14, 8)), 'Adjustments (BTA)')
  }

  // ── Payment Summary + report metadata ───────────────────────────────────────
  const info = [
    ['CASS Cargo Sales Report'],
    [],
    ['Agent',            meta.agent ?? ''],
    ['IATA Numeric Code', meta.iata_code ?? ''],
    ['Currency',         meta.currency ?? ''],
    ['Billing Period',   meta.period_start && meta.period_end ? `${meta.period_start} to ${meta.period_end}` : ''],
    ['Report Date',      meta.report_date ?? ''],
    ['Remittance Date',  meta.remittance_date ?? ''],
    [],
    ['PAYMENT SUMMARY', 'Net Due Airline'],
    ['Net Due - Export', paymentSummary?.net_due_export ?? ''],
    ['Net Due - DIP',    paymentSummary?.net_due_dip ?? ''],
    ['Grand Total',      paymentSummary?.grand_total ?? ''],
    ['Total Payable',    paymentSummary?.total_payable ?? ''],
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

export function downloadCassWorkbook(parsed) {
  XLSX.writeFile(buildCassWorkbook(parsed), cassWorkbookFilename(parsed))
}
