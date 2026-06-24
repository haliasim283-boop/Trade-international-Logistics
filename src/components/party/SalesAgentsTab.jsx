import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
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

const EMPTY = { name: '', contact: '', notes: '' }

export function SalesAgentsTab() {
  const [rows,     setRows]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [modal,    setModal]    = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [form,     setForm]     = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('Supabase not configured'); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('sales_agents').select('*').eq('is_active', true).order('name')
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd()   { setForm(EMPTY); setModal({ mode: 'add' }) }
  function openEdit(r) {
    setForm({
      name:    r.name,
      contact: r.contact ?? '',
      notes:   r.notes   ?? '',
    })
    setModal({ mode: 'edit', row: r })
  }

  function setF(key) { return (e) => setForm((p) => ({ ...p, [key]: e.target.value })) }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      name:       form.name.trim(),
      contact:    form.contact.trim() || null,
      notes:      form.notes.trim()   || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = modal.mode === 'add'
      ? await supabase.from('sales_agents').insert(payload)
      : await supabase.from('sales_agents').update(payload).eq('id', modal.row.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    setModal(null); load()
  }

  async function handleDelete() {
    await supabase.from('sales_agents').update({ is_active: false }).eq('id', deleteId)
    setDeleteId(null); load()
  }

  const canSave = !saving && form.name.trim()

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error)   return <div className="py-8 text-center text-danger text-sm">{error}</div>

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{rows.length} agent{rows.length !== 1 ? 's' : ''}</p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" />Add Sales Agent</Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-base font-medium">No sales agents yet</p>
          <p className="text-sm mt-1">Click "Add Sales Agent" to get started.</p>
        </div>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Name</Th>
              <Th>Contact</Th>
              <Th>Actions</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td><span className="font-medium text-gray-900">{r.name}</span></Td>
                <Td>{r.contact || '—'}</Td>
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
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {modal && (
        <Modal
          title={modal.mode === 'add' ? 'Add Sales Agent' : 'Edit Sales Agent'}
          onClose={() => setModal(null)}
        >
          <div className="space-y-4">
            <Field label="Name" required>
              <input className={INP} value={form.name} onChange={setF('name')}
                placeholder="e.g. Ahmed Logistics" />
            </Field>
            <Field label="Contact">
              <input className={INP} value={form.contact} onChange={setF('contact')}
                placeholder="Phone or email" />
            </Field>
            <Field label="Notes">
              <textarea className={INP} rows={2} value={form.notes} onChange={setF('notes')} />
            </Field>
            <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!canSave}>
                {saving && <Spinner size="sm" />}
                {modal.mode === 'add' ? 'Add Agent' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Remove Sales Agent"
          message="This agent will be deactivated. Existing shipment records are kept."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  )
}
