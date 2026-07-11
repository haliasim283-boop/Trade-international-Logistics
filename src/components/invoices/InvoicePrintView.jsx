import { X, Printer } from 'lucide-react'
import { escapeHtml as esc } from '../../lib/escapeHtml'

// ── City name lookup ─────────────────────────────────────────────────────────

const CITY = {
  PEW: 'Peshawar',      ISB: 'Islamabad',    MUX: 'Multan',
  KHI: 'Karachi',       LHE: 'Lahore',       UET: 'Quetta',
  SKT: 'Sialkot',       DXB: 'Dubai',        SHJ: 'Sharjah',
  AUH: 'Abu Dhabi',     DOH: 'Doha',         BAH: 'Bahrain',
  MCT: 'Muscat',        JFK: 'New York',      ORD: 'Chicago',
  LHR: 'London',        FRA: 'Frankfurt',    CDG: 'Paris',
  BKK: 'Bangkok',       KUL: 'Kuala Lumpur', SIN: 'Singapore',
  CAN: 'Guangzhou',     PEK: 'Beijing',       PVG: 'Shanghai',
  BOM: 'Mumbai',        DEL: 'New Delhi',     MAA: 'Chennai',
  AMD: 'Ahmedabad',     HYD: 'Hyderabad',
}

function cityLabel(code) {
  if (!code) return ''
  const upper = code.toUpperCase()
  const name = CITY[upper]
  return name ? `${name} (${upper})` : upper
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatFullDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

// ── Print window HTML builder ────────────────────────────────────────────────

export function buildPrintHTML(invoice, clientName, clientCity) {
  const hasClearing   = Number(invoice.clearing_charges) > 0
  const hasFormE      = Number(invoice.form_e_amount) > 0
  const hasOther      = Number(invoice.other_charges) > 0
  const hasAmendment  = Number(invoice.amendment_charges) > 0
  const hasAdj        = invoice.adjustment_amount != null && Math.abs(Number(invoice.adjustment_amount)) > 0
  const hasAdvance    = Number(invoice.advance_payment_amount) > 0

  const rows = []

  rows.push(`
    <tr>
      <td class="desc">FREIGHT</td>
      <td class="num mono">${invoice.chargeable_weight ? `KGS ${Number(invoice.chargeable_weight).toFixed(3)}` : ''}</td>
      <td class="num mono">${invoice.net_rate ? `PKR ${fmt(invoice.net_rate)}` : ''}</td>
      <td class="num mono bold">PKR ${fmt(invoice.freight_amount)}</td>
    </tr>`)

  if (hasClearing) rows.push(`
    <tr>
      <td class="desc">CUSTOMS CLEARANCE CHARGES</td>
      <td></td><td></td>
      <td class="num mono bold">PKR ${fmt(invoice.clearing_charges)}</td>
    </tr>`)

  if (hasFormE) rows.push(`
    <tr>
      <td class="desc">FORM E PAYMENT</td>
      <td class="num mono">${invoice.form_e_usd_value ? `$${fmt(invoice.form_e_usd_value)}` : ''}</td>
      <td class="num mono">${invoice.form_e_pkr_rate ? `PKR ${fmt(invoice.form_e_pkr_rate)}` : ''}</td>
      <td class="num mono bold">PKR ${fmt(invoice.form_e_amount)}</td>
    </tr>`)

  if (hasOther) rows.push(`
    <tr>
      <td class="desc">AIRLINE OTHER CHARGES + AWB FEE</td>
      <td></td><td></td>
      <td class="num mono bold">PKR ${fmt(invoice.other_charges)}</td>
    </tr>`)

  if (hasAmendment) rows.push(`
    <tr>
      <td class="desc">AMENDMENT CHARGES</td>
      <td></td><td></td>
      <td class="num mono bold">PKR ${fmt(invoice.amendment_charges)}</td>
    </tr>`)

  if (hasAdj) rows.push(`
    <tr>
<<<<<<< HEAD
      <td class="desc">ADJUSTMENT BALANCE INV NO${invoice.adjustment_ref_invoice_no || ''}</td>
=======
      <td class="desc">ADJUSTMENT BALANCE INV NO ${esc(invoice.adjustment_ref_invoice_no)}</td>
>>>>>>> 743d2165e62a22c8c574e57a17fd4824669eef75
      <td></td><td></td>
      <td class="num mono bold" style="color:${Number(invoice.adjustment_amount) < 0 ? '#dc2626' : '#111'}">
        PKR ${fmt(invoice.adjustment_amount)}
      </td>
    </tr>`)

  if (hasAdvance) rows.push(`
    <tr>
      <td class="desc">ADVANCE PAYMENT RECEIVED${invoice.advance_payment_note ? ` — ${invoice.advance_payment_note}` : ''}</td>
      <td></td><td></td>
      <td class="num mono bold" style="color:#dc2626">
        PKR -${fmt(invoice.advance_payment_amount)}
      </td>
    </tr>`)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${esc(invoice.invoice_number)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111; background: white; }
    @page { size: A4; margin: 10mm; }

    .header { background: #1a2744; color: white; padding: 24px 32px; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .company-name { font-size: 20px; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase; }
    .company-addr { font-size: 10px; margin-top: 6px; opacity: 0.85; line-height: 1.7; }
    .inv-no-label { font-size: 10px; font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.7; text-align: right; }
    .inv-no { font-size: 26px; font-weight: bold; font-family: 'Courier New', monospace; text-align: right; letter-spacing: 0.05em; }
    .header-bill { margin-top: 18px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center; }
    .bill-for-label { font-size: 9px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.12em; }
    .bill-for-awb { font-size: 20px; font-weight: bold; margin-top: 3px; }
    .inv-date { font-size: 11px; opacity: 0.85; text-align: right; }

    .bill-to-section { display: flex; padding: 18px 32px; border-bottom: 1px solid #e5e7eb; gap: 48px; }
    .section-label { font-size: 8px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.12em; font-weight: bold; margin-bottom: 5px; }
    .bill-name { font-size: 14px; font-weight: bold; color: #111; }
    .bill-city { font-size: 12px; color: #374151; margin-top: 2px; }
    .for-route { font-size: 13px; color: #374151; line-height: 1.6; }
    .for-pcs { font-size: 11px; color: #6b7280; margin-top: 4px; }

    .line-items { padding: 24px 32px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 600; color: #374151; background: #f3f4f6; border-bottom: 2px solid #e5e7eb; }
    th.num, td.num { text-align: right; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
    td.mono { font-family: 'Courier New', monospace; }
    td.bold { font-weight: 600; color: #111; }
    .balance-row td { background: #1a2744 !important; color: white; font-weight: bold; padding: 13px 12px; }
    .balance-row td:first-child { font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
    .balance-row td.num { font-size: 16px; }

    .notes { padding: 0 32px 18px; font-size: 11px; color: #6b7280; }

    .footer { margin: 0 32px; padding: 18px 0 24px; border-top: 2px solid #1a2744; }
    .footer-payable { font-weight: bold; color: #111; margin-bottom: 10px; font-size: 12px; }
    .footer-bank { font-size: 11px; color: #374151; line-height: 2.2; }
    .iban { font-family: 'Courier New', monospace; color: #1a2744; font-weight: bold; }
    .footer-contact-lbl { font-size: 9px; color: #6b7280; margin: 8px 0 4px; }
    .footer-contact { font-weight: bold; color: #111; font-size: 11px; }
    .footer-thanks { margin-top: 20px; text-align: center; font-weight: bold; color: #1a2744; font-size: 14px; letter-spacing: 0.06em; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div>
        <div class="company-name">Trade International Logistics</div>
        <div class="company-addr">
          Room No. 4, 1st Floor, Khair Mohammad Plaza<br>
          Opp. State Bank of Pakistan, 8-A Saddar Road<br>
          Peshawar Cantt, Pakistan<br>
          IATA: 27-3 0688/0005 &nbsp;&nbsp;|&nbsp;&nbsp; VAT: 3044153-6
        </div>
      </div>
      <div>
        <div class="inv-no-label">Invoice No.</div>
        <div class="inv-no">${esc(invoice.invoice_number)}</div>
      </div>
    </div>
    <div class="header-bill">
      <div>
        <div class="bill-for-label">Bill For</div>
        <div class="bill-for-awb">${esc(invoice.awb_number)}</div>
      </div>
      <div class="inv-date">${formatFullDate(invoice.invoice_date)}</div>
    </div>
  </div>

  <div class="bill-to-section">
    <div>
      <div class="section-label">Bill To</div>
      <div class="bill-name">${esc(clientName)}</div>
      <div class="bill-city">${esc(clientCity)}</div>
    </div>
    <div>
      <div class="section-label">For</div>
      <div class="for-route"><strong>${cityLabel(invoice.origin)}</strong>&nbsp; TO &nbsp;<strong>${cityLabel(invoice.destination)}</strong></div>
      ${(invoice.pieces || invoice.chargeable_weight) ? `<div class="for-pcs">${invoice.pieces || ''} PCS &nbsp;/&nbsp; ${Number(invoice.chargeable_weight || 0).toFixed(3)} KGS</div>` : ''}
    </div>
  </div>

  <div class="line-items">
    <table>
      <thead>
        <tr>
          <th style="width:44%">Description</th>
          <th class="num" style="width:18%">Weight</th>
          <th class="num" style="width:19%">Rate</th>
          <th class="num" style="width:19%">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join('')}
        <tr class="balance-row">
          <td colspan="3">BALANCE</td>
          <td class="num mono">PKR ${fmt(invoice.total_amount)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${invoice.notes ? `<div class="notes"><strong>Notes:</strong> ${esc(invoice.notes)}</div>` : ''}

  <div class="footer">
    <div class="footer-payable">Make all checks payable to Trade International Logistics</div>
    <div class="footer-bank">
      <span class="iban">PK49SIND0008016416561000</span> &nbsp;|&nbsp; <strong>SINDH BANK</strong> &nbsp;|&nbsp; TRADE INTL
    </div>
    <div class="footer-bank">
      <span class="iban">PK80BAHL0471098101649301</span> &nbsp;|&nbsp; <strong>BANK AL HABIB</strong> &nbsp;|&nbsp; HAIDER ALI
    </div>
    <div class="footer-contact-lbl">If you have any questions concerning this invoice, use the following contact information:</div>
    <div class="footer-contact">HAIDER ALI &nbsp;|&nbsp; 03028582323 &nbsp;|&nbsp; halitrade0688@gmail.com</div>
    <div class="footer-thanks">Thank you for your business!</div>
  </div>
</body>
</html>`
}

// ── React preview component ───────────────────────────────────────────────────

export function InvoicePrintView({ invoice, clientName, clientCity, onClose }) {
  const hasClearing  = Number(invoice.clearing_charges) > 0
  const hasFormE     = Number(invoice.form_e_amount) > 0
  const hasOther     = Number(invoice.other_charges) > 0
  const hasAmendment = Number(invoice.amendment_charges) > 0
  const hasAdj       = invoice.adjustment_amount != null && Math.abs(Number(invoice.adjustment_amount)) > 0
  const hasAdvance   = Number(invoice.advance_payment_amount) > 0

  function handlePrint() {
    const w = window.open('', '_blank')
    if (!w) { alert('Please allow pop-ups for this site to enable printing.'); return }
    w.document.write(buildPrintHTML(invoice, clientName, clientCity))
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  // ── Shared cell styles ───────────────────────────────────────────────────

  const tdBase = { padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }
  const tdNum  = { ...tdBase, textAlign: 'right', fontFamily: 'monospace' }
  const tdBold = { ...tdNum, fontWeight: 600, color: '#111' }

  return (
    <div className="fixed inset-0 z-50 bg-gray-300 overflow-y-auto py-8">

      {/* Controls */}
      <div className="flex justify-center mb-6 gap-3 print:hidden">
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 bg-navy text-white px-5 py-2.5 rounded-md font-medium hover:bg-navy-light transition-colors shadow-md"
        >
          <Printer className="w-4 h-4" /> Print / Save PDF
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-2 bg-white text-gray-700 px-5 py-2.5 rounded-md font-medium border border-gray-300 hover:bg-gray-50 transition-colors shadow-md"
        >
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      {/* A4 invoice document (preview) */}
      <div
        className="mx-auto bg-white shadow-2xl"
        style={{ width: 794, minHeight: 1123, fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div style={{ backgroundColor: '#1a2744', color: 'white', padding: '24px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 'bold', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Trade International Logistics
              </div>
              <div style={{ fontSize: 10, marginTop: 6, opacity: 0.85, lineHeight: 1.75 }}>
                Room No. 4, 1st Floor, Khair Mohammad Plaza<br />
                Opp. State Bank of Pakistan, 8-A Saddar Road<br />
                Peshawar Cantt, Pakistan<br />
                IATA: 27-3 0688/0005 &nbsp;|&nbsp; VAT: 3044153-6
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>
                Invoice No.
              </div>
              <div style={{ fontSize: 26, fontWeight: 'bold', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                {invoice.invoice_number}
              </div>
            </div>
          </div>

          {/* Bill For + Date */}
          <div style={{
            marginTop: 18, paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.2)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 9, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Bill For</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', marginTop: 3 }}>{invoice.awb_number}</div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, textAlign: 'right' }}>
              {formatFullDate(invoice.invoice_date)}
            </div>
          </div>
        </div>

        {/* ── Bill To / For ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', padding: '18px 32px', borderBottom: '1px solid #e5e7eb', gap: 48 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 'bold', marginBottom: 5 }}>
              Bill To
            </div>
            <div style={{ fontSize: 14, fontWeight: 'bold', color: '#111' }}>{clientName}</div>
            <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{clientCity}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 'bold', marginBottom: 5 }}>
              For
            </div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
              <strong>{cityLabel(invoice.origin)}</strong>
              {' '}<span style={{ opacity: 0.6 }}>TO</span>{' '}
              <strong>{cityLabel(invoice.destination)}</strong>
            </div>
            {(invoice.pieces || invoice.chargeable_weight) && (
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                {invoice.pieces} PCS &nbsp;/&nbsp; {Number(invoice.chargeable_weight || 0).toFixed(3)} KGS
              </div>
            )}
          </div>
        </div>

        {/* ── Line Items ───────────────────────────────────────────────── */}
        <div style={{ padding: '24px 32px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6' }}>
                <th style={{ textAlign: 'left',  padding: '10px 12px', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb', fontSize: 11, width: '44%' }}>Description</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb', fontSize: 11, width: '18%' }}>Weight</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb', fontSize: 11, width: '19%' }}>Rate</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb', fontSize: 11, width: '19%' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {/* FREIGHT */}
              <tr>
                <td style={tdBase}>FREIGHT</td>
                <td style={tdNum}>{invoice.chargeable_weight ? `KGS ${Number(invoice.chargeable_weight).toFixed(3)}` : ''}</td>
                <td style={tdNum}>{invoice.net_rate ? `PKR ${fmt(invoice.net_rate)}` : ''}</td>
                <td style={tdBold}>PKR {fmt(invoice.freight_amount)}</td>
              </tr>

              {/* CUSTOMS CLEARANCE */}
              {hasClearing && (
                <tr>
                  <td style={tdBase}>CUSTOMS CLEARANCE CHARGES</td>
                  <td style={tdBase} /><td style={tdBase} />
                  <td style={tdBold}>PKR {fmt(invoice.clearing_charges)}</td>
                </tr>
              )}

              {/* FORM E */}
              {hasFormE && (
                <tr>
                  <td style={tdBase}>FORM E PAYMENT</td>
                  <td style={tdNum}>{invoice.form_e_usd_value ? `$${fmt(invoice.form_e_usd_value)}` : ''}</td>
                  <td style={tdNum}>{invoice.form_e_pkr_rate ? `PKR ${fmt(invoice.form_e_pkr_rate)}` : ''}</td>
                  <td style={tdBold}>PKR {fmt(invoice.form_e_amount)}</td>
                </tr>
              )}

              {/* OTHER CHARGES */}
              {hasOther && (
                <tr>
                  <td style={tdBase}>AIRLINE OTHER CHARGES + AWB FEE</td>
                  <td style={tdBase} /><td style={tdBase} />
                  <td style={tdBold}>PKR {fmt(invoice.other_charges)}</td>
                </tr>
              )}

              {/* AMENDMENT CHARGES */}
              {hasAmendment && (
                <tr>
                  <td style={tdBase}>AMENDMENT CHARGES</td>
                  <td style={tdBase} /><td style={tdBase} />
                  <td style={tdBold}>PKR {fmt(invoice.amendment_charges)}</td>
                </tr>
              )}

              {/* ADJUSTMENT */}
              {hasAdj && (
                <tr>
                  <td style={tdBase}>ADJUSTMENT BALANCE INV NO {invoice.adjustment_ref_invoice_no}</td>
                  <td style={tdBase} /><td style={tdBase} />
                  <td style={{ ...tdBold, color: Number(invoice.adjustment_amount) < 0 ? '#dc2626' : '#111' }}>
                    PKR {fmt(invoice.adjustment_amount)}
                  </td>
                </tr>
              )}

              {/* ADVANCE PAYMENT */}
              {hasAdvance && (
                <tr>
                  <td style={tdBase}>
                    ADVANCE PAYMENT RECEIVED{invoice.advance_payment_note ? ` — ${invoice.advance_payment_note}` : ''}
                  </td>
                  <td style={tdBase} /><td style={tdBase} />
                  <td style={{ ...tdBold, color: '#dc2626' }}>
                    PKR -{fmt(invoice.advance_payment_amount)}
                  </td>
                </tr>
              )}

              {/* BALANCE */}
              <tr>
                <td
                  colSpan={3}
                  style={{ backgroundColor: '#1a2744', color: 'white', padding: '13px 12px', fontWeight: 'bold', fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  BALANCE
                </td>
                <td
                  style={{ backgroundColor: '#1a2744', color: 'white', padding: '13px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 16 }}
                >
                  PKR {fmt(invoice.total_amount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div style={{ padding: '0 32px 18px', fontSize: 11, color: '#6b7280' }}>
            <strong>Notes:</strong> {invoice.notes}
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div style={{ margin: '0 32px', padding: '18px 0 28px', borderTop: '2px solid #1a2744' }}>
          <div style={{ fontWeight: 'bold', color: '#111', marginBottom: 10, fontSize: 12 }}>
            Make all checks payable to Trade International Logistics
          </div>
          <div style={{ fontSize: 11, color: '#374151', lineHeight: 2.2 }}>
            <div>
              <span style={{ fontFamily: 'monospace', color: '#1a2744', fontWeight: 'bold' }}>PK49SIND0008016416561000</span>
              &nbsp;&nbsp;|&nbsp;&nbsp;<strong>SINDH BANK</strong>&nbsp;&nbsp;|&nbsp;&nbsp;TRADE INTL
            </div>
            <div>
              <span style={{ fontFamily: 'monospace', color: '#1a2744', fontWeight: 'bold' }}>PK80BAHL0471098101649301</span>
              &nbsp;&nbsp;|&nbsp;&nbsp;<strong>BANK AL HABIB</strong>&nbsp;&nbsp;|&nbsp;&nbsp;HAIDER ALI
            </div>
          </div>
          <div style={{ fontSize: 9, color: '#6b7280', margin: '8px 0 4px' }}>
            If you have any questions concerning this invoice, use the following contact information:
          </div>
          <div style={{ fontWeight: 'bold', color: '#111', fontSize: 11 }}>
            HAIDER ALI &nbsp;|&nbsp; 03028582323 &nbsp;|&nbsp; halitrade0688@gmail.com
          </div>
          <div style={{ marginTop: 20, textAlign: 'center', fontWeight: 'bold', color: '#1a2744', fontSize: 14, letterSpacing: '0.06em' }}>
            Thank you for your business!
          </div>
        </div>
      </div>
    </div>
  )
}
