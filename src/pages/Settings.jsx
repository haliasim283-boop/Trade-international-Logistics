import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Building2, Settings2, Upload, Download, Trash2,
  Plus, Pencil, Trash, CheckCircle, AlertCircle, ChevronDown, X, Save,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { Modal } from '../components/ui/Modal'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB')
}

function parseCSV(text) {
  const lines  = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }
  const splitLine = (l) => {
    const cells = []; let cur = '', inQ = false
    for (const ch of l) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    cells.push(cur.trim())
    return cells
  }
  const headers = splitLine(lines[0])
  const rows    = lines.slice(1).map((l) => {
    const vals = splitLine(l)
    const obj  = {}
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').replace(/^"|"$/g, '') })
    return obj
  })
  return { headers, rows }
}

// ── Label / Input helpers ─────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

const INPUT_CLS = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return <input type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder} className={INPUT_CLS} />
}

function NumberInput({ value, onChange, step = '0.01', min = '0' }) {
  return <input type="number" step={step} min={min} value={value ?? ''} onChange={onChange} className={INPUT_CLS} />
}

// ── Section title ─────────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-px flex-1 bg-gray-200"></div>
      <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{children}</span>
      <div className="h-px flex-1 bg-gray-200"></div>
    </div>
  )
}

// ── Tab button ────────────────────────────────────────────────────────────────

function Tab({ label, icon: Icon, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
        active
          ? 'bg-navy text-white'
          : 'text-gray-600 hover:bg-gray-100'
      }`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
      type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
    }`}>
      {type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
      {msg}
    </div>
  )
}

// ── CSV Import Wizard ─────────────────────────────────────────────────────────

