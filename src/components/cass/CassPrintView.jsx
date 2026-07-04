// Opens CASS report in a new print window (A4 landscape)

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

export function printCassReport({ airline, period, rows, recap, adjustments, payments, settings }) {
  const awbRows = rows.map((r, i) => `
    <tr class="${r.isAdj ? 'adj-row' : ''}">
      <td class="center">${r.isAdj ? '—' : i + 1}</td>
      <td class="mono">${r.awb_number || '—'}</td>
      <td class="center">${r.origin || ''}</td>
      <td class="center">${r.destination || ''}</td>
      <td class="num">${r.isAdj ? '' : Number(r.chargeable_weight || 0).toFixed(3)}</td>
      <td class="num">${r.isAdj ? '' : fmt(r.pwc)}</td>
      <td class="num">${r.isAdj ? '' : fmt(r.commission)}</td>
      <td class="num">${r.isAdj ? '' : fmt(r.oc_airline)}</td>
      <td class="num">${r.isAdj ? '' : fmt(r.incentive)}</td>
      <td class="num">${r.isAdj ? '' : (recap.isPia ? (r.tax_withheld > 0 ? `(${fmt(r.tax_withheld)})` : '&mdash;') : 'Nil')}</td>
      <td class="center">${r.isAdj ? '—' : i + 1}</td>
      <td class="num bold">${fmt(r.isAdj ? r.amount : r.net_amount)}</td>
    </tr>`).join('')

  const adjRows = adjustments.map((a) => `
    <tr>
      <td colspan="2" class="label">${a.description}</td>
      <td colspan="10"></td>
      <td class="num ${Number(a.amount) >= 0 ? '' : 'credit'}">${Number(a.amount) >= 0 ? '+' : ''}${fmt(a.amount)}</td>
    </tr>`).join('')

  const payRows = payments.map((p) => `
    <tr>
      <td>${fmtDate(p.payment_date)}</td>
      <td>${p.bank_account || ''}</td>
      <td class="num">${fmt(p.amount)}</td>
      <td>${p.transaction_id || ''}</td>
      <td>${p.notes || ''}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>CASS Report — ${airline?.name} — ${period.label}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Arial', sans-serif; }
    body { font-size: 9pt; color: #1a1a2e; background: white; }

    .header { background: #1a2744; color: white; padding: 10px 14px; display: flex; justify-content: space-between; align-items: flex-start; border-radius: 4px 4px 0 0; }
    .header-left h1 { font-size: 13pt; font-weight: bold; letter-spacing: 0.03em; }
    .header-left p  { font-size: 7.5pt; opacity: 0.85; margin-top: 2px; line-height: 1.4; }
    .header-right   { text-align: right; }
    .header-right .report-title { font-size: 11pt; font-weight: bold; }
    .header-right .period       { font-size: 9pt; opacity: 0.9; margin-top: 3px; }
    .header-right .iata         { font-size: 7.5pt; opacity: 0.75; margin-top: 2px; }

    .meta-bar { background: #f0f4ff; border: 1px solid #c7d2fe; border-top: none; padding: 6px 14px; display: flex; gap: 24px; font-size: 8pt; }
    .meta-bar span { color: #374151; }
    .meta-bar strong { color: #1a2744; }

    h2.section { font-size: 9pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; color: #1a2744; margin: 12px 0 4px; border-bottom: 2px solid #1a2744; padding-bottom: 2px; }

    table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    th { background: #1a2744; color: white; padding: 4px 5px; text-align: left; font-size: 7pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
    td { padding: 3px 5px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
    tr:nth-child(even) td { background: #f9fafb; }
    .num   { text-align: right; font-family: 'Courier New', monospace; }
    .center { text-align: center; }
    .mono  { font-family: 'Courier New', monospace; font-size: 8pt; }
    .bold  { font-weight: bold; }
    .label { font-style: italic; color: #6b7280; }
    .credit { color: #16a34a; }
    .danger { color: #dc2626; }
    .adj-row td { background: #fffbeb !important; font-style: italic; }

    .total-row td { background: #1a2744 !important; color: white; font-weight: bold; border: none; }

    .recap { width: 60%; margin-left: auto; margin-top: 8px; border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; }
    .recap table { font-size: 8.5pt; }
    .recap td { padding: 4px 10px; border-bottom: 1px solid #e5e7eb; }
    .recap td:last-child { text-align: right; font-family: 'Courier New', monospace; }
    .recap .recap-sub { color: #6b7280; }
    .recap .recap-total td { background: #f3f4f6; font-weight: bold; border-top: 2px solid #9ca3af; }
    .recap .grand td { background: #1a2744; color: white; font-weight: bold; font-size: 9pt; border: none; }
    .recap .bta-row td { color: #b45309; }
    .recap .wht-row td { color: #7c3aed; }

    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 7.5pt; font-weight: bold; text-transform: uppercase; }
    .status-Pending { background: #fef3c7; color: #92400e; }
    .status-Billed  { background: #dbeafe; color: #1e40af; }
    .status-Paid    { background: #d1fae5; color: #065f46; }

    .payments-table th { background: #374151; }

    .footer { margin-top: 14px; font-size: 7pt; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 6px; }

    @media print { button { display: none !important; } }
  </style>
</head>
<body>

  <div class="header">
    <div class="header-left">
      <h1>${settings?.company_name ?? 'TRADE INTERNATIONAL LOGISTICS'}</h1>
      <p>${settings?.company_address ?? ''}</p>
      <p>IATA: ${settings?.iata_code ?? ''} &nbsp;|&nbsp; VAT: ${settings?.vat_registration ?? ''}</p>
    </div>
    <div class="header-right">
      <div class="report-title">AIRLINE SALES REPORT (CASS)</div>
      <div class="period">${airline?.name ?? ''} &mdash; ${period.label}</div>
      <div class="period">Period: ${fmtDate(period.start)} &ndash; ${fmtDate(period.end)}</div>
      <div class="iata">Airline Prefix: ${airline?.iata_prefix ?? ''} &nbsp;|&nbsp; Commission: USD ${Number(airline?.cass_commission_usd_per_kg ?? 0).toFixed(4)}/kg</div>
    </div>
  </div>

  <div class="meta-bar">
    <span><strong>AWBs:</strong> ${recap.awbCount}</span>
    <span><strong>Total Weight:</strong> ${Number(recap.totalWeight || 0).toFixed(3)} KGS</span>
    <span><strong>Status:</strong> <span class="status-badge status-${recap.status}">${recap.status}</span></span>
    <span><strong>Printed:</strong> ${new Date().toLocaleDateString('en-GB')}</span>
  </div>

  <h2 class="section">Per-AWB Detail</h2>
  <table>
    <thead>
      <tr>
        <th class="center">SN</th>
        <th>AWB No.</th>
        <th class="center">ORG</th>
        <th class="center">DST</th>
        <th class="num">Weight<br/>(KGS)</th>
        <th class="num">Prepaid Wgt<br/>Charges</th>
        <th class="num">Commission</th>
        <th class="num">OC Due<br/>Airline</th>
        <th class="num">Incentive</th>
        <th class="num">Tax<br/>Withheld</th>
        <th class="center">SPIN</th>
        <th class="num">Net<br/>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${awbRows}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="4" class="bold">TOTALS</td>
        <td class="num">${Number(recap.totalWeight || 0).toFixed(3)}</td>
        <td class="num">${fmt(recap.totalPWC)}</td>
        <td class="num">${fmt(recap.totalCommission)}</td>
        <td class="num">${fmt(recap.totalOCAirline)}</td>
        <td class="num">${fmt(recap.totalIncentive)}</td>
        <td class="num">${recap.isPia ? `(${fmt(recap.totalWHT)})` : 'Nil'}</td>
        <td></td>
        <td class="num">${fmt(recap.totalNet)}</td>
      </tr>
    </tfoot>
  </table>

  <h2 class="section" style="margin-top:14px">Recapitulation</h2>
  <div class="recap">
    <table>
      <tr><td>Total Commissionable Sales (Weight Charges)</td><td>PKR ${fmt(recap.totalPWC)}</td></tr>
      <tr><td class="recap-sub">&nbsp;&nbsp;Less: Commission Due Agent (USD ${Number(airline?.cass_commission_usd_per_kg ?? 0).toFixed(4)}/kg)</td><td>(${fmt(recap.totalCommission)})</td></tr>
      ${recap.totalOCAirline > 0 ? `<tr><td class="recap-sub">&nbsp;&nbsp;Other Charges Due Airline</td><td>+${fmt(recap.totalOCAirline)}</td></tr>` : ''}
      ${recap.isPia && recap.totalWHT > 0 ? `<tr class="wht-row"><td class="recap-sub">&nbsp;&nbsp;WHT @ ${settings?.cass_wht_rate ?? 12}% of Profit</td><td>+${fmt(recap.totalWHT)}</td></tr>` : ''}
      ${adjustments.map((a) => `<tr><td class="recap-sub">&nbsp;&nbsp;${a.description}</td><td class="${Number(a.amount) < 0 ? 'credit' : ''}">${Number(a.amount) >= 0 ? '+' : ''}${fmt(a.amount)}</td></tr>`).join('')}
      <tr class="recap-total"><td>Net Due Export</td><td>PKR ${fmt(recap.netDueExport)}</td></tr>
      <tr class="grand"><td>GRAND TOTAL PAYABLE</td><td>PKR ${fmt(recap.grandTotal)}</td></tr>
    </table>
  </div>

  ${payments.length > 0 ? `
  <h2 class="section" style="margin-top:14px">Payment History</h2>
  <table class="payments-table" style="width:60%;margin-left:auto">
    <thead><tr><th>Date</th><th>Bank</th><th class="num">Amount</th><th>Ref / TRX</th><th>Notes</th></tr></thead>
    <tbody>${payRows}</tbody>
    <tfoot>
      <tr style="background:#f3f4f6;font-weight:bold;">
        <td colspan="2">Total Paid</td>
        <td class="num">PKR ${fmt(recap.totalPaid)}</td>
        <td colspan="2"></td>
      </tr>
      <tr style="background:${recap.balanceDue > 0 ? '#fef2f2' : '#f0fdf4'};font-weight:bold;">
        <td colspan="2">Balance Due</td>
        <td class="num ${recap.balanceDue > 0 ? 'danger' : ''}">PKR ${fmt(recap.balanceDue)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>` : ''}

  <div class="footer">
    Generated by Trade International Logistics Management System &bull; ${new Date().toLocaleString('en-GB')}
  </div>

  <script>window.onload = () => window.print()</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=1200,height=850')
  win.document.write(html)
  win.document.close()
}
