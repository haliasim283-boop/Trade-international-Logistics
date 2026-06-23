import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'
const RO  = 'w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-500 font-mono cursor-default'

function Section({ title, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-100">
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function r2(n) { return Math.round(Number(n || 0) * 100) / 100 }
function pkr(n) {
  return 'PKR ' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUSES = ['PNDNG', 'AP-BLZ', 'BKD', 'CNCLD', 'NO SHOW', 'OFFLOADED', 'SHPD']

const EMPTY = {
  flight_date: new Date().toISOString().slice(0, 10),
  awb_number: '', airline_id: '', client_id: '',
  origin: '', destination: '', pieces: 1,
  chargeable_weight: '', net_rate: '', pkr_exchange_rate: 280,
  clearing_charges: 0, isc_tax: 0, other_charges: 0,
  awb_self_uploaded: false,
  form_e_usd_value: 0, form_e_pkr_rate: 0, form_e_supplier_id: '',
  amendment_charges: 0, cass_airline_rate: '',
  clearing_agent_id: '', status: 'PNDNG', notes: '',
}

export function ShipmentFormModal({
  mode, shipment,
  airlines, clients, clearingAgents, formESuppliers,
  iscTaxRate,
  onSave, onClose, saving,
}) {
  const [form, setForm] = useState(() => {
    if (mode === 'edit' && shipment) {
      return {
        flight_date:        shipment.flight_date ?? EMPTY.flight_date,
        awb_number:         shipment.awb_number ?? '',
        airline_id:         shipment.airline_id ?? '',
        client_id:          shipment.client_id ?? '',
        origin:             shipment.origin ?? '',
        destination:        shipment.destination ?? '',
        pieces:             shipment.pieces ?? 1,
        chargeable_weight:  shipment.chargeable_weight ?? '',
        net_rate:           shipment.net_rate ?? '',
        pkr_exchange_rate:  shipment.pkr_exchange_rate ?? 280,
        clearing_charges:   shipment.clearing_charges ?? 0,
        isc_tax:            shipment.isc_tax ?? 0,
        other_charges:      shipment.other_charges ?? 0,
        awb_self_uploaded:  shipment.awb_self_uploaded ?? false,
        form_e_usd_value:   shipment.form_e_usd_value ?? 0,
        form_e_pkr_rate:    shipment.form_e_pkr_rate ?? 0,
        form_e_supplier_id: shipment.form_e_supplier_id ?? '',
        amendment_charges:  shipment.amendment_charges ?? 0,
        cass_airline_rate:  shipment.cass_airline_rate ?? '',
        clearing_agent_id:  shipment.clearing_agent_id ?? '',
        status:             shipment.status ?? 'Planned',
        notes:              shipment.notes ?? '',
      }
    }
    return EMPTY
  })

  // ── Computed (never stored; the DB computes GENERATED columns) ──────────
  const pkrRate         = parseFloat(form.pkr_exchange_rate || 1)
  const freightAmount   = r2(parseFloat(form.chargeable_weight || 0) * parseFloat(form.net_rate || 0) * pkrRate)
  const formEAmountPkr  = r2(parseFloat(form.form_e_usd_value || 0) * parseFloat(form.form_e_pkr_rate || 0))
  const totalReceivable = r2(
    freightAmount
    + parseFloat(form.clearing_charges || 0)
    + parseFloat(form.isc_tax || 0)
    + parseFloat(form.other_charges || 0)
    + formEAmountPkr
    + parseFloat(form.amendment_charges || 0)
  )
  const cassFreightTotal = r2(parseFloat(form.chargeable_weight || 0) * parseFloat(form.cass_airline_rate || 0) * pkrRate)

  // ── Setters ──────────────────────────────────────────────────────────────
  const setF = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  function handleAirlineChange(id) {
    const airline = airlines.find((a) => a.id === id)
    const rate = parseFloat(form.pkr_exchange_rate || 1)
    const otherCharges = form.awb_self_uploaded
      ? r2(Number(airline?.other_charges_self_upload ?? 0) * rate)
      : r2(Number(airline?.awb_airline_upload_charges ?? 0) * rate)
    setForm((p) => ({
      ...p,
      airline_id: id,
      cass_airline_rate: airline?.cass_commission_usd_per_kg ?? '',
      other_charges: otherCharges,
    }))
  }

  function handleOriginChange(raw) {
    const origin = raw.toUpperCase().slice(0, 3)
    const agent = clearingAgents.find((a) => a.origin_code === origin)
    const cc = agent?.per_shipment_charge ?? 0
    const isc = origin === 'PEW' ? r2(cc * (iscTaxRate / 100)) : 0
    setForm((p) => ({
      ...p,
      origin,
      clearing_agent_id: agent?.id ?? '',
      clearing_charges: cc,
      isc_tax: isc,
    }))
  }

  function handleClearingChargesChange(val) {
    const cc = parseFloat(val) || 0
    const isc = form.origin === 'PEW' ? r2(cc * (iscTaxRate / 100)) : 0
    setForm((p) => ({ ...p, clearing_charges: val, isc_tax: isc }))
  }

  function handleSelfUploadChange(checked) {
    const airline = airlines.find((a) => a.id === form.airline_id)
    const rate = parseFloat(form.pkr_exchange_rate || 1)
    const otherCharges = checked
      ? r2(Number(airline?.other_charges_self_upload ?? 0) * rate)
      : r2(Number(airline?.awb_airline_upload_charges ?? 0) * rate)
    setForm((p) => ({ ...p, awb_self_uploaded: checked, other_charges: otherCharges }))
  }

  function handleExchangeRateChange(val) {
    const rate = parseFloat(val) || 1
    const airline = airlines.find((a) => a.id === form.airline_id)
    const otherCharges = airline
      ? (form.awb_self_uploaded
          ? r2(Number(airline.other_charges_self_upload ?? 0) * rate)
          : r2(Number(airline.awb_airline_upload_charges ?? 0) * rate))
      : form.other_charges
    setForm((p) => ({ ...p, pkr_exchange_rate: val, other_charges: otherCharges }))
  }

  function handleAgentChange(id) {
    const agent = clearingAgents.find((a) => a.id === id)
    const cc = agent?.per_shipment_charge ?? 0
    const isc = form.origin === 'PEW' ? r2(cc * (iscTaxRate / 100)) : 0
    setForm((p) => ({ ...p, clearing_agent_id: id, clearing_charges: cc, isc_tax: isc }))
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  function handleSubmit() {
    // IMPORTANT: exclude GENERATED columns (freight_amount, form_e_amount_pkr,
    // total_receivable, cass_freight_total) — the DB computes them automatically.
    const payload = {
      flight_date:        form.flight_date,
      awb_number:         form.awb_number.trim(),
      airline_id:         form.airline_id,
      client_id:          form.client_id,
      origin:             form.origin,
      destination:        form.destination.toUpperCase().slice(0, 3),
      pieces:             parseInt(form.pieces) || 1,
      chargeable_weight:  parseFloat(form.chargeable_weight) || 0,
      net_rate:           parseFloat(form.net_rate) || 0,
      pkr_exchange_rate:  parseFloat(form.pkr_exchange_rate) || 1,
      clearing_charges:   parseFloat(form.clearing_charges) || 0,
      isc_tax:            parseFloat(form.isc_tax) || 0,
      other_charges:      parseFloat(form.other_charges) || 0,
      awb_self_uploaded:  form.awb_self_uploaded,
      form_e_usd_value:   parseFloat(form.form_e_usd_value) || 0,
      form_e_pkr_rate:    parseFloat(form.form_e_pkr_rate) || 0,
      form_e_supplier_id: form.form_e_supplier_id || null,
      amendment_charges:  parseFloat(form.amendment_charges) || 0,
      cass_airline_rate:  parseFloat(form.cass_airline_rate) || 0,
      clearing_agent_id:  form.clearing_agent_id || null,
      status:             form.status,
      notes:              form.notes.trim() || null,
      updated_at:         new Date().toISOString(),
    }
    onSave(payload)
  }

  const canSave = !saving
    && form.flight_date
    && form.awb_number.trim()
    && form.airline_id
    && form.client_id
    && form.origin
    && form.destination

  const iscLabel = form.origin === 'PEW' && iscTaxRate > 0
    ? `ISC Tax — ${iscTaxRate}% of clearing (PKR)`
    : 'ISC Tax (PKR — PEW only)'

  return (
    <Modal
      title={mode === 'add' ? 'Add Shipment' : `Edit — ${shipment?.awb_number ?? 'Shipment'}`}
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-5">
        {/* ── 1. Shipment Details ── */}
        <Section title="Shipment Details">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Flight Date" required>
              <input type="date" className={INP} value={form.flight_date} onChange={setF('flight_date')} />
            </Field>
            <Field label="AWB Number" required>
              <input className={INP} value={form.awb_number} onChange={setF('awb_number')}
                placeholder="176-1421-4841" />
            </Field>
            <Field label="Status">
              <select className={INP} value={form.status} onChange={setF('status')}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Airline" required>
              <select className={INP} value={form.airline_id}
                onChange={(e) => handleAirlineChange(e.target.value)}>
                <option value="">Select airline…</option>
                {airlines.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.iata_prefix})</option>
                ))}
              </select>
            </Field>
            <Field label="Client" required>
              <select className={INP} value={form.client_id} onChange={setF('client_id')}>
                <option value="">Select client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        {/* ── 2. Route & Weight ── */}
        <Section title="Route & Weight">
          <div className="grid grid-cols-4 gap-3">
            <Field label="Origin (IATA)" required>
              <input className={INP} value={form.origin} maxLength={3}
                onChange={(e) => handleOriginChange(e.target.value)}
                placeholder="PEW" />
            </Field>
            <Field label="Destination (IATA)" required>
              <input className={INP} value={form.destination} maxLength={3}
                onChange={(e) => setForm((p) => ({ ...p, destination: e.target.value.toUpperCase() }))}
                placeholder="DXB" />
            </Field>
            <Field label="Pieces (PCS)">
              <input type="number" min="1" className={INP}
                value={form.pieces} onChange={setF('pieces')} />
            </Field>
            <Field label="Chargeable Weight (KGS)">
              <input type="number" step="0.001" min="0" className={INP}
                value={form.chargeable_weight} onChange={setF('chargeable_weight')}
                placeholder="0.000" />
            </Field>
          </div>
        </Section>

        {/* ── 3. Client Rates & Charges ── */}
        <Section title="Client Rates & Charges">
          <div className="grid grid-cols-4 gap-3">
            <Field label="USD → PKR Exchange Rate">
              <input type="number" step="0.01" min="1" className={INP}
                value={form.pkr_exchange_rate}
                onChange={(e) => handleExchangeRateChange(e.target.value)}
                placeholder="280.00" />
            </Field>
            <Field label="Net Rate (USD / kg — per 15-day period)">
              <input type="number" step="0.0001" min="0" className={INP}
                value={form.net_rate} onChange={setF('net_rate')} placeholder="3.50" />
            </Field>
            <Field label="Freight Amount (PKR)">
              <input readOnly className={RO} value={pkr(freightAmount)} />
            </Field>
            <Field label="CASS Airline Rate (USD / kg — auto-filled from airline)">
              <input type="number" step="0.0001" min="0" className={INP}
                value={form.cass_airline_rate} onChange={setF('cass_airline_rate')}
                placeholder="3.00" />
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field label="CASS Freight Total (PKR)">
              <input readOnly className={RO} value={pkr(cassFreightTotal)} />
            </Field>
            <Field label="Clearing Agent">
              <select className={INP} value={form.clearing_agent_id}
                onChange={(e) => handleAgentChange(e.target.value)}>
                <option value="">None / manual</option>
                {clearingAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.origin_code})</option>
                ))}
              </select>
            </Field>
            <Field label="Clearing Charges (PKR)">
              <input type="number" step="0.01" min="0" className={INP}
                value={form.clearing_charges}
                onChange={(e) => handleClearingChargesChange(e.target.value)} />
            </Field>
            <Field label={iscLabel}>
              <input type="number" step="0.01" min="0" className={INP}
                value={form.isc_tax} onChange={setF('isc_tax')}
                disabled={form.origin !== 'PEW'} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3 items-end">
            <Field label="Amendment Charges (PKR)">
              <input type="number" step="0.01" min="0" className={INP}
                value={form.amendment_charges} onChange={setF('amendment_charges')} />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={form.awb_self_uploaded}
                onChange={(e) => handleSelfUploadChange(e.target.checked)}
                className="w-4 h-4 accent-navy"
              />
              <span className="text-sm text-gray-700">
                AWB Self-Uploaded
                <span className="text-gray-400 ml-1 text-xs">(agent uploads — uses lower charge)</span>
              </span>
            </label>
            <Field label="AWB Upload Charges (PKR — auto from airline)">
              <input type="number" step="0.01" min="0" className={INP}
                value={form.other_charges} onChange={setF('other_charges')} />
            </Field>
          </div>
        </Section>

        {/* ── 4. Form E ── */}
        <Section title="Form E">
          <div className="grid grid-cols-4 gap-3">
            <Field label="Form E Supplier">
              <select className={INP} value={form.form_e_supplier_id} onChange={setF('form_e_supplier_id')}>
                <option value="">None</option>
                {formESuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="USD Value">
              <input type="number" step="0.01" min="0" className={INP}
                value={form.form_e_usd_value} onChange={setF('form_e_usd_value')} placeholder="0" />
            </Field>
            <Field label="PKR Rate per USD">
              <input type="number" step="0.01" min="0" className={INP}
                value={form.form_e_pkr_rate} onChange={setF('form_e_pkr_rate')} placeholder="13.00" />
            </Field>
            <Field label="Form E Amount (PKR)">
              <input readOnly className={RO} value={pkr(formEAmountPkr)} />
            </Field>
          </div>
        </Section>

        {/* ── Total banner ── */}
        <div className="rounded-lg bg-navy px-5 py-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-white uppercase tracking-wide">
            Total Receivable
          </span>
          <span className="font-mono font-bold text-xl text-white">
            {pkr(totalReceivable)}
          </span>
        </div>

        {/* ── Notes ── */}
        <Field label="Notes">
          <textarea className={INP} rows={2} value={form.notes} onChange={setF('notes')}
            placeholder="Any additional remarks…" />
        </Field>

        <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSave}>
            {saving && <Spinner size="sm" />}
            {mode === 'add' ? 'Add Shipment' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
