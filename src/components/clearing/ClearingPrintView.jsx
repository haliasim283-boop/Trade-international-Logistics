// Opens Clearing Agent Report in a new print window (A4 portrait)

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

export function printClearingReport({ agent, shipments, payments, summary, dateFrom, dateTo, settings }) {
  const rows = shipments.map((s) => `
    <tr>
      <td>${fmtDate(s.flight_date)}</td>
      <td class="mono">${s.awb_number}</td>
      <td>${s.clients?.name ?? '—'}</td>
      <td class="center">${s.origin}</td>
      <td class="num">${s.pieces ?? ''}</td>
      <td class="num">${Number(s.chargeable_weight || 0).toFixed(3)}</td>
      <td class="num bold">PKR ${fmt(s.clearing_charges)}</td>
    </tr>`).join('')

  const payRows = payments.map((p) => `
    <tr>
      <td>${fmtDate(p.payment_date)}</td>
      <td>${p.bank_account || ''}</td>
      <td class="num">PKR ${fmt(p.amount)}</td>
      <td>${p.transaction_id || ''}</td>
      <td>${p.notes || ''}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Clearing Agent Report — ${agent?.name}</title>
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
    .num    { text-align: right; font-family: 'Courier New', monospace; }
    .center { text-align: center; }
    .mono   { font-family: 'Courier New', monospace; font-size: 8pt; }
    .bold   { font-weight: bold; }
    .danger { color: #dc2626; }
    .ok     { color: #16a34a; }

    tfoot tr td { background: #1a2744 !important; color: white; font-weight: bold;
                  border: none; padding: 5px 7px; }

    .summary-box { border: 1px solid #d1d5db; border-radius: 4px; margin-top: 8px;
                   overflow: hidden; width: 55%; margin-left: auto; }
    .summary-box table { font-size: 9pt; }
    .summary-box td { padding: 5px 10px; border-bottom: 1px solid #e5e7eb; }
    .summary-box td:last-child { text-align: right; font-family: 'Courier New', monospace; }
    .summary-box .balance-due td { background: #fef2f2; color: #dc2626; font-weight: bold; }
    .summary-box .balance-ok  td { background: #f0fdf4; color: #15803d; font-weight: bold; }

    .pay-table th { background: #374151; }

    .inhouse-banner { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 4px;
                      padding: 6px 10px; font-size: 8pt; color: #92400e; margin-top: 6px; }

    .footer { margin-top: 14px; font-size: 7pt; color: #9ca3af; text-align: center;
              border-top: 1px solid #e5e7eb; padding-top: 6px; }
    @media print { button { display: none !important; } }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <h1>${settings?.company_name ?? 'TRADE INTERNATIONAL LOGISTICS'}</h1>
      <p>${settings?.company_address ?? ''}</p>
      <p>IATA: ${settings?.iata_code ?? ''} &nbsp;|&nbsp; VAT: ${settings?.vat_registration ?? ''}</p>
    </div>
    <div class="header-right">
      <div class="title">CLEARING AGENT REPORT</div>
      <div class="sub">${agent?.name ?? ''} — ${agent?.city ?? ''} (${agent?.origin_code ?? ''})</div>
      <div class="sub">Period: ${fmtDate(dateFrom)} &ndash; ${fmtDate(dateTo)}</div>
    </div>
  </div>

  <div class="meta">
    <span><strong>Agent:</strong> ${agent?.name ?? ''}</span>
    <span><strong>City:</strong> ${agent?.city ?? ''} (${agent?.origin_code ?? ''})</span>
    <span><strong>Rate/Shipment:</strong> PKR ${fmt(agent?.per_shipment_charge)}</span>
    <span><strong>Shipments:</strong> ${summary.totalShipments}</span>
    <span><strong>Printed:</strong> ${new Date().toLocaleDateString('en-GB')}</span>
  </div>

  ${agent?.is_in_house ? `<div class="inhouse-banner">⚠ In-house clearing agent — charges are internal records, not a payable to an external party.</div>` : ''}

  <h2 class="section">Clearing Charges Detail</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>AWB No.</th>
        <th>Client</th>
        <th class="center">Origin</th>
        <th class="num">Pieces</th>
        <th class="num">Weight (KGS)</th>
        <th class="num">Clearing Charge (PKR)</th>
      </tr>
    </thead>
    <tbody>
      ${shipments.length === 0
        ? `<tr><td colspan="7" style="text-align:center;padding:16px;color:#9ca3af">No shipments cleared by this agent in the selected period.</td></tr>`
        : rows
      }
    </tbody>
    ${shipments.length > 0 ? `
    <tfoot>
      <tr>
        <td colspan="4" class="bold">PERIOD TOTALS</td>
        <td class="num">${summary.totalPieces}</td>
        <td class="num">${Number(summary.totalWeight).toFixed(3)}</td>
        <td class="num">PKR ${fmt(summary.totalCharges)}</td>
      </tr>
    </tfoot>` : ''}
  </table>

  <h2 class="section" style="margin-top:14px">Summary</h2>
  <div class="summary-box">
    <table>
      <tr><td>Total Shipments (Period)</td><td>${summary.totalShipments}</td></tr>
      <tr><td>Total Weight</td><td>${Number(summary.totalWeight).toFixed(3)} KGS</td></tr>
      <tr><td>Total Clearing Charges (Period)</td><td>PKR ${fmt(summary.totalCharges)}</td></tr>
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

  <script>window.onload = () => window.print()</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=900,height=1100')
  win.document.write(html)
  win.document.close()
}