function CsvImportWizard({ title, systemFields, onImport, onClose }) {
  const [step,     setStep]     = useState(1) // 1=upload, 2=map, 3=preview, 4=done
  const [parsed,   setParsed]   = useState(null) // { headers, rows }
  const [mapping,  setMapping]  = useState({})  // systemField -> csvHeader
  const [results,  setResults]  = useState(null)  // { ok, errors }
  const [importing,setImporting]= useState(false)
  const fileRef = useRef()

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result)
      setParsed(parsed)
      // Auto-map obvious columns
      const autoMap = {}
      for (const sf of systemFields) {
        const match = parsed.headers.find((h) =>
          h.toLowerCase().replace(/[\s_-]/g, '') === sf.csvAlias?.toLowerCase().replace(/[\s_-]/g, '') ||
          h.toLowerCase().replace(/[\s_-]/g, '') === sf.key.toLowerCase().replace(/[\s_-]/g, '')
        )
        if (match) autoMap[sf.key] = match
      }
      setMapping(autoMap)
      setStep(2)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setImporting(true)
    try {
      const res = await onImport(parsed.rows, mapping)
      setResults(res)
      setStep(4)
    } catch (err) {
      setResults({ ok: 0, errors: [err.message] })
      setStep(4)
    } finally {
      setImporting(false)
    }
  }

  const previewRows = parsed?.rows.slice(0, 5) ?? []

  return (
    <Modal title={title} onClose={onClose} size="xl">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {['Upload', 'Map Columns', 'Preview', 'Done'].map((lbl, i) => (
          <div key={lbl} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
              step === i + 1 ? 'bg-navy text-white border-navy' :
              step > i + 1  ? 'bg-green-500 text-white border-green-500' :
                              'bg-white text-gray-400 border-gray-300'
            }`}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${step === i + 1 ? 'text-navy' : 'text-gray-400'}`}>{lbl}</span>
            {i < 3 && <div className="w-6 h-px bg-gray-200"></div>}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="text-center py-8">
          <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-600 mb-4">Upload a CSV file to import</p>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" /> Choose CSV File
          </Button>
          <div className="mt-4 text-xs text-gray-400">
            <p className="font-medium mb-1">Expected columns:</p>
            <p>{systemFields.filter((f) => f.required).map((f) => f.label).join(', ')}</p>
          </div>
        </div>
      )}

      {/* Step 2: Map columns */}
      {step === 2 && parsed && (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Match your CSV columns to the system fields. {parsed.rows.length} rows found.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {systemFields.map((sf) => (
              <div key={sf.key} className="flex items-center gap-2">
                <span className={`text-xs font-medium w-40 flex-shrink-0 ${sf.required ? 'text-navy' : 'text-gray-500'}`}>
                  {sf.label}{sf.required && ' *'}
                </span>
                <div className="relative flex-1">
                  <select
                    value={mapping[sf.key] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [sf.key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-accent pr-6">
                    <option value="">— skip —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-gray-400 absolute right-1.5 top-2 pointer-events-none" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4 justify-end">
            <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => setStep(3)}
              disabled={systemFields.filter((f) => f.required).some((f) => !mapping[f.key])}>
              Preview →
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 3 && parsed && (
        <div>
          <p className="text-sm text-gray-600 mb-3">
            Showing first {previewRows.length} of {parsed.rows.length} rows. Verify before importing.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-navy text-white">
                  {systemFields.filter((f) => mapping[f.key]).map((f) => (
                    <th key={f.key} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewRows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {systemFields.filter((f) => mapping[f.key]).map((f) => (
                      <td key={f.key} className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                        {row[mapping[f.key]] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > 5 && (
            <p className="text-xs text-gray-400 mt-2">… and {parsed.rows.length - 5} more rows</p>
          )}
          <div className="flex gap-2 mt-4 justify-end">
            <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing ? <><Spinner size="sm" /> Importing…</> : `Import ${parsed.rows.length} rows`}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 4 && results && (
        <div className="text-center py-6">
          {results.errors?.length === 0 || results.ok > 0 ? (
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
          ) : (
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          )}
          <p className="text-lg font-bold text-gray-800 mb-1">Import Complete</p>
          <p className="text-sm text-green-700 mb-1">{results.ok} records imported successfully</p>
          {results.errors?.length > 0 && (
            <div className="mt-3 text-left bg-red-50 rounded-lg p-3 max-h-40 overflow-y-auto">
              {results.errors.slice(0, 20).map((e, i) => (
                <p key={i} className="text-xs text-red-700">{e}</p>
              ))}
              {results.errors.length > 20 && (
                <p className="text-xs text-red-500">…and {results.errors.length - 20} more errors</p>
              )}
            </div>
          )}
          <Button className="mt-4" onClick={onClose}>Done</Button>
        </div>
      )}
    </Modal>
  )
}

// ── Shipment import handler ───────────────────────────────────────────────────

const SHIPMENT_FIELDS = [
  { key: 'awb_number',        label: 'AWB Number',        required: true, csvAlias: 'AWB' },
  { key: 'flight_date',       label: 'Date (YYYY-MM-DD)', required: true, csvAlias: 'Date' },
  { key: 'client_name',       label: 'Client Name',       required: true, csvAlias: 'Client' },
  { key: 'airline_name',      label: 'Airline Name',      required: true, csvAlias: 'Airline' },
  { key: 'origin',            label: 'Origin (IATA)',     required: true, csvAlias: 'ORG' },
  { key: 'destination',       label: 'Destination',       required: false, csvAlias: 'DST' },
  { key: 'pieces',            label: 'Pieces',            required: false, csvAlias: 'PCS' },
  { key: 'chargeable_weight', label: 'Chargeable Weight', required: false, csvAlias: 'Weight' },
  { key: 'net_rate',          label: 'Net Rate (PKR/kg)', required: false, csvAlias: 'Rate' },
  { key: 'clearing_charges',  label: 'Clearing Charges',  required: false, csvAlias: 'Clearing' },
  { key: 'other_charges',     label: 'Other Charges',     required: false, csvAlias: 'Other' },
  { key: 'form_e_usd_value',  label: 'Form E USD Value',  required: false, csvAlias: 'FormE USD' },
  { key: 'form_e_pkr_rate',   label: 'Form E PKR Rate',   required: false, csvAlias: 'FormE Rate' },
  { key: 'cass_airline_rate', label: 'CASS Airline Rate', required: false, csvAlias: 'CASS Rate' },
  { key: 'status',            label: 'Status',            required: false, csvAlias: 'Status' },
]

async function importShipments(rows, mapping) {
  // Load lookup maps
  const [{ data: clients }, { data: airlines }] = await Promise.all([
    supabase.from('clients').select('id,name'),
    supabase.from('airlines').select('id,name'),
  ])
  const clientMap  = Object.fromEntries((clients  || []).map((c) => [c.name.toLowerCase().trim(), c.id]))
  const airlineMap = Object.fromEntries((airlines || []).map((a) => [a.name.toLowerCase().trim(), a.id]))

  let ok = 0
  const errors = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const get = (key) => mapping[key] ? (row[mapping[key]] ?? '').trim() : ''
    const num = (key, def = 0) => {
      const v = parseFloat(get(key).replace(/,/g, ''))
      return isNaN(v) ? def : v
    }

    const clientName  = get('client_name')
    const airlineName = get('airline_name')
    const clientId    = clientMap[clientName.toLowerCase()]
    const airlineId   = airlineMap[airlineName.toLowerCase()]

    if (!clientId)  { errors.push(`Row ${i + 2}: Client "${clientName}" not found`); continue }
    if (!airlineId) { errors.push(`Row ${i + 2}: Airline "${airlineName}" not found`); continue }

    const awb    = get('awb_number')
    const date   = get('flight_date')
    const origin = get('origin').toUpperCase()
    const dest   = get('destination').toUpperCase()

    if (!awb || !date) { errors.push(`Row ${i + 2}: AWB and Date are required`); continue }

    const { error } = await supabase.from('shipments').insert({
      awb_number:        awb,
      flight_date:       date,
      client_id:         clientId,
      airline_id:        airlineId,
      origin:            origin || 'PEW',
      destination:       dest   || '',
      pieces:            parseInt(get('pieces') || '1', 10) || 1,
      chargeable_weight: num('chargeable_weight'),
      net_rate:          num('net_rate'),
      clearing_charges:  num('clearing_charges'),
      other_charges:     num('other_charges'),
      form_e_usd_value:  num('form_e_usd_value'),
      form_e_pkr_rate:   num('form_e_pkr_rate'),
      cass_airline_rate: num('cass_airline_rate'),
      status:            get('status') || 'Departed',
    })
    if (error) { errors.push(`Row ${i + 2}: ${error.message}`); continue }
    ok++
  }
  return { ok, errors }
}

// ── Payment import handler ────────────────────────────────────────────────────

const PAYMENT_FIELDS = [
  { key: 'payment_date',    label: 'Date (YYYY-MM-DD)',  required: true,  csvAlias: 'Date' },
  { key: 'client_name',     label: 'Client Name',        required: true,  csvAlias: 'Client' },
  { key: 'amount',          label: 'Amount (PKR)',        required: true,  csvAlias: 'Amount' },
  { key: 'payment_method',  label: 'Payment Method',     required: false, csvAlias: 'Method' },
  { key: 'bank_account',    label: 'Bank Account',       required: false, csvAlias: 'Bank' },
  { key: 'transaction_id',  label: 'TRX ID',             required: false, csvAlias: 'TRX' },
  { key: 'description',     label: 'Description',        required: false, csvAlias: 'Notes' },
]

const VALID_METHODS = ['Bank Transfer', 'RAAST', 'Cheque', 'Cash', 'Foreign Remittance']

async function importPayments(rows, mapping) {
  const { data: clients } = await supabase.from('clients').select('id,name')
  const clientMap = Object.fromEntries((clients || []).map((c) => [c.name.toLowerCase().trim(), c.id]))

  let ok = 0
  const errors = []
  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i]
    const get  = (key) => mapping[key] ? (row[mapping[key]] ?? '').trim() : ''
    const name = get('client_name')
    const cid  = clientMap[name.toLowerCase()]
    if (!cid)  { errors.push(`Row ${i + 2}: Client "${name}" not found`); continue }

    const amt = parseFloat(get('amount').replace(/,/g, ''))
    if (isNaN(amt) || amt <= 0) { errors.push(`Row ${i + 2}: Invalid amount`); continue }

    const date   = get('payment_date')
    const method = VALID_METHODS.includes(get('payment_method')) ? get('payment_method') : 'Bank Transfer'
    if (!date) { errors.push(`Row ${i + 2}: Date is required`); continue }

    const { error } = await supabase.from('client_payments').insert({
      client_id:      cid,
      payment_date:   date,
      amount:         amt,
      payment_method: method,
      bank_account:   get('bank_account') || null,
      transaction_id: get('transaction_id') || null,
      description:    get('description') || null,
    })
    if (error) { errors.push(`Row ${i + 2}: ${error.message}`); continue }
    ok++
  }
  return { ok, errors }
}

// ── Opening Balance Modal ─────────────────────────────────────────────────────

function OpeningBalanceModal({ clients, onClose, onSaved }) {
  const [clientId, setClientId] = useState('')
  const [amount,   setAmount]   = useState('')
  const [date,     setDate]     = useState(new Date().toISOString().slice(0, 10))
  const [notes,    setNotes]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)

  async function save() {
    if (!clientId || !amount || !date) return
    setSaving(true); setError(null)
    const { error: e } = await supabase.from('client_opening_balances').upsert({
      client_id:    clientId,
      balance_date: date,
      amount:       parseFloat(amount),
      notes:        notes || null,
    }, { onConflict: 'client_id' })
    setSaving(false)
    if (e) { setError(e.message); return }
    onSaved()
  }

  return (
    <Modal title="Set Client Opening Balance" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Set the outstanding balance for a client as of a specific date (before the system start date).
          This will appear as the first entry in their ledger.
        </p>
        <Field label="Client *">
          <div className="relative">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={INPUT_CLS}>
              <option value="">— Select client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Opening Balance (PKR) *">
          <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="As-of Date *">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT_CLS} />
        </Field>
        <Field label="Notes">
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., Balance brought forward from legacy system" />
        </Field>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !clientId || !amount || !date}>
            {saving ? <><Spinner size="sm" /> Saving…</> : 'Save Opening Balance'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Settings page ────────────────────────────────────────────────────────

const TABS = [
  { key: 'company',  label: 'Company Profile', icon: Building2 },
  { key: 'system',   label: 'System Config',   icon: Settings2 },
  { key: 'import',   label: 'Data Import',     icon: Upload },
  { key: 'manage',   label: 'Data Management', icon: Download },
]

export default function Settings() {
  const [activeTab, setActiveTab] = useState('company')
  const [settings,  setSettings]  = useState(null)
  const [clients,   setClients]   = useState([])
  const [openBals,  setOpenBals]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState(null)  // { msg, type }
  const [wizard,    setWizard]    = useState(null)  // null | 'shipments' | 'payments'
  const [obModal,   setObModal]   = useState(false)
  const [clearStep, setClearStep] = useState(0)     // 0=idle, 1=confirm, 2=typed
  const [clearText, setClearText] = useState('')
  const [clearing,  setClearing]  = useState(false)
  const [exportDL,  setExportDL]  = useState(false)
  const [restoring, setRestoring] = useState(false)
  const restoreRef = useRef()

  function toast_msg(msg, type = 'success') { setToast({ msg, type }) }

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const [{ data: s }, { data: c }, { data: ob }] = await Promise.all([
      supabase.from('company_settings').select('*').eq('id', 1).single(),
      supabase.from('clients').select('id,name').eq('is_active', true).order('name'),
      supabase.from('client_opening_balances').select('*, clients(name)').order('balance_date'),
    ])
    if (s) setSettings(s)
    setClients(c || [])
    setOpenBals(ob || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function setField(key, value) {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  async function saveSettings() {
    if (!settings) return
    setSaving(true)
    const { error } = await supabase.from('company_settings').update({
      company_name:            settings.company_name,
      company_address:         settings.company_address,
      contact_person:          settings.contact_person,
      phone:                   settings.phone,
      email:                   settings.email,
      iata_code:               settings.iata_code,
      vat_registration:        settings.vat_registration,
      bank_1_iban:             settings.bank_1_iban,
      bank_1_name:             settings.bank_1_name,
      bank_1_account_name:     settings.bank_1_account_name,
      bank_2_iban:             settings.bank_2_iban,
      bank_2_name:             settings.bank_2_name,
      bank_2_account_name:     settings.bank_2_account_name,
      isc_tax_rate:            settings.isc_tax_rate,
      invoice_overdue_days:    settings.invoice_overdue_days,
      cass_wht_rate:           settings.cass_wht_rate,
      default_form_e_rate_min: settings.default_form_e_rate_min,
      default_form_e_rate_max: settings.default_form_e_rate_max,
      updated_at:              new Date().toISOString(),
    }).eq('id', 1)
    setSaving(false)
    if (error) { toast_msg(error.message, 'error') }
    else       { toast_msg('Settings saved successfully') }
  }

  // ── Export all data ──────────────────────────────────────────────────────────
  async function exportAllData() {
    setExportDL(true)
    try {
      const tables = [
        'company_settings','clients','airlines','form_e_suppliers','clearing_agents',
        'shipments','invoices','client_opening_balances','client_payments',
        'cass_periods','cass_payments','cass_adjustments','form_e_payments',
        'clearing_agent_payments','expenses','manual_income',
      ]
      const snapshot = {}
      for (const t of tables) {
        const { data } = await supabase.from(t).select('*')
        snapshot[t] = data ?? []
      }
      snapshot._exported_at = new Date().toISOString()
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a'); a.href = url
      a.download = `til-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(url)
      toast_msg('Data exported successfully')
    } catch (err) {
      toast_msg(err.message, 'error')
    } finally {
      setExportDL(false)
    }
  }

  // ── Restore from backup ─────────────────────────────────────────────────────
  async function handleRestoreFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setRestoring(true)
    try {
      const text = await file.text()
      const snap  = JSON.parse(text)
      const ORDER = [
        'company_settings','clients','airlines','form_e_suppliers','clearing_agents',
        'shipments','invoices','client_opening_balances','client_payments',
        'cass_periods','cass_payments','cass_adjustments','form_e_payments',
        'clearing_agent_payments','expenses','manual_income',
      ]
      for (const t of ORDER) {
        if (!snap[t]?.length) continue
        const { error } = await supabase.from(t).upsert(snap[t], { ignoreDuplicates: false })
        if (error) throw new Error(`${t}: ${error.message}`)
      }
      toast_msg('Backup restored successfully')
      load()
    } catch (err) {
      toast_msg(err.message, 'error')
    } finally {
      setRestoring(false)
      if (restoreRef.current) restoreRef.current.value = ''
    }
  }

  // ── Clear all data ──────────────────────────────────────────────────────────
  async function clearAllData() {
    if (clearText !== 'DELETE') return
    setClearing(true)
    try {
      const REVERSE = [
        'manual_income','expenses','clearing_agent_payments','form_e_payments',
        'cass_adjustments','cass_payments','cass_periods','client_payments',
        'client_opening_balances','invoices','shipments','clearing_agents',
        'form_e_suppliers','airlines','clients',
      ]
      for (const t of REVERSE) {
        await supabase.from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000')
      }
      toast_msg('All data cleared')
      setClearStep(0); setClearText('')
      load()
    } catch (err) {
      toast_msg(err.message, 'error')
    } finally {
      setClearing(false)
    }
  }

  async function deleteOpeningBalance(id) {
    await supabase.from('client_opening_balances').delete().eq('id', id)
    load()
  }

  if (!supabase) return <div className="p-6 text-danger text-sm">Supabase not configured.</div>

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-navy">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Company profile, system configuration &amp; data management</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Tab key={t.key} label={t.label} icon={t.icon}
            active={activeTab === t.key}
            onClick={() => setActiveTab(t.key)} />
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (

        <>
          {/* ── Company Profile Tab ── */}
          {activeTab === 'company' && settings && (
            <Card>
              <CardBody>
                <SectionTitle>Company Identity</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <Field label="Company Name">
                    <TextInput value={settings.company_name}
                      onChange={(e) => setField('company_name', e.target.value)} />
                  </Field>
                  <Field label="IATA Code">
                    <TextInput value={settings.iata_code}
                      onChange={(e) => setField('iata_code', e.target.value)} />
                  </Field>
                  <Field label="VAT Registration">
                    <TextInput value={settings.vat_registration}
                      onChange={(e) => setField('vat_registration', e.target.value)} />
                  </Field>
                  <Field label="Contact Person">
                    <TextInput value={settings.contact_person}
                      onChange={(e) => setField('contact_person', e.target.value)} />
                  </Field>
                  <Field label="Phone">
                    <TextInput value={settings.phone}
                      onChange={(e) => setField('phone', e.target.value)} />
                  </Field>
                  <Field label="Email">
                    <TextInput type="email" value={settings.email}
                      onChange={(e) => setField('email', e.target.value)} />
                  </Field>
                  <Field label="Company Address" >
                    <textarea rows={2} value={settings.company_address ?? ''}
                      onChange={(e) => setField('company_address', e.target.value)}
                      className={`${INPUT_CLS} resize-none`} />
                  </Field>
                </div>

                <SectionTitle>Bank Accounts</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <Field label="Bank 1 Name">
                    <TextInput value={settings.bank_1_name}
                      onChange={(e) => setField('bank_1_name', e.target.value)} />
                  </Field>
                  <Field label="Bank 1 IBAN">
                    <TextInput value={settings.bank_1_iban}
                      onChange={(e) => setField('bank_1_iban', e.target.value)} />
                  </Field>
                  <Field label="Bank 1 Account Name">
                    <TextInput value={settings.bank_1_account_name}
                      onChange={(e) => setField('bank_1_account_name', e.target.value)} />
                  </Field>
                  <Field label="Bank 2 Name">
                    <TextInput value={settings.bank_2_name}
                      onChange={(e) => setField('bank_2_name', e.target.value)} />
                  </Field>
                  <Field label="Bank 2 IBAN">
                    <TextInput value={settings.bank_2_iban}
                      onChange={(e) => setField('bank_2_iban', e.target.value)} />
                  </Field>
                  <Field label="Bank 2 Account Name">
                    <TextInput value={settings.bank_2_account_name}
                      onChange={(e) => setField('bank_2_account_name', e.target.value)} />
                  </Field>
                </div>

                <div className="flex justify-end">
                  <Button onClick={saveSettings} disabled={saving}>
                    {saving ? <><Spinner size="sm" /> Saving…</> : <><Save className="w-4 h-4" /> Save Company Profile</>}
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* ── System Config Tab ── */}
          {activeTab === 'system' && settings && (
            <Card>
              <CardBody>
                <SectionTitle>Clearing &amp; Tax</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  <Field label="ISC Tax Rate % (PEW in-house clearing)">
                    <NumberInput step="0.01" value={settings.isc_tax_rate}
                      onChange={(e) => setField('isc_tax_rate', e.target.value)} />
                  </Field>
                  <Field label="CASS WHT Rate % (Withholding Tax)">
                    <NumberInput step="0.01" value={settings.cass_wht_rate}
                      onChange={(e) => setField('cass_wht_rate', e.target.value)} />
                  </Field>
                  <Field label="Invoice Overdue Days">
                    <NumberInput step="1" value={settings.invoice_overdue_days}
                      onChange={(e) => setField('invoice_overdue_days', e.target.value)} />
                  </Field>
                </div>

                <SectionTitle>Form E Rate Defaults</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <Field label="Default Rate Minimum (PKR/USD)">
                    <NumberInput step="0.01" value={settings.default_form_e_rate_min}
                      onChange={(e) => setField('default_form_e_rate_min', e.target.value)} />
                  </Field>
                  <Field label="Default Rate Maximum (PKR/USD)">
                    <NumberInput step="0.01" value={settings.default_form_e_rate_max}
                      onChange={(e) => setField('default_form_e_rate_max', e.target.value)} />
                  </Field>
                </div>

                <div className="p-4 bg-blue-50 rounded-lg text-xs text-blue-700 mb-6">
                  <p className="font-semibold mb-1">Note on rates:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>ISC Tax Rate applies only to in-house (PEW) clearing charges on invoices</li>
                    <li>CASS WHT (12%) is the withholding tax on airline payments — reduce net amount due to airline</li>
                    <li>Invoice overdue days is used to highlight unpaid invoices and client balances</li>
                    <li>BTA rates are configured per-airline in Party Management → Airlines</li>
                  </ul>
                </div>

                <div className="flex justify-end">
                  <Button onClick={saveSettings} disabled={saving}>
                    {saving ? <><Spinner size="sm" /> Saving…</> : <><Save className="w-4 h-4" /> Save System Config</>}
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* ── Data Import Tab ── */}
          {activeTab === 'import' && (
            <div className="space-y-6">
              {/* Bulk Shipment Import */}
              <Card>
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-navy mb-1">Bulk Shipment Import</h3>
                      <p className="text-sm text-gray-500">
                        Import historical shipment records from a CSV file. Clients and airlines must already exist
                        in Party Management before importing.
                      </p>
                      <div className="mt-2 text-xs text-gray-400">
                        Required columns: AWB Number, Date, Client Name, Airline Name, Origin
                      </div>
                    </div>
                    <Button onClick={() => setWizard('shipments')} className="flex-shrink-0">
                      <Upload className="w-4 h-4" /> Import CSV
                    </Button>
                  </div>
                </CardBody>
              </Card>

              {/* Client Opening Balances */}
              <Card>
                <CardBody>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-semibold text-navy mb-1">Client Opening Balances</h3>
                      <p className="text-sm text-gray-500">
                        Set a carried-forward balance for clients who had outstanding amounts before this system
                        was started. This appears as the first row in their ledger.
                      </p>
                    </div>
                    <Button onClick={() => setObModal(true)} className="flex-shrink-0">
                      <Plus className="w-4 h-4" /> Add / Edit
                    </Button>
                  </div>
                  {openBals.length === 0 ? (
                    <p className="text-sm text-gray-400 py-3 text-center border rounded-lg border-dashed">
                      No opening balances set. Click "Add / Edit" to set one for a client.
                    </p>
                  ) : (
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-navy text-white">
                          {['Client', 'As-of Date', 'Opening Balance (PKR)', ''].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {openBals.map((ob) => (
                          <tr key={ob.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-800">{ob.clients?.name}</td>
                            <td className="px-3 py-2.5 text-gray-600">{fmtDate(ob.balance_date)}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-800">PKR {fmt(ob.amount)}</td>
                            <td className="px-3 py-2.5">
                              <button onClick={() => deleteOpeningBalance(ob.id)}
                                className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-danger">
                                <Trash className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardBody>
              </Card>

              {/* Historical Payment Import */}
              <Card>
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-navy mb-1">Historical Payment Records</h3>
                      <p className="text-sm text-gray-500">
                        Import historical client payment records. These will appear as payment rows in Party Ledgers
                        and will also show up in the Income module.
                      </p>
                      <div className="mt-2 text-xs text-gray-400">
                        Required columns: Date, Client Name, Amount (PKR)
                      </div>
                    </div>
                    <Button onClick={() => setWizard('payments')} className="flex-shrink-0">
                      <Upload className="w-4 h-4" /> Import CSV
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          {/* ── Data Management Tab ── */}
          {activeTab === 'manage' && (
            <div className="space-y-6">
              {/* Export */}
              <Card>
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-navy mb-1">Export All Data</h3>
                      <p className="text-sm text-gray-500">
                        Download a full JSON backup of all tables — shipments, invoices, payments, clients,
                        airlines, expenses, settings, and more.
                      </p>
                    </div>
                    <Button variant="secondary" onClick={exportAllData} disabled={exportDL} className="flex-shrink-0">
                      {exportDL ? <><Spinner size="sm" /> Exporting…</> : <><Download className="w-4 h-4" /> Export JSON</>}
                    </Button>
                  </div>
                </CardBody>
              </Card>

              {/* Restore */}
              <Card>
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-navy mb-1">Restore from Backup</h3>
                      <p className="text-sm text-gray-500">
                        Upload a previously exported JSON backup file. Existing records with matching IDs will
                        be updated; new records will be inserted.
                      </p>
                      <p className="text-xs text-amber-600 mt-1">Warning: this will overwrite existing records with the same ID.</p>
                    </div>
                    <div>
                      <input ref={restoreRef} type="file" accept=".json" onChange={handleRestoreFile} className="hidden" />
                      <Button variant="secondary" onClick={() => restoreRef.current?.click()} disabled={restoring} className="flex-shrink-0">
                        {restoring ? <><Spinner size="sm" /> Restoring…</> : <><Upload className="w-4 h-4" /> Restore JSON</>}
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* Clear all data */}
              <Card>
                <CardBody>
                  <h3 className="font-semibold text-danger mb-1">Clear All Data</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Permanently delete ALL data from the system — shipments, invoices, payments, clients,
                    airlines, expenses, and more. Company settings and user accounts are preserved.
                    This action cannot be undone.
                  </p>
                  {clearStep === 0 && (
                    <Button variant="danger" onClick={() => setClearStep(1)}>
                      <Trash2 className="w-4 h-4" /> Clear All Data
                    </Button>
                  )}
                  {clearStep >= 1 && (
                    <div className="border-2 border-red-300 rounded-lg p-4 bg-red-50">
                      <p className="text-sm font-semibold text-red-800 mb-3">
                        This will permanently delete ALL records. Type <strong>DELETE</strong> to confirm:
                      </p>
                      <div className="flex gap-2">
                        <input
                          value={clearText}
                          onChange={(e) => setClearText(e.target.value)}
                          placeholder="Type DELETE"
                          className="border border-red-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 flex-1"
                        />
                        <Button variant="danger"
                          onClick={clearAllData}
                          disabled={clearText !== 'DELETE' || clearing}>
                          {clearing ? <><Spinner size="sm" /> Clearing…</> : 'Confirm Clear'}
                        </Button>
                        <Button variant="secondary" onClick={() => { setClearStep(0); setClearText('') }}>
                          <X className="w-4 h-4" /> Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ── Modals ── */}
      {wizard === 'shipments' && (
        <CsvImportWizard
          title="Bulk Shipment Import"
          systemFields={SHIPMENT_FIELDS}
          onImport={importShipments}
          onClose={() => setWizard(null)}
        />
      )}
      {wizard === 'payments' && (
        <CsvImportWizard
          title="Historical Payment Records Import"
          systemFields={PAYMENT_FIELDS}
          onImport={importPayments}
          onClose={() => setWizard(null)}
        />
      )}
      {obModal && (
        <OpeningBalanceModal
          clients={clients}
          onClose={() => setObModal(false)}
          onSaved={() => { setObModal(false); load() }}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  )
}
