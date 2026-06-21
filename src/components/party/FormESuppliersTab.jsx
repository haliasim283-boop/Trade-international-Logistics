import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, FileText } from 'lucide-react'
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

const EMPTY = {
  name: '', contact_person: '', phone: '',
  default_pkr_rate: 13.00, payment_terms: '', notes: '',
}

export function FormESuppliersTab() {
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
      .from('form_e_suppliers').select('*').eq('is_active', true).order('name')
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd()   { setForm(EMPTY); setModal({ mode: 'add' }) }
  function openEdit(r) {
    setForm({
      name: r.name, contact_person: r.contact_person ?? '',
      phone: r.phone ?? '', default_pkr_rate: r.default_pkr_rate,
      payment_terms: r.payment_terms ?? '', notes: r.notes ?? '',
    })
    setModal({ mode: 'edit', row: r })
  }

  function setF(key) { return (e) => setForm((p) => ({ ...p, [key]: e.target.value })) }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      ...form,
      default_pkr_rate: parseFloat(form.default_pkr_rate) || 0,
      updated_at: new Date().toISOString(),
    }
    const { error } = modal.mode === 'add'
      ? await supabase.from('form_e_suppliers').insert(payload)
      : await supabase.from('form_e_suppliers').update(payload).eq('id', modal.row.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    setModal(null); load()
  }

  async function handleDelete() {
    await supabase.from('form_e_suppliers').update({ is_active: false }).eq('id', deleteId)
    setDeleteId(null); load()
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error)   return <div className="py-8 text-center text-danger text-sm">{error}</div>

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{rows.length} supplier{rows.length !== 1 ? 's' : ''}</p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" />Add Supplier</Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-base font-medium">No Form E suppliers yet</p>
          <p className="text-sm mt-1">Click "Add Supplier" to create your first supplier.</p>
        </div>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Supplier Name</Th><Th>Contact Person</Th><Th>Phone</Th>
              <Th className="text-right">Default PKR Rate / USD</Th>
              <Th>Payment Terms</Th><Th>Actions</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td><span className="font-medium text-gray-900">{r.name}</span></Td>
                <Td>{r.contact_person || '—'}</Td>
                <Td>{r.phone || '—'}</Td>
                <Td className="font-mono text-right text-gray-700">
                  PKR {Number(r.default_pkr_rate).toFixed(2)}
                </Td>
                <Td>{r.payment_terms || '—'}</Td>
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
                    <button title="View Payables Report" onClick={() => navigate('/form-e', { state: { supplierId: r.id } })}
                      className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-accent transition-colors">
                      <FileText className="w-4 h-4" />
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Form E Supplier' : 'Edit Form E Supplier'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Supplier Name" required>
              <input className={INP} value={form.name} onChange={setF('name')}
                placeholder="e.g. Supplier A" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact Person">
                <input className={INP} value={form.contact_person} onChange={setF('contact_person')} />
              </Field>
              <Field label="Phone">
                <input className={INP} value={form.phone} onChange={setF('phone')} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Default PKR Rate per USD">
                <input type="number" step="0.01" min="0" className={INP}
                  value={form.default_pkr_rate}
                  onChange={(e) => setForm((p) => ({ ...p, default_pkr_rate: e.target.value }))} />
              </Field>
              <Field label="Payment Terms">
                <input className={INP} value={form.payment_terms} onChange={setF('payment_terms')}
                  placeholder="e.g. Net 30" />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={INP} rows={2} value={form.notes} onChange={setF('notes')} />
            </Field>
            <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving && <Spinner size="sm" />}
                {modal.mode === 'add' ? 'Add Supplier' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Supplier"
          message="This Form E supplier will be removed. Existing shipment records are kept."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  )
}
