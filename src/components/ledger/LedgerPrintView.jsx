import { X, Printer } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

// ── HTML builder (new print window) ──────────────────────────────────────────

export function buildPrintHTML(entries, client, summary, dateLabel) {
  const rows = entries.map((e) => {
    if (e.type === 'opening' || e.type === 'carry-forward') {
      return `
        <tr class="row-carry">
          <td>${fmtDate(e.date)}</td>
          <td colspan="11" class="italic">${e.description}</td>
          <td class="num">${fmt(e.balance)}</td>
        </tr>`
    }
    if (e.type === 'payment') {
      return `
        <tr class="row-payment">
          <td>${fmtDate(e.date)}</td>
          <td colspan="9">${e.description || ''}</td>
          <td></td>
          <td class="num">${fmt(e.received)}</td>
          <td class="num ${e.balance > 0 ? 'danger' : 'ok'}">${fmt(e.balance)}</td>
        </tr>`
    }
    if (e.type === 'credit' || e.type === 'debit') {
      const isCredit = e.type === 'credit'
      return `
        <tr class="${isCredit ? 'row-credit' : 'row-debit'}">
          <td>${fmtDate(e.date)}</td>
          <td colspan="9">${isCredit ? 'CREDIT: ' : 'DEBIT: '}${e.description || ''}</td>
          <td class="num bold">${isCredit ? fmt(e.receivable) : ''}</td>
          <td class="num bold">${!isCredit ? fmt(e.received) : ''}</td>
          <td class="num ${e.balance > 0 ? 'danger' : 'ok'}">${fmt(e.balance)}</td>
        </tr>`
    }
    // shipment
    return `
      <tr class="row-ship">
        <td>${fmtDate(e.date)}</td>
        <td class="mono">${e.awb_number}</td>
        <td>${e.origin}</td>
        <td>${e.destination}</td>
        <td class="num">${e.pieces ?? ''}</td>
        <td class="num">${Number(e.weight || 0).toFixed(3)}</td>
        <td class="num">${e.net_rate > 0 ? fmt(e.net_rate) : ''}</td>
        <td class="num">${e.clearing > 0 ? fmt(e.clearing) : ''}</td>
        <td class="num">${e.other > 0 ? fmt(e.other) : ''}</td>
        <td class="num">${e.form_e > 0 ? fmt(e.form_e) : ''}</td>
        <td class="num bold">${fmt(e.receivable)}</td>
        <td></td>
        <td class="num bold ${e.balance > 0 ? 'danger' : 'ok'}">${fmt(e.balance)}</td>
      </tr>`
  }).join('')

  const balanceColor = summary.balance > 0 ? '#dc2626' : '#16a34a'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Statement — ${client.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 8.5px; color: #111; background: white; }
    @page { size: A4 landscape; margin: 8mm; }

    .header { background: #1a2744; color: white; padding: 12px 16px; display: flex; justify-content: space-between; align-items: flex-start; }
    .company-name { font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; }
    .company-addr { font-size: 7px; margin-top: 4px; opacity: 0.85; line-height: 1.6; }
    .summary-box { text-align: right; }
    .summary-title { font-size: 7px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px; }
    .summary-grid { display: flex; gap: 16px; }
    .sum-item { text-align: center; }
    .sum-lbl { font-size: 6.5px; opacity: 0.7; text-transform: uppercase; }
    .sum-val { font-size: 11px; font-weight: bold; font-family: 'Courier New', monospace; }

    .client-bar { background: #f8fafc; border-bottom: 2px solid #1a2744; padding: 7px 16px; display: flex; justify-content: space-between; align-items: center; }
    .client-title { font-size: 9px; font-weight: bold; color: #1a2744; text-transform: uppercase; letter-spacing: 0.05em; }
    .date-range { font-size: 7.5px; color: #6b7280; }

    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th { background: #1a2744; color: white; padding: 5px 5px; font-size: 7px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    th.num { text-align: right; }
    td { padding: 4px 5px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
    td.num { text-align: right; font-family: 'Courier New', monospace; }
    td.mono { font-family: 'Courier New', monospace; font-weight: bold; }
    td.bold { font-weight: 600; }
    td.danger { color: #dc2626; }
    td.ok { color: #16a34a; }
    td.italic { font-style: italic; color: #6b7280; }

    .row-carry { background: #f3f4f6; }
    .row-payment { background: #eff6ff; }
    .row-payment td { color: #1d4ed8; }
    .row-credit { background: #fff7ed; }
    .row-credit td { color: #c2410c; }
    .row-debit { background: #faf5ff; }
    .row-debit td { color: #7e22ce; }
    .row-ship { background: white; }
    .row-ship:nth-child(even) { background: #fafafa; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company-name">Trade International Logistics</div>
      <div class="company-addr">
        Room No. 4, 1st Floor, Khair Mohammad Plaza, Opp. State Bank of Pakistan<br>
        8-A Saddar Road, Peshawar Cantt, Pakistan &nbsp;|&nbsp; IATA: 27-3 0688/0005
      </div>
    </div>
    <div class="summary-box">
      <div class="summary-title">Account Statement</div>
      <div class="summary-grid">
        <div class="sum-item">
          <div class="sum-lbl">Total Receivable</div>
          <div class="sum-val">PKR ${fmt(summary.totalReceivable)}</div>
        </div>
        <div class="sum-item">
          <div class="sum-lbl">Total Received</div>
          <div class="sum-val">PKR ${fmt(summary.totalReceived)}</div>
        </div>
        <div class="sum-item">
          <div class="sum-lbl">Balance</div>
          <div class="sum-val" style="color:${balanceColor}">PKR ${fmt(summary.balance)}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="client-bar">
    <div class="client-title">
      AC STATEMENT FOR ${client.name}${client.contact_person ? ' / ' + client.contact_person : ''}, ${client.city || ''}, PAKISTAN
    </div>
    <div class="date-range">${dateLabel}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:52px">Date</th>
        <th style="width:76px">AWB No.</th>
        <th style="width:24px">ORG</th>
        <th style="width:24px">DST</th>
        <th class="num" style="width:20px">PCS</th>
        <th class="num" style="width:42px">Weight</th>
        <th class="num" style="width:44px">Net Rate</th>
        <th class="num" style="width:54px">Clrg Chrgs</th>
        <th class="num" style="width:50px">Other Chrgs</th>
        <th class="num" style="width:48px">Form E</th>
        <th class="num" style="width:58px">Receivable</th>
        <th class="num" style="width:58px">Received</th>
        <th class="num" style="width:58px">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`
}

// ── React preview overlay ─────────────────────────────────────────────────────

export function LedgerPrintView({ entries, client, summary, dateLabel, onClose }) {
  function handlePrint() {
    const w = window.open('', '_blank')
    if (!w) { alert('Please allow pop-ups for this site to enable printing.'); return }
    w.document.write(buildPrintHTML(entries, client, summary, dateLabel))
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  const balanceColor = (b) => b > 0 ? '#dc2626' : b === 0 ? '#16a34a' : '#374151'
  const tdNum = { textAlign: 'right', fontFamily: 'monospace', padding: '6px 8px', whiteSpace: 'nowrap' }
  const tdBase = { padding: '6px 8px', whiteSpace: 'nowrap', borderBottom: '1px solid #f3f4f6' }

  return (
    <div className="fixed inset-0 z-50 bg-gray-300 overflow-auto py-8">

      {/* Controls */}
      <div className="flex justify-center mb-6 gap-3">
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

      {/* Statement document — landscape-ish preview */}
      <div className="mx-auto bg-white shadow-2xl" style={{ width: 1060, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 11 }}>

        {/* Header */}
        <div style={{ backgroundColor: '#1a2744', color: 'white', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Trade International Logistics
            </div>
            <div style={{ fontSize: 9, marginTop: 4, opacity: 0.85, lineHeight: 1.6 }}>
              Room No. 4, 1st Floor, Khair Mohammad Plaza, Opp. State Bank of Pakistan<br />
              8-A Saddar Road, Peshawar Cantt, Pakistan &nbsp;|&nbsp; IATA: 27-3 0688/0005
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 8, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              Account Statement
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              {[
                ['Total Receivable', summary.totalReceivable],
                ['Total Received',   summary.totalReceived],
                ['Balance',          summary.balance],
              ].map(([lbl, val]) => (
                <div key={lbl} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, opacity: 0.7, textTransform: 'uppercase' }}>{lbl}</div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace', color: lbl === 'Balance' ? balanceColor(summary.balance) : 'white' }}>
                    PKR {fmt(val)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Client bar */}
        <div style={{ background: '#f8fafc', borderBottom: '2px solid #1a2744', padding: '8px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 'bold', color: '#1a2744', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            AC STATEMENT FOR {client.name}
            {client.contact_person ? ` / ${client.contact_person}` : ''}
            {client.city ? `, ${client.city}` : ''}, PAKISTAN
          </div>
          <div style={{ fontSize: 9, color: '#6b7280' }}>{dateLabel}</div>
        </div>

        {/* Ledger table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr style={{ backgroundColor: '#1a2744' }}>
                {['Date','AWB No.','ORG','DST','PCS','Weight','Net Rate','Clrg Chrgs','Other Chrgs','Form E','Receivable','Received','Balance'].map((h, i) => (
                  <th key={h} style={{
                    padding: '7px 8px',
                    color: 'white',
                    fontWeight: 600,
                    fontSize: 9,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    textAlign: i >= 4 ? 'right' : 'left',
                    whiteSpace: 'nowrap',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                if (e.type === 'opening' || e.type === 'carry-forward') {
                  return (
                    <tr key={e.id} style={{ backgroundColor: '#f3f4f6' }}>
                      <td style={tdBase}>{fmtDate(e.date)}</td>
                      <td colSpan={11} style={{ ...tdBase, fontStyle: 'italic', color: '#6b7280' }}>{e.description}</td>
                      <td style={{ ...tdNum, ...tdBase, fontWeight: 600 }}>{fmt(e.balance)}</td>
                    </tr>
                  )
                }
                if (e.type === 'payment') {
                  return (
                    <tr key={e.id} style={{ backgroundColor: '#eff6ff' }}>
                      <td style={{ ...tdBase, color: '#1d4ed8' }}>{fmtDate(e.date)}</td>
                      <td colSpan={9} style={{ ...tdBase, color: '#1d4ed8', fontSize: 10 }}>{e.description}</td>
                      <td style={tdBase} /> {/* RECEIVABLE blank */}
                      <td style={{ ...tdNum, ...tdBase, color: '#16a34a', fontWeight: 600 }}>{fmt(e.received)}</td>
                      <td style={{ ...tdNum, ...tdBase, fontWeight: 600, color: balanceColor(e.balance) }}>{fmt(e.balance)}</td>
                    </tr>
                  )
                }
                if (e.type === 'credit' || e.type === 'debit') {
                  const isCredit = e.type === 'credit'
                  const color = isCredit ? '#c2410c' : '#7e22ce'
                  return (
                    <tr key={e.id} style={{ backgroundColor: isCredit ? '#fff7ed' : '#faf5ff' }}>
                      <td style={{ ...tdBase, color }}>{fmtDate(e.date)}</td>
                      <td colSpan={9} style={{ ...tdBase, color, fontSize: 10 }}>{isCredit ? 'CREDIT: ' : 'DEBIT: '}{e.description}</td>
                      <td style={{ ...tdNum, ...tdBase, fontWeight: 600 }}>{isCredit ? fmt(e.receivable) : ''}</td>
                      <td style={{ ...tdNum, ...tdBase, fontWeight: 600 }}>{!isCredit ? fmt(e.received) : ''}</td>
                      <td style={{ ...tdNum, ...tdBase, fontWeight: 600, color: balanceColor(e.balance) }}>{fmt(e.balance)}</td>
                    </tr>
                  )
                }
                // shipment
                return (
                  <tr key={e.id}>
                    <td style={tdBase}>{fmtDate(e.date)}</td>
                    <td style={{ ...tdBase, fontFamily: 'monospace', fontWeight: 600, color: '#1a2744' }}>{e.awb_number}</td>
                    <td style={{ ...tdBase, fontFamily: 'monospace', fontSize: 9 }}>{e.origin}</td>
                    <td style={{ ...tdBase, fontFamily: 'monospace', fontSize: 9 }}>{e.destination}</td>
                    <td style={{ ...tdNum, ...tdBase }}>{e.pieces ?? ''}</td>
                    <td style={{ ...tdNum, ...tdBase }}>{Number(e.weight || 0).toFixed(3)}</td>
                    <td style={{ ...tdNum, ...tdBase }}>{e.net_rate > 0 ? fmt(e.net_rate) : ''}</td>
                    <td style={{ ...tdNum, ...tdBase }}>{e.clearing > 0 ? fmt(e.clearing) : ''}</td>
                    <td style={{ ...tdNum, ...tdBase }}>{e.other > 0 ? fmt(e.other) : ''}</td>
                    <td style={{ ...tdNum, ...tdBase }}>{e.form_e > 0 ? fmt(e.form_e) : ''}</td>
                    <td style={{ ...tdNum, ...tdBase, fontWeight: 600 }}>{fmt(e.receivable)}</td>
                    <td style={tdBase} /> {/* RECEIVED blank */}
                    <td style={{ ...tdNum, ...tdBase, fontWeight: 600, color: balanceColor(e.balance) }}>{fmt(e.balance)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {entries.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">No entries in this range.</div>
          )}
        </div>
      </div>
    </div>
  )
}
