import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, BarChart2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { Table, Thead, Th, Tbody, Tr, Td } from '../ui/Table'
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

function num(n) { return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

const EMPTY = {
  name: '', iata_prefix: '',
  other_charges_self_upload: 0, awb_airline_upload_charges: 0,
  bta_rate_per_awb: 0, default_cass_rate_notes: '',
}

export function AirlinesTab() {
  const navigate = useNavigate()
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [modal, setModal]       = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [form, setForm]         = useState(EMPTY)
  const [saving, setSaving]     = useState(false)

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('Supabase not configured'); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('airlines').select('*').eq('is_active', true).order('name')
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd()   { setForm(EMPTY); setModal({ mode: 'add' }) }
  function openEdit(r) {
    setForm({
      name: r.name, iata_prefix: r.iata_prefix,
      other_charges_self_upload: r.other_charges_self_upload ?? 0,
      awb_airline_upload_charges: r.awb_airline_upload_charges ?? 0,
      bta_rate_per_awb: r.bta_rate_per_awb,
      default_cass_rate_notes: r.default_cass_rate_notes ?? '',
    })
    setModal({ mode: 'edit', row: r })
  }

  function setF(key) { return (e) => setForm((p) => ({ ...p, [key]: e.target.value })) }
  function setN(key) { return (e) => setForm((p) => ({ ...p, [key]: parseFloat(e.target.value) || 0 })) }

  async function handleSave() {
    if (!form.name.trim() || !form.iata_prefix.trim()) return
    setSaving(true)
    const payload = { ...form, iata_prefix: form.iata_prefix.trim(), updated_at: new Date().toISOString() }
    const { error } = modal.mode === 'add'
      ? await supabase.from('airlines').insert(payload)
      : await supabase.from('airlines').update(payload).eq('id', modal.row.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    setModal(null); load()
  }

  async function handleDelete() {
    await supabase.from('airlines').update({ is_active: false }).eq('id', deleteId)
    setDeleteId(null); load()
  }

  const canSave = !saving && form.name.trim() && form.iata_prefix.trim()

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error)   return <div className="py-8 text-center text-danger text-sm">{error}</div>

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{rows.length} airline{rows.length !== 1 ? 's' : ''}</p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" />Add Airline</Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-base font-medium">No airlines yet</p>
          <p className="text-sm mt-1">Click "Add Airline" to create your first airline.</p>
        </div>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Airline Name</Th><Th>Prefix</Th>
              <Th className="text-right">Self-Upload Chgs (USD)</Th>
              <Th className="text-right">AWB Upload Chgs (USD)</Th>
              <Th className="text-right">BTA / AWB</Th>
              <Th>Actions</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td><span className="font-medium text-gray-900">{r.name}</span></Td>
                <Td>
                  <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs tracking-wider">
                    {r.iata_prefix}
                  </span>
                </Td>
                <Td className="font-mono text-right text-gray-700">USD {num(r.other_charges_self_upload ?? 0)}</Td>
                <Td className="font-mono text-right text-gray-700">USD {num(r.awb_airline_upload_charges ?? 0)}</Td>
                <Td className="font-mono text-right text-gray-700">PKR {num(r.bta_rate_per_awb)}</Td>
                <Td>
                  <div className="flex gap-1">
                    <button title="Edit" onClick={() => openEdit(r)}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-navy transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button title="Delete" onClick={() => setDeleteId(r.id)}
                      className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-danger transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button title="View Sales Report" onClick={() => navigate('/cass', { state: { airlineId: r.id } })}
                      className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-accent transition-colors">
                      <BarChart2 className="w-4 h-4" />
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Airline' : 'Edit Airline'} onClose={() => setModal(null)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Airline Name" required>
                <input className={INP} value={form.name} onChange={setF('name')}
                  placeholder="e.g. Emirates" />
              </Field>
              <Field label="IATA Prefix (3-digit numeric)" required>
                <input className={INP} value={form.iata_prefix} maxLength={3} onChange={setF('iata_prefix')}
                  placeholder="e.g. 176" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Self-Upload Charges (USD)">
                <input type="number" step="0.01" min="0" className={INP}
                  value={form.other_charges_self_upload} onChange={setN('other_charges_self_upload')} />
              </Field>
              <Field label="Airline Upload Charges (USD)">
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
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!canSave}>
                {saving && <Spinner size="sm" />}
                {modal.mode === 'add' ? 'Add Airline' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Airline"
          message="This airline will be removed. Existing shipment records are kept."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  )
}
