import { useState, useRef } from 'react'
import { FileText, UploadCloud, X } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { useAuth } from '../../contexts/AuthContext'

async function uploadToCloudinary(file) {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const preset    = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
  if (!cloudName || !preset) throw new Error('Cloudinary not configured — add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to .env')
  const fd = new FormData()
  fd.append('file', file)
  fd.append('upload_preset', preset)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, { method: 'POST', body: fd })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message ?? `HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.secure_url
}

function formatAWB(raw) {
  // Keep only digits and letters, strip existing hyphens, then insert at positions 3 and 7
  const clean = raw.replace(/-/g, '').slice(0, 11)
  if (clean.length <= 3) return clean
  if (clean.length <= 7) return `${clean.slice(0, 3)}-${clean.slice(3)}`
  return `${clean.slice(0, 3)}-${clean.slice(3, 7)}-${clean.slice(7)}`
}

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

const STATUSES = ['PNDNG', 'AP-BLZ', 'BKD', 'CNCLD', 'NO SHOW', 'OFFLOADED', 'SHPD', 'EMAILED']

const EMPTY = {
  flight_date: new Date().toISOString().slice(0, 10),
  awb_number: '', airline_id: '', client_id: '',
  origin: '', destination: '', pieces: 1,
  chargeable_weight: '', net_rate: '', pkr_exchange_rate: 280,
  clearing_charges: 0, idc_tax: 0,
  other_charges_due_airline: 0, awb_fixed_fee: 1000,
  form_e_usd_value: 0, form_e_pkr_rate: 0, form_e_pkr_rate_payable: 0, form_e_supplier_id: '',
  cass_airline_rate: '',
  clearing_agent_id: '', sales_agent_id: '', sales_agent_commission_per_kg: 0,
  status: 'PNDNG', notes: '',
}

export function ShipmentFormModal({
  mode, shipment,
  airlines, clients, clearingAgents, formESuppliers, salesAgents = [],
  idcTaxRate, fixedUsdRate = 0,
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
        idc_tax:            shipment.idc_tax ?? 0,
        other_charges_due_airline:  shipment.other_charges_due_airline ?? 0,
        awb_fixed_fee:              shipment.awb_fixed_fee ?? 1000,
        form_e_usd_value:           shipment.form_e_usd_value ?? 0,
        form_e_pkr_rate:          shipment.form_e_pkr_rate ?? 0,
        form_e_pkr_rate_payable:  shipment.form_e_pkr_rate_payable ?? 0,
        form_e_supplier_id: shipment.form_e_supplier_id ?? '',
        cass_airline_rate:  shipment.cass_airline_rate ?? '',
        clearing_agent_id:              shipment.clearing_agent_id ?? '',
        sales_agent_id:                 shipment.sales_agent_id ?? '',
        sales_agent_commission_per_kg:  shipment.sales_agent_commission_per_kg ?? 0,
        status:             shipment.status ?? 'Planned',
        notes:              shipment.notes ?? '',
      }
    }
    return { ...EMPTY, pkr_exchange_rate: fixedUsdRate || EMPTY.pkr_exchange_rate }
  })

  const [existingUrls, setExistingUrls] = useState(() =>
    mode === 'edit' ? (shipment?.document_urls ?? []) : []
  )
  const [newFiles, setNewFiles]     = useState([])
  const [uploading, setUploading]   = useState(false)
  const fileInputRef = useRef(null)

  function handleFileSelect(e) {
    const picked = Array.from(e.target.files ?? [])
    setNewFiles((prev) => [...prev, ...picked])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  function removeExisting(url) { setExistingUrls((prev) => prev.filter((u) => u !== url)) }
  function removeNew(idx)      { setNewFiles((prev) => prev.filter((_, i) => i !== idx)) }

  // ── Computed (never stored; the DB computes GENERATED columns) ──────────
  const pkrRate               = parseFloat(form.pkr_exchange_rate || 1)
  const cw                    = parseFloat(form.chargeable_weight || 0)
  const freightAmount         = r2(cw * parseFloat(form.net_rate || 0))
  const formEAmountPkr        = r2(parseFloat(form.form_e_usd_value || 0) * parseFloat(form.form_e_pkr_rate || 0))
  const salesAgentCommission  = r2(cw * parseFloat(form.sales_agent_commission_per_kg || 0))
  const totalReceivable       = r2(
    freightAmount
    + parseFloat(form.clearing_charges || 0)
    + parseFloat(form.idc_tax || 0)
    + parseFloat(form.other_charges_due_airline || 0)
    + parseFloat(form.awb_fixed_fee || 0)
    + formEAmountPkr
    + salesAgentCommission
  )
  const cassFreightTotal = r2(cw * parseFloat(form.cass_airline_rate || 0) * pkrRate)

  // ── Setters ──────────────────────────────────────────────────────────────
  const setF = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  function handleAirlineChange(id) {
    setForm((p) => ({ ...p, airline_id: id }))
  }

  function handleOriginChange(raw) {
    const origin = raw.toUpperCase().slice(0, 3)
    const agent = clearingAgents.find((a) => a.origin_code === origin)
    const cc = agent?.per_shipment_charge ?? 0
    const idc = origin === 'PEW' ? r2(cc * (idcTaxRate / 100)) : 0
    setForm((p) => ({
      ...p,
      origin,
      clearing_agent_id: agent?.id ?? '',
      clearing_charges: cc,
      idc_tax: idc,
    }))
  }

  function handleClearingChargesChange(val) {
    const cc = parseFloat(val) || 0
    const idc = form.origin === 'PEW' ? r2(cc * (idcTaxRate / 100)) : 0
    setForm((p) => ({ ...p, clearing_charges: val, idc_tax: idc }))
  }

  function handleExchangeRateChange(val) {
    setForm((p) => ({ ...p, pkr_exchange_rate: val }))
  }

  function handleAgentChange(id) {
    const agent = clearingAgents.find((a) => a.id === id)
    const cc = agent?.per_shipment_charge ?? 0
    const idc = form.origin === 'PEW' ? r2(cc * (idcTaxRate / 100)) : 0
    setForm((p) => ({ ...p, clearing_agent_id: id, clearing_charges: cc, idc_tax: idc }))
  }

  function handleSalesAgentChange(id) {
    setForm((p) => ({
      ...p,
      sales_agent_id: id,
      sales_agent_commission_per_kg: id ? p.sales_agent_commission_per_kg : 0,
    }))
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    // Upload any newly selected files to Cloudinary
    const uploadedUrls = []
    if (newFiles.length > 0) {
      setUploading(true)
      for (const file of newFiles) {
        try {
          uploadedUrls.push(await uploadToCloudinary(file))
        } catch (err) {
          setUploading(false)
          alert(`Upload failed for "${file.name}": ${err.message}`)
          return
        }
      }
      setUploading(false)
    }
    const document_urls = [...existingUrls, ...uploadedUrls]

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
      idc_tax:            parseFloat(form.idc_tax) || 0,
      other_charges_due_airline:  parseFloat(form.other_charges_due_airline) || 0,
      awb_fixed_fee:              parseFloat(form.awb_fixed_fee) || 0,
      form_e_usd_value:           parseFloat(form.form_e_usd_value) || 0,
      form_e_pkr_rate:          parseFloat(form.form_e_pkr_rate) || 0,
      form_e_pkr_rate_payable:  parseFloat(form.form_e_pkr_rate_payable) || 0,
      form_e_supplier_id: form.form_e_supplier_id || null,
      cass_airline_rate:  parseFloat(form.cass_airline_rate) || 0,
      clearing_agent_id:             form.clearing_agent_id || null,
      sales_agent_id:                form.sales_agent_id    || null,
      sales_agent_commission_per_kg: parseFloat(form.sales_agent_commission_per_kg) || 0,
      status:             form.status,
      notes:              form.notes.trim() || null,
      document_urls,
      updated_at:         new Date().toISOString(),
    }
    onSave(payload)
  }

  const canSave = !uploading && !saving
    && form.flight_date
    && form.awb_number.trim()
    && form.airline_id
    && form.client_id
    && form.origin
    && form.destination

  const idcLabel = form.origin === 'PEW' && idcTaxRate > 0
    ? `IDC Tax — ${idcTaxRate}% of clearing (PKR)`
    : 'IDC Tax (PKR — PEW only)'

  const { role } = useAuth()
  const isDataEntry = role === 'Data Entry'

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
              <input type="date" name="flight_date" className={INP} value={form.flight_date} onChange={setF('flight_date')} />
            </Field>
            <Field label="AWB Number" required>
              <input name="awb_number" className={INP} value={form.awb_number}
                onChange={(e) => {
                  const formatted = formatAWB(e.target.value)
                  const prefix = formatted.replace(/-/g, '').slice(0, 3)
                  const matched = prefix.length === 3
                    ? airlines.find((a) => a.iata_prefix === prefix)
                    : null
                  if (matched && matched.id !== form.airline_id) {
                    handleAirlineChange(matched.id)
                    setForm((p) => ({ ...p, awb_number: formatted }))
                  } else {
                    setForm((p) => ({ ...p, awb_number: formatted }))
                  }
                }}
                placeholder="176-1421-4841" maxLength={13} />
            </Field>
            <Field label="Status">
              <select name="status" className={INP} value={form.status} onChange={setF('status')}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Airline" required>
              <select name="airline_id" className={INP} value={form.airline_id}
                onChange={(e) => handleAirlineChange(e.target.value)}>
                <option value="">Select airline…</option>
                {airlines.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.iata_prefix})</option>
                ))}
              </select>
            </Field>
            <Field label="Client" required>
              <select name="client_id" className={INP} value={form.client_id} onChange={setF('client_id')}>
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
              <select name="origin" className={INP} value={form.origin}
                onChange={(e) => handleOriginChange(e.target.value)} required>
                <option value="">Select origin…</option>
                {['PEW','ISB','MUX','SKT','LHE','KHI'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Destination (IATA)" required>
              <select name="destination" className={INP} value={form.destination}
                onChange={(e) => setForm((p) => ({ ...p, destination: e.target.value }))} required>
                <option value="">Select destination…</option>
                {['DXB','DOH','AUH','SHJ','BAH','JED','MCT','AAN','KWI','RUH','RKT','MAN','YYZ','LHR'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Pieces (PCS)">
              <input type="number" name="pieces" min="1" className={INP}
                value={form.pieces} onChange={setF('pieces')} />
            </Field>
            <Field label="Chargeable Weight (KGS)">
              <input type="number" name="chargeable_weight" step="0.001" min="0" className={INP}
                value={form.chargeable_weight} onChange={setF('chargeable_weight')}
                placeholder="0.000" />
            </Field>
          </div>
        </Section>

        {/* ── 3. Client Rates & Charges ── */}
        {!isDataEntry && (
        <Section title="Client Rates & Charges">
          <div className="grid grid-cols-4 gap-3">
            <Field label={
              <span className="flex items-center gap-1.5">
                USD Rate
                {mode === 'add' && fixedUsdRate > 0 && (
                  <span className="text-xs font-normal text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">
                    Fixed
                  </span>
                )}
              </span>
            }>
              <input type="number" name="pkr_exchange_rate" step="0.01" min="1" className={INP}
                value={form.pkr_exchange_rate}
                onChange={(e) => handleExchangeRateChange(e.target.value)}
                placeholder="280.00" />
            </Field>
            <Field label="Net Rate (PKR / kg)">
              <input type="number" name="net_rate" step="0.0001" min="0" className={INP}
                value={form.net_rate} onChange={setF('net_rate')} placeholder="3.50" />
            </Field>
            <Field label="Freight Amount (PKR)">
              <input readOnly className={RO} value={pkr(freightAmount)} />
            </Field>
            <Field label="CASS Airline Rate (USD / kg)">
              <input type="number" name="cass_airline_rate" step="0.0001" min="0" className={INP}
                value={form.cass_airline_rate} onChange={setF('cass_airline_rate')}
                placeholder="3.00" />
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field label="CASS Freight Total (PKR)">
              <input readOnly className={RO} value={pkr(cassFreightTotal)} />
            </Field>
            <Field label="Clearing Agent">
              <select name="clearing_agent_id" className={INP} value={form.clearing_agent_id}
                onChange={(e) => handleAgentChange(e.target.value)}>
                <option value="">None / manual</option>
                {clearingAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.origin_code})</option>
                ))}
              </select>
            </Field>
            <Field label="Clearing Charges (PKR)">
              <input type="number" name="clearing_charges" step="0.01" min="0" className={INP}
                value={form.clearing_charges}
                onChange={(e) => handleClearingChargesChange(e.target.value)} />
            </Field>
            <Field label={idcLabel}>
              <input type="number" name="idc_tax" step="0.01" min="0" className={INP}
                value={form.idc_tax} onChange={setF('idc_tax')}
                disabled={form.origin !== 'PEW'} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Other Charges (PKR)">
              <input type="number" name="other_charges_due_airline" step="0.01" min="0" className={INP}
                value={form.other_charges_due_airline} onChange={setF('other_charges_due_airline')}
                placeholder="0" />
            </Field>
            <Field label="AWB Fixed Fee (PKR)">
              <input type="number" name="awb_fixed_fee" step="0.01" min="0" className={INP}
                value={form.awb_fixed_fee} onChange={setF('awb_fixed_fee')} />
            </Field>
            <Field label="Sales Agent">
              <select name="sales_agent_id" className={INP} value={form.sales_agent_id} onChange={(e) => handleSalesAgentChange(e.target.value)}>
                <option value="">No SA (Sales Agent)</option>
                {salesAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
          </div>
          {form.sales_agent_id && (
            <div className="grid grid-cols-4 gap-3 items-end">
              <Field label="SA Commission (PKR / kg)">
                <input type="number" name="sales_agent_commission_per_kg" step="0.01" min="0" className={INP}
                  value={form.sales_agent_commission_per_kg} onChange={setF('sales_agent_commission_per_kg')}
                  placeholder="0.00" />
              </Field>
              <Field label="SA Commission Amount (PKR)">
                <input readOnly className={RO} value={pkr(salesAgentCommission)} />
              </Field>
            </div>
          )}
        </Section>
        )}

        {/* ── 4. Form E ── */}
        {!isDataEntry && (
        <Section title="Form E">
          <div className="grid grid-cols-4 gap-3">
            <Field label="Form E Supplier">
              <select name="form_e_supplier_id" className={INP} value={form.form_e_supplier_id} onChange={setF('form_e_supplier_id')}>
                <option value="">None</option>
                {formESuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="USD Value">
              <input type="number" name="form_e_usd_value" step="0.01" min="0" className={INP}
                value={form.form_e_usd_value} onChange={setF('form_e_usd_value')} placeholder="0" />
            </Field>
            <Field label="PKR Rate Receivable">
              <input type="number" name="form_e_pkr_rate" step="0.01" min="0" className={INP}
                value={form.form_e_pkr_rate} onChange={setF('form_e_pkr_rate')} placeholder="0.00" />
            </Field>
            <Field label="PKR Rate Payable">
              <input type="number" name="form_e_pkr_rate_payable" step="0.01" min="0" className={INP}
                value={form.form_e_pkr_rate_payable} onChange={setF('form_e_pkr_rate_payable')} placeholder="0.00" />
            </Field>
            <Field label="Form E Amount (PKR)">
              <input readOnly className={RO} value={pkr(formEAmountPkr)} />
            </Field>
          </div>
        </Section>
        )}

        {/* ── 5. Shipment Documents ── */}
        <Section title="Shipment Documents">
          {/* Already-saved documents */}
          {existingUrls.map((url, i) => (
            <div key={url} className="flex items-center gap-3 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-md">
              <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-700 hover:text-blue-900 underline flex-1 truncate"
              >
                Document {i + 1}
              </a>
              <button type="button" onClick={() => removeExisting(url)}
                className="text-gray-400 hover:text-danger flex-shrink-0" title="Remove">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {/* Newly selected files (not yet uploaded) */}
          {newFiles.map((file, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-green-50 border border-green-200 rounded-md">
              <FileText className="w-4 h-4 text-green-600 flex-shrink-0" />
              <span className="text-sm text-green-800 flex-1 truncate">{file.name}</span>
              <button type="button" onClick={() => removeNew(i)}
                className="text-gray-400 hover:text-danger flex-shrink-0" title="Remove">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {/* Drop zone / add button */}
          <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-gray-300 rounded-md cursor-pointer hover:border-accent hover:bg-blue-50 transition-colors">
            <UploadCloud className="w-5 h-5 text-gray-400" />
            <span className="text-sm text-gray-500">Click to attach PDF(s) — you can add multiple</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </label>
        </Section>

        {/* ── Total banner ── */}
        {!isDataEntry && (
        <div className="rounded-lg bg-navy px-5 py-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-white uppercase tracking-wide">
            Total Receivable
          </span>
          <span className="font-mono font-bold text-xl text-white">
            {pkr(totalReceivable)}
          </span>
        </div>
        )}

        {/* ── Notes ── */}
        <Field label="Notes">
          <textarea name="notes" className={INP} rows={2} value={form.notes} onChange={setF('notes')}
            placeholder="Any additional remarks…" />
        </Field>

        <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSave}>
            {(saving || uploading) && <Spinner size="sm" />}
            {uploading ? 'Uploading…' : mode === 'add' ? 'Add Shipment' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
