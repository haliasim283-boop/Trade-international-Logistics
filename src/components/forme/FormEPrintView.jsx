// Opens Form E Supplier Report in a new print window (A4 portrait)

import { escapeHtml as esc } from '../../lib/escapeHtml'

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

export function printFormEReport({ supplier, shipments, payments, summary, dateFrom, dateTo, settings }) {
  const rows = shipments.map((s) => `
    <tr>
      <td>${fmtDate(s.flight_date)}</td>
      <td class="mono">${esc(s.awb_number)}</td>
      <td>${esc(s.clients?.name) || '—'}</td>
      <td class="num">$ ${fmt(s.form_e_usd_value)}</td>
      <td class="num">${fmt(s.form_e_pkr_rate_payable)}</td>
      <td class="num bold">PKR ${fmt(Number(s.form_e_usd_value || 0) * Number(s.form_e_pkr_rate_payable || 0))}</td>
    </tr>`).join('')

  const payRows = payments.map((p) => `
    <tr>
      <td>${fmtDate(p.payment_date)}</td>
      <td>${esc(p.bank_account)}</td>
      <td class="num">PKR ${fmt(p.amount)}</td>
      <td>${esc(p.transaction_id)}</td>
      <td>${esc(p.notes)}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Form E Report — ${esc(supplier?.name)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; }
    body { font-size: 9.5pt; color: #1a1a2e; background: white; }

    .header { background: #1a2744; color: white; padding: 10px 14px; border-radius: 4px 4px 0 0;
              display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { font-size: 12pt; font-weight: bold; letter-spacing: 0.03em; }
    .header p  { font-size: 7.5pt; opacity: 0.85; margin-top: 2px; line-height: 1.5; }
    .header-right { text-align: right; }
    .header-right .title { font-size: 10pt; font-weight: bold; }
    .header-right .sub   { font-size: 8pt; opacity: 0.85; margin-top: 3px; }

    .meta { background: #f0f4ff; border: 1px solid #c7d2fe; border-top: none;
            padding: 6px 14px; font-size: 8pt; display: flex; gap: 20px; }
    .meta span { color: #374151; }
    .meta strong { color: #1a2744; }

    h2.section { font-size: 8.5pt; font-weight: bold; text-transform: uppercase;
                 letter-spacing: 0.08em; color: #1a2744; margin: 12px 0 4px;
                 border-bottom: 2px solid #1a2744; padding-bottom: 2px; }

    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    th { background: #1a2744; color: white; padding: 4px 7px; text-align: left;
         font-size: 7.5pt; font-weight: bold; text-transform: uppercase; }
    td { padding: 4px 7px; border-bottom: 1px solid #e5e7eb; }
    tr:nth-child(even) td { background: #f9fafb; }
    .num  { text-align: right; font-family: 'Courier New', monospace; }
    .mono { font-family: 'Courier New', monospace; font-size: 8pt; }
    .bold { font-weight: bold; }
    .danger { color: #dc2626; }
    .ok     { color: #16a34a; }

    tfoot tr td { background: #1a2744 !important; color: white; font-weight: bold;
                  border: none; padding: 5px 7px; }

    .summary-box { border: 1px solid #d1d5db; border-radius: 4px; margin-top: 8px;
                   overflow: hidden; width: 55%; margin-left: auto; }
    .summary-box table { font-size: 9pt; }
    .summary-box td { padding: 5px 10px; border-bottom: 1px solid #e5e7eb; }
    .summary-box td:last-child { text-align: right; font-family: 'Courier New', monospace; }
    .summary-box .grand td { background: #1a2744; color: white; font-weight: bold; border: none; }
    .summary-box .balance-due td { background: #fef2f2; color: #dc2626; font-weight: bold; }
    .summary-box .balance-ok td { background: #f0fdf4; color: #15803d; font-weight: bold; }

    .pay-table th { background: #374151; }

    .footer { margin-top: 14px; font-size: 7pt; color: #9ca3af; text-align: center;
              border-top: 1px solid #e5e7eb; padding-top: 6px; }
    @media print { button { display: none !important; } }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <h1>${esc(settings?.company_name) || 'TRADE INTERNATIONAL LOGISTICS'}</h1>
      <p>${esc(settings?.company_address)}</p>
      <p>IATA: ${esc(settings?.iata_code)} &nbsp;|&nbsp; VAT: ${esc(settings?.vat_registration)}</p>
    </div>
    <div class="header-right">
      <div class="title">FORM E SUPPLIER REPORT</div>
      <div class="sub">${esc(supplier?.name)}</div>
      <div class="sub">Period: ${fmtDate(dateFrom)} &ndash; ${fmtDate(dateTo)}</div>
    </div>
  </div>

  <div class="meta">
    <span><strong>Supplier:</strong> ${esc(supplier?.name)}</span>
    ${supplier?.contact_person ? `<span><strong>Contact:</strong> ${esc(supplier.contact_person)}</span>` : ''}
    ${supplier?.phone ? `<span><strong>Phone:</strong> ${esc(supplier.phone)}</span>` : ''}
    <span><strong>Shipments:</strong> ${shipments.length}</span>
    <span><strong>Printed:</strong> ${new Date().toLocaleDateString('en-GB')}</span>
  </div>

  <h2 class="section">Form E Transactions</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>AWB No.</th>
        <th>Client</th>
        <th class="num">USD Value</th>
        <th class="num">PKR Rate Payable</th>
        <th class="num">Form E Amount (PKR)</th>
      </tr>
    </thead>
    <tbody>
      ${shipments.length === 0
        ? `<tr><td colspan="6" style="text-align:center;padding:16px;color:#9ca3af">No Form E shipments in this period.</td></tr>`
        : rows
      }
    </tbody>
    ${shipments.length > 0 ? `
    <tfoot>
      <tr>
        <td colspan="3" class="bold">PERIOD TOTALS</td>
        <td class="num">$ ${fmt(summary.totalUSD)}</td>
        <td class="num">PKR ${fmt(shipments.reduce((acc, s) => acc + Number(s.form_e_usd_value || 0) * Number(s.form_e_pkr_rate_payable || 0), 0))}</td>
      </tr>
    </tfoot>` : ''}
  </table>

  <h2 class="section" style="margin-top:14px">Summary</h2>
  <div class="summary-box">
    <table>
      <tr><td>Total Form E Transactions (Period)</td><td>${shipments.length}</td></tr>
      <tr><td>Total USD Value</td><td>$ ${fmt(summary.totalUSD)}</td></tr>
      <tr><td>Total PKR Payable (Period)</td><td>PKR ${fmt(summary.totalPKR)}</td></tr>
      <tr><td>Total Paid (All Time)</td><td class="ok">PKR ${fmt(summary.totalPaid)}</td></tr>
      <tr class="${summary.balanceDue > 0 ? 'balance-due' : 'balance-ok'}">
        <td>Balance Due</td>
        <td>PKR ${fmt(summary.balanceDue)}</td>
      </tr>
    </table>
  </div>

  ${payments.length > 0 ? `
  <h2 class="section" style="margin-top:14px">Payment History</h2>
  <table class="pay-table" style="width:70%;margin-left:auto">
    <thead><tr><th>Date</th><th>Bank / Method</th><th class="num">Amount</th><th>Ref / TRX</th><th>Notes</th></tr></thead>
    <tbody>${payRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="2">Total Paid</td>
        <td class="num">PKR ${fmt(summary.totalPaid)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>` : ''}

  <div class="footer">
    Generated by Trade International Logistics Management System &bull; ${new Date().toLocaleString('en-GB')}
  </div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=900,height=1100')
  win.document.write(html)
  win.document.close()
  setTimeout(() => { win.focus(); win.print() }, 400)
}
