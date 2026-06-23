import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { Modal, ConfirmDialog } from '../ui/Modal'

const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

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

function num(n) {
  return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const EMPTY = {
  name: '', iata_prefix: '', cass_commission_usd_per_kg: 0,
  other_charges_self_upload: 0, awb_airline_upload_charges: 0,
  bta_rate_per_awb: 0, default_cass_rate_notes: '',
}

export function ManageAirlinesModal({ onClose, onChanged }) {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [editModal, setEditModal] = useState(null)   // null | { mode: 'add'|'edit', row? }
  const [deleteId, setDeleteId] = useState(null)
  const [form, setForm]         = useState(EMPTY)
  const [saving, setSaving]     = useState(false)

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('Supabase not configured'); return }
    setLoading(true); setError(null)
    const { data, error: e } = await supabase
      .from('airlines').select('*').eq('is_active', true).order('name')
    if (e) setError(e.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() { setForm(EMPTY); setEditModal({ mode: 'add' }) }
  function openEdit(r) {
    setForm({
      name: r.name, iata_prefix: r.iata_prefix,
      cass_commission_usd_per_kg: r.cass_commission_usd_per_kg ?? 0,
      other_charges_self_upload: r.other_charges_self_upload ?? 0,
      awb_airline_upload_charges: r.awb_airline_upload_charges ?? 0,
      bta_rate_per_awb: r.bta_rate_per_awb,
      default_cass_rate_notes: r.default_cass_rate_notes ?? '',
    })
    setEditModal({ mode: 'edit', row: r })
  }

  const setF = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }))
  const setN = (key) => (e) => setForm((p) => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))

  async function handleSave() {
    if (!form.name.trim() || !form.iata_prefix.trim()) return
    setSaving(true)
    const payload = { ...form, iata_prefix: form.iata_prefix.trim(), updated_at: new Date().toISOString() }
    const { error: e } = editModal.mode === 'add'
      ? await supabase.from('airlines').insert(payload)
      : await supabase.from('airlines').update(payload).eq('id', editModal.row.id)
    setSaving(false)
    if (e) { alert(e.message); return }
    setEditModal(null)
    await load()
    onChanged?.()
  }

  async function handleDelete() {
    await supabase.from('airlines').update({ is_active: false }).eq('id', deleteId)
    setDeleteId(null)
    await load()
    onChanged?.()
  }

  const canSave = !saving && form.name.trim() && form.iata_prefix.trim()

  return (
    <>
      <Modal title="Manage Airlines" onClose={onClose} size="xl">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {loading ? 'Loading…' : `${rows.length} airline${rows.length !== 1 ? 's' : ''}`}
            </p>
            <Button size="sm" onClick={openAdd}>
              <Plus className="w-4 h-4" /> Add Airline
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Spinner size="lg" /></div>
          ) : error ? (
            <div className="py-6 text-center text-danger text-sm">{error}</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="font-medium">No airlines yet</p>
              <p className="text-sm mt-1">Click "Add Airline" to create your first one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Airline Name</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Prefix</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Commission (USD/kg)</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Self-Upload (USD)</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">AWB Upload (USD)</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">BTA/AWB</th>
                    <th className="px-3 py-2.5 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-medium text-gray-900">{r.name}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs tracking-widest">
                          {r.iata_prefix}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-700 text-xs">USD {num(r.cass_commission_usd_per_kg ?? 0)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600 text-xs">USD {num(r.other_charges_self_upload ?? 0)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600 text-xs">USD {num(r.awb_airline_upload_charges ?? 0)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600 text-xs">PKR {num(r.bta_rate_per_awb)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1 justify-end">
                          <button
                            title="Edit"
                            onClick={() => openEdit(r)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-navy transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            title="Delete"
                            onClick={() => setDeleteId(r.id)}
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-danger transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {editModal && (
        <Modal
          title={editModal.mode === 'add' ? 'Add Airline' : 'Edit Airline'}
          onClose={() => setEditModal(null)}
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Airline Name" required>
                <input className={INP} value={form.name} onChange={setF('name')} placeholder="e.g. Emirates" />
              </Field>
              <Field label="IATA Prefix (3-digit numeric)" required>
                <input
                  className={INP} value={form.iata_prefix} maxLength={3}
                  onChange={setF('iata_prefix')} placeholder="e.g. 176"
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="CASS Commission (USD/kg)">
                <input type="number" step="0.0001" min="0" className={INP}
                  value={form.cass_commission_usd_per_kg} onChange={setN('cass_commission_usd_per_kg')} />
              </Field>
              <Field label="Self-Upload Charges (USD — agent uploads AWB)">
                <input type="number" step="0.01" min="0" className={INP}
                  value={form.other_charges_self_upload} onChange={setN('other_charges_self_upload')} />
              </Field>
              <Field label="AWB Airline Upload Charges (USD — airline uploads)">
                <input type="number" step="0.01" min="0" className={INP}
                  value={form.awb_airline_upload_charges} onChange={setN('awb_airline_upload_charges')} />
              </Field>
            </div>
            <Field label="BTA Rate per AWB (PKR)">
              <input type="number" step="0.01" min="0" className={INP}
                value={form.bta_rate_per_awb} onChange={setN('bta_rate_per_awb')} />
            </Field>
            <Field label="CASS Rate Notes">
              <textarea className={INP} rows={2} value={form.default_cass_rate_notes}
                onChange={setF('default_cass_rate_notes')} placeholder="Any notes on the standard CASS rate…" />
            </Field>
            <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setEditModal(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!canSave}>
                {saving && <Spinner size="sm" />}
                {editModal.mode === 'add' ? 'Add Airline' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Airline"
          message="This airline will be removed from the list. Existing shipment records are kept."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  )
}
