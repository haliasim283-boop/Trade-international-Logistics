import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { supabase } from '../../lib/supabase'

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function formatAWB(raw) {
  // Keep only digits and letters, strip existing hyphens, then insert at positions 3 and 7
  const clean = raw.replace(/-/g, '').slice(0, 11)
  if (clean.length <= 3) return clean
  if (clean.length <= 7) return `${clean.slice(0, 3)}-${clean.slice(3)}`
  return `${clean.slice(0, 3)}-${clean.slice(3, 7)}-${clean.slice(7)}`
}

const BLANK = {
  client_id:                '',
  shipment_id:              null,
  invoice_date:             today(),
  status:                   'Draft',
  awb_number:               '',
  origin:                   '',
  destination:              '',
  pieces:                   '',
  chargeable_weight:        '',
  net_rate:                 '',
  pkr_exchange_rate:        280,
  clearing_agent_id:        '',
  clearing_charges:         '',
  form_e_usd_value:         '',
  form_e_pkr_rate:          '',
  other_charges:            '',
  amendment_charges:        '',
  adjustment_ref_invoice_no: '',
  adjustment_amount:        '',
  advance_payment_amount:   '',
  advance_payment_note:     '',
  notes:                    '',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InvoiceFormModal({ mode, invoice, shipment, clients, clearingAgents = [], onSave, onClose, saving }) {
  const [form,             setForm]          = useState(BLANK)
  const [showAdj,          setShowAdj]       = useState(false)
  const [showAdvance,      setShowAdvance]   = useState(false)
  const [awbStatus,        setAwbStatus]     = useState(null)  // null | 'loading' | 'found' | 'not-found'
  const [saCommissionPkr,  setSaCommission]  = useState(0)

  // ── Pre-fill ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (invoice) {
      setForm({
        client_id:                invoice.client_id                ?? '',
        shipment_id:              invoice.shipment_id              ?? null,
        invoice_date:             invoice.invoice_date             ?? today(),
        status:                   invoice.status                   ?? 'Draft',
        awb_number:               invoice.awb_number               ?? '',
        origin:                   invoice.origin                   ?? '',
        destination:              invoice.destination              ?? '',
        pieces:                   invoice.pieces                   ?? '',
        chargeable_weight:        invoice.chargeable_weight        ?? '',
        net_rate:                 invoice.net_rate                 ?? '',
        pkr_exchange_rate:        invoice.pkr_exchange_rate        ?? 280,
        clearing_agent_id:        invoice.clearing_agent_id        ?? '',
        clearing_charges:         invoice.clearing_charges         ?? '',
        form_e_usd_value:         invoice.form_e_usd_value         ?? '',
        form_e_pkr_rate:          invoice.form_e_pkr_rate          ?? '',
        other_charges:            invoice.other_charges ?? '',
        amendment_charges:        invoice.amendment_charges ?? '',
        adjustment_ref_invoice_no: invoice.adjustment_ref_invoice_no ?? '',
        adjustment_amount:        invoice.adjustment_amount        ?? '',
        advance_payment_amount:   invoice.advance_payment_amount   ?? '',
        advance_payment_note:     invoice.advance_payment_note     ?? '',
        notes:                    invoice.notes                    ?? '',
      })
      if (invoice.adjustment_amount != null && Math.abs(Number(invoice.adjustment_amount)) > 0) {
        setShowAdj(true)
      }
      if (Number(invoice.advance_payment_amount || 0) > 0) {
        setShowAdvance(true)
      }
    } else if (shipment) {
      // Pre-fill from shipment; clearing_charges absorbs idc_tax
      setForm({
        client_id:                shipment.client_id   ?? '',
        shipment_id:              shipment.id          ?? null,
        invoice_date:             today(),
        status:                   'Draft',
        awb_number:               shipment.awb_number  ?? '',
        origin:                   shipment.origin      ?? '',
        destination:              shipment.destination ?? '',
        pieces:                   shipment.pieces      ?? '',
        chargeable_weight:        shipment.chargeable_weight ?? '',
        net_rate:                 shipment.net_rate    ?? '',
        pkr_exchange_rate:        shipment.pkr_exchange_rate ?? 280,
        clearing_agent_id:        shipment.clearing_agent_id ?? '',
        clearing_charges:         String(round2(Number(shipment.clearing_charges || 0) + Number(shipment.idc_tax || 0))),
        form_e_usd_value:         shipment.form_e_usd_value  ?? '',
        form_e_pkr_rate:          shipment.form_e_pkr_rate   ?? '',
        other_charges:            round2(Number(shipment.awb_upload_charges || 0) + Number(shipment.other_charges_due_airline || 0) + Number(shipment.awb_fixed_fee || 0)),
        amendment_charges:        String(round2(Number(shipment.amendment_charges || 0))),
        adjustment_ref_invoice_no: '',
        adjustment_amount:        '',
        advance_payment_amount:   '',
        advance_payment_note:     '',
        notes:                    '',
      })
      setSaCommission(round2(Number(shipment.sales_agent_commission_per_kg || 0) * Number(shipment.chargeable_weight || 0)))
    }
  }, [invoice, shipment])

  // ── Field updater ─────────────────────────────────────────────────────────

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  async function handleAwbBlur() {
    const awb = form.awb_number.trim()
    if (!awb || !supabase) return
    setAwbStatus('loading')
    const { data } = await supabase
      .from('shipments')
      .select('origin, destination, pieces, chargeable_weight, net_rate, pkr_exchange_rate, clearing_agent_id, clearing_charges, idc_tax, awb_upload_charges, other_charges_due_airline, awb_fixed_fee, amendment_charges, form_e_usd_value, form_e_pkr_rate, client_id, sales_agent_commission_per_kg')
      .ilike('awb_number', awb)
      .maybeSingle()
    if (!data) { setAwbStatus('not-found'); return }
    setAwbStatus('found')
    setSaCommission(round2(Number(data.sales_agent_commission_per_kg || 0) * Number(data.chargeable_weight || 0)))
    setForm((f) => ({
      ...f,
      origin:            data.origin      || f.origin,
      destination:       data.destination || f.destination,
      pieces:            f.pieces            || data.pieces      || '',
      chargeable_weight: f.chargeable_weight || data.chargeable_weight || '',
      net_rate:          f.net_rate          || data.net_rate          || '',
      pkr_exchange_rate: f.pkr_exchange_rate || data.pkr_exchange_rate || 280,
      client_id:         f.client_id         || data.client_id         || '',
      clearing_agent_id: f.clearing_agent_id || data.clearing_agent_id || '',
      clearing_charges:  f.clearing_charges  || String(round2(Number(data.clearing_charges || 0) + Number(data.idc_tax || 0))),
      other_charges:     f.other_charges     || round2(Number(data.awb_upload_charges || 0) + Number(data.other_charges_due_airline || 0) + Number(data.awb_fixed_fee || 0)),
      amendment_charges: f.amendment_charges || String(round2(Number(data.amendment_charges || 0))),
      form_e_usd_value:  f.form_e_usd_value  || data.form_e_usd_value || '',
      form_e_pkr_rate:   f.form_e_pkr_rate   || data.form_e_pkr_rate  || '',
    }))
  }

  function handleAgentChange(id) {
    const agent = clearingAgents.find((a) => a.id === id)
    setForm((f) => ({
      ...f,
      clearing_agent_id: id,
      clearing_charges:  agent ? String(agent.per_shipment_charge) : f.clearing_charges,
    }))
  }

  // ── Live totals ───────────────────────────────────────────────────────────

  const pkrRate       = Number(form.pkr_exchange_rate || 280)
  const freightAmount = round2(Number(form.chargeable_weight || 0) * Number(form.net_rate || 0))
  const formEAmount   = round2(Number(form.form_e_usd_value || 0) * Number(form.form_e_pkr_rate || 0))
  const otherChgPkr   = round2(Number(form.other_charges || 0))
  const amendmentChg  = round2(Number(form.amendment_charges || 0))
  const adjAmount     = showAdj ? round2(Number(form.adjustment_amount || 0)) : 0
  const advanceAmount = showAdvance ? round2(Number(form.advance_payment_amount || 0)) : 0
  const totalAmount   = round2(
    freightAmount
    + round2(Number(form.clearing_charges || 0))
    + formEAmount
    + otherChgPkr
    + saCommissionPkr
    + amendmentChg
    + adjAmount
    - advanceAmount
  )

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      client_id:                form.client_id || null,
      shipment_id:              form.shipment_id || null,
      invoice_date:             form.invoice_date,
      status:                   form.status,
      awb_number:               form.awb_number.trim(),
      origin:                   form.origin.trim().toUpperCase(),
      destination:              form.destination.trim().toUpperCase(),
      pieces:                   form.pieces ? Number(form.pieces) : null,
      chargeable_weight:        form.chargeable_weight ? Number(form.chargeable_weight) : null,
      net_rate:                 form.net_rate ? Number(form.net_rate) : null,
      pkr_exchange_rate:        pkrRate,
      freight_amount:           freightAmount,
      clearing_agent_id:        form.clearing_agent_id || null,
      clearing_charges:         round2(Number(form.clearing_charges || 0)),
      form_e_usd_value:         form.form_e_usd_value ? Number(form.form_e_usd_value) : null,
      form_e_pkr_rate:          form.form_e_pkr_rate  ? Number(form.form_e_pkr_rate)  : null,
      form_e_amount:            formEAmount,
      other_charges:            round2(otherChgPkr + saCommissionPkr),
      amendment_charges:        amendmentChg,
      adjustment_ref_invoice_no: showAdj ? (form.adjustment_ref_invoice_no.trim() || null) : null,
      adjustment_amount:        showAdj ? adjAmount : null,
      advance_payment_amount:   showAdvance ? advanceAmount : null,
      advance_payment_note:     showAdvance ? (form.advance_payment_note.trim() || null) : null,
      total_amount:             totalAmount,
      notes:                    form.notes.trim() || null,
    }
    onSave(payload)
  }

  // ── Style helpers ─────────────────────────────────────────────────────────

  const INP  = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white'
  const LBL  = 'block text-xs font-medium text-gray-600 mb-1'
  const CALC = 'w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-sm font-mono text-right text-gray-700 select-none'

  function fmt2(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  return (
    <Modal
      title={mode === 'add' ? 'New Invoice' : `Edit Invoice ${invoice?.invoice_number ?? ''}`}
      onClose={onClose}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Row 1: Client · Date · Status ─────────────────────────── */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={LBL}>Client *</label>
            <select name="client_id" className={INP} value={form.client_id} onChange={set('client_id')} required>
              <option value="">Select client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={LBL}>Invoice Date *</label>
            <input type="date" name="invoice_date" className={INP} value={form.invoice_date} onChange={set('invoice_date')} required />
          </div>
          <div>
            <label className={LBL}>Status</label>
            <select name="status" className={INP} value={form.status} onChange={set('status')}>
              <option>Draft</option>
              <option>Sent</option>
              <option>Partially Paid</option>
              <option>Paid</option>
            </select>
          </div>
        </div>

        {/* ── Row 2: AWB · Origin · Destination ─────────────────────── */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={LBL}>AWB Number *</label>
            <div className="relative">
              <input
                className={INP + ' font-mono pr-24'}
                value={form.awb_number}
                onChange={(e) => {
                  const formatted = formatAWB(e.target.value)
                  setForm((f) => ({ ...f, awb_number: formatted }))
                  setAwbStatus(null)
                }}
                onBlur={handleAwbBlur}
                required
                maxLength={13}
                placeholder="e.g. 214-1234-5678"
              />
              {awbStatus === 'loading' && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-gray-400">
                  <Spinner size="sm" /> Looking up…
                </span>
              )}
              {awbStatus === 'found' && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  ✓ Auto-filled
                </span>
              )}
              {awbStatus === 'not-found' && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  Not found
                </span>
              )}
            </div>
          </div>
          <div>
            <label className={LBL}>Origin (IATA) *</label>
            <select name="origin" className={INP} value={form.origin} onChange={set('origin')} required>
              <option value="">Select origin…</option>
              {['PEW','ISB','MUX','SKT','LHE','KHI'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LBL}>Destination (IATA) *</label>
            <select name="destination" className={INP} value={form.destination} onChange={set('destination')} required>
              <option value="">Select destination…</option>
              {['DXB','DOH','AUH','SHJ','BAH','JED','MCT','AAN','KWI','RUH','RKT','MAN','YYZ','LHR'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Row 3: Pieces · Weight · Net Rate → Freight ───────────── */}
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className={LBL}>Pieces</label>
            <input type="number" name="pieces" className={INP} value={form.pieces} onChange={set('pieces')} min={1} placeholder="0" />
          </div>
          <div>
            <label className={LBL}>Weight (KGS)</label>
            <input type="number" name="chargeable_weight" step="0.001" className={INP} value={form.chargeable_weight} onChange={set('chargeable_weight')} placeholder="0.000" />
          </div>
          <div>
            <label className={LBL}>Net Rate (PKR/kg)</label>
            <input type="number" name="net_rate" step="0.0001" className={INP} value={form.net_rate} onChange={set('net_rate')} placeholder="0.00" />
          </div>
          <div>
            <label className={LBL}>Freight Amount (PKR)</label>
            <div className={CALC}>PKR {fmt2(freightAmount)}</div>
          </div>
        </div>

        {/* ── Row 4: Customs Clearance ───────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={LBL}>Customs Clearance Agent</label>
            <select
              className={INP}
              name="clearing_agent_id"
              value={form.clearing_agent_id}
              onChange={(e) => handleAgentChange(e.target.value)}
            >
              <option value="">— Select agent —</option>
              {clearingAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.city ? ` — ${a.city}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LBL}>Clearance Charges (PKR)</label>
            <input
              type="number"
              step="0.01"
              className={INP}
              name="clearing_charges"
              value={form.clearing_charges}
              onChange={set('clearing_charges')}
              placeholder="0.00"
            />
            {shipment && (
              <p className="mt-1 text-xs text-gray-400">Pre-filled from shipment clearing charges</p>
            )}
          </div>
        </div>

        {/* ── Row 5: Form E ─────────────────────────────────────────── */}
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Form E</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={LBL}>USD Value</label>
              <input type="number" name="form_e_usd_value" step="0.01" className={INP} value={form.form_e_usd_value} onChange={set('form_e_usd_value')} placeholder="0.00" />
            </div>
            <div>
              <label className={LBL}>PKR Rate per USD</label>
              <input type="number" name="form_e_pkr_rate" step="0.01" className={INP} value={form.form_e_pkr_rate} onChange={set('form_e_pkr_rate')} placeholder="0.00" />
            </div>
            <div>
              <label className={LBL}>Form E Amount (PKR)</label>
              <div className={CALC}>PKR {fmt2(formEAmount)}</div>
            </div>
          </div>
        </div>

        {/* ── Row 6: Airline Other Charges + Amendment ──────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={LBL}>Airline Other Charges + AWB Fee (PKR)</label>
            <input type="number" name="other_charges" step="0.01" className={INP} value={form.other_charges} onChange={set('other_charges')} placeholder="0.00" />
          </div>
          <div>
            <label className={LBL}>Amendment Charges (PKR)</label>
            <input type="number" name="amendment_charges" step="0.01" className={INP} value={form.amendment_charges} onChange={set('amendment_charges')} placeholder="0.00" />
          </div>
        </div>

        {/* ── Adjustment line ────────────────────────────────────────── */}
        <div className="border border-gray-200 rounded-lg p-4">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 font-medium mb-0">
            <input
              type="checkbox"
              checked={showAdj}
              onChange={(e) => setShowAdj(e.target.checked)}
              className="w-4 h-4 accent-navy"
            />
            Include adjustment line (link to a previous invoice)
          </label>
          {showAdj && (
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <label className={LBL}>Reference Invoice No.</label>
                <input
                  name="adjustment_ref_invoice_no"
                  className={INP + ' font-mono'}
                  value={form.adjustment_ref_invoice_no}
                  onChange={set('adjustment_ref_invoice_no')}
                  placeholder="e.g. 00000001"
                />
              </div>
              <div>
                <label className={LBL}>Adjustment Amount (PKR) — negative for credit</label>
                <input
                  type="number"
                  step="0.01"
                  className={INP}
                  name="adjustment_amount"
                  value={form.adjustment_amount}
                  onChange={set('adjustment_amount')}
                  placeholder="0.00 or -500.00"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Advance payment received ───────────────────────────────── */}
        <div className="border border-gray-200 rounded-lg p-4">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 font-medium mb-0">
            <input
              type="checkbox"
              checked={showAdvance}
              onChange={(e) => setShowAdvance(e.target.checked)}
              className="w-4 h-4 accent-navy"
            />
            Include advance payment received
          </label>
          {showAdvance && (
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <label className={LBL}>Advance Payment Amount (PKR)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={INP}
                  name="advance_payment_amount"
                  value={form.advance_payment_amount}
                  onChange={set('advance_payment_amount')}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className={LBL}>Note (optional)</label>
                <input
                  name="advance_payment_note"
                  className={INP}
                  value={form.advance_payment_note}
                  onChange={set('advance_payment_note')}
                  placeholder="e.g. received by Shahzad"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Notes ─────────────────────────────────────────────────── */}
        <div>
          <label className={LBL}>Notes</label>
          <textarea
            name="notes"
            className={INP}
            rows={2}
            value={form.notes}
            onChange={set('notes')}
            placeholder="Any additional remarks…"
          />
        </div>

        {/* ── Balance summary ────────────────────────────────────────── */}
        <div className="rounded-lg overflow-hidden border border-gray-200">
          <div className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
            Invoice Summary
          </div>
          <div className="px-4 py-3 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Freight</span>
              <span className="font-mono">PKR {fmt2(freightAmount)}</span>
            </div>
            {round2(Number(form.clearing_charges || 0)) > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Customs Clearance</span>
                <span className="font-mono">PKR {fmt2(form.clearing_charges)}</span>
              </div>
            )}
            {formEAmount > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Form E</span>
                <span className="font-mono">PKR {fmt2(formEAmount)}</span>
              </div>
            )}
            {(otherChgPkr + saCommissionPkr) > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Other Charges</span>
                <span className="font-mono">PKR {fmt2(otherChgPkr + saCommissionPkr)}</span>
              </div>
            )}
            {amendmentChg > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Amendment Charges</span>
                <span className="font-mono">PKR {fmt2(amendmentChg)}</span>
              </div>
            )}
            {showAdj && adjAmount !== 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Adjustment</span>
                <span className={`font-mono ${adjAmount < 0 ? 'text-danger' : ''}`}>PKR {fmt2(adjAmount)}</span>
              </div>
            )}
            {showAdvance && advanceAmount !== 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Advance Payment Received</span>
                <span className="font-mono text-danger">PKR -{fmt2(advanceAmount)}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 mt-2 border-t border-gray-200">
              <span className="font-bold text-navy uppercase tracking-wide text-sm">Balance</span>
              <span className="font-bold font-mono text-lg text-navy">PKR {fmt2(totalAmount)}</span>
            </div>
          </div>
        </div>

        {/* ── Actions ───────────────────────────────────────────────── */}
        <div className="flex gap-3 justify-end pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving && <Spinner size="sm" />}
            {mode === 'add' ? 'Create Invoice' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
