import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Truck } from 'lucide-react'
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
  name: '', city: '', origin_code: '',
  per_shipment_charge: 0, contact: '', notes: '', is_in_house: false,
}

export function ClearingAgentsTab() {
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
      .from('clearing_agents').select('*').eq('is_active', true).order('city')
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd()   { setForm(EMPTY); setModal({ mode: 'add' }) }
  function openEdit(r) {
    setForm({
      name: r.name, city: r.city, origin_code: r.origin_code,
      per_shipment_charge: r.per_shipment_charge,
      contact: r.contact ?? '', notes: r.notes ?? '',
      is_in_house: r.is_in_house,
    })
    setModal({ mode: 'edit', row: r })
  }

  function setF(key) { return (e) => setForm((p) => ({ ...p, [key]: e.target.value })) }

  async function handleSave() {
    if (!form.name.trim() || !form.city.trim() || !form.origin_code.trim()) return
    setSaving(true)
    const payload = {
      ...form,
      origin_code: form.origin_code.toUpperCase().trim(),
      per_shipment_charge: parseFloat(form.per_shipment_charge) || 0,
      updated_at: new Date().toISOString(),
    }
    const { error } = modal.mode === 'add'
      ? await supabase.from('clearing_agents').insert(payload)
      : await supabase.from('clearing_agents').update(payload).eq('id', modal.row.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    setModal(null); load()
  }

  async function handleDelete() {
    await supabase.from('clearing_agents').update({ is_active: false }).eq('id', deleteId)
    setDeleteId(null); load()
  }

  const canSave = !saving && form.name.trim() && form.city.trim() && form.origin_code.trim()

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error)   return <div className="py-8 text-center text-danger text-sm">{error}</div>

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{rows.length} agent{rows.length !== 1 ? 's' : ''}</p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" />Add Agent</Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-base font-medium">No clearing agents yet</p>
          <p className="text-sm mt-1">Click "Add Agent" to create your first clearing agent.</p>
        </div>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Agent Name</Th><Th>City</Th><Th>IATA Code</Th>
              <Th className="text-right">Charge / Shipment</Th>
              <Th>Contact</Th><Th>Type</Th><Th>Actions</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td><span className="font-medium text-gray-900">{r.name}</span></Td>
                <Td>{r.city}</Td>
                <Td>
                  <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs tracking-wider">
                    {r.origin_code}
                  </span>
                </Td>
                <Td className="font-mono text-right text-gray-700">PKR {num(r.per_shipment_charge)}</Td>
                <Td>{r.contact || '—'}</Td>
                <Td>
                  {r.is_in_house
                    ? <span className="px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-medium">In-House</span>
                    : <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">Outsourced</span>
                  }
                </Td>
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
                    <button title="View Payables Report" onClick={() => navigate('/clearing', { state: { agentId: r.id } })}
                      className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-accent transition-colors">
                      <Truck className="w-4 h-4" />
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Clearing Agent' : 'Edit Clearing Agent'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Agent / Company Name" required>
              <input className={INP} value={form.name} onChange={setF('name')}
                placeholder="e.g. In-House (Peshawar)" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="City" required>
                <input className={INP} value={form.city} onChange={setF('city')}
                  placeholder="e.g. Peshawar" />
              </Field>
              <Field label="IATA Origin Code" required>
                <input className={INP} value={form.origin_code} maxLength={3}
                  onChange={(e) => setForm((p) => ({ ...p, origin_code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. PEW" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Per-Shipment Charge (PKR)">
                <input type="number" step="0.01" min="0" className={INP}
                  value={form.per_shipment_charge}
                  onChange={(e) => setForm((p) => ({ ...p, per_shipment_charge: e.target.value }))} />
              </Field>
              <Field label="Contact">
                <input className={INP} value={form.contact} onChange={setF('contact')} />
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="is_in_house"
                type="checkbox"
                checked={form.is_in_house}
                onChange={(e) => setForm((p) => ({ ...p, is_in_house: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-accent accent-navy"
              />
              <label htmlFor="is_in_house" className="text-sm text-gray-700 cursor-pointer">
                In-house clearing (does not appear in clearing agent payables)
              </label>
            </div>
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
          title="Delete Clearing Agent"
          message="This agent will be removed. Existing shipment records are kept."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  )
}
