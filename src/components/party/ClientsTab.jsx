import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, BookOpen, Upload, CheckCircle2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
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
  name: '', contact_person: '', phone: '', city: '',
  address: '', credit_terms_days: 30, notes: '',
}

export function ClientsTab() {
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [modal, setModal]     = useState(null)   // { mode: 'add'|'edit', row? }
  const [deleteId, setDeleteId] = useState(null)
  const [form, setForm]       = useState(EMPTY)
  const [saving, setSaving]   = useState(false)

  // Excel import state
  const fileRef             = useRef(null)
  const [importModal, setImportModal] = useState(null)
  // importModal shape: { headers: string[], rows: string[][], colIdx: number, selected: Set<string> }

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('Supabase not configured'); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('clients').select('*').eq('is_active', true).order('name')
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd()    { setForm(EMPTY); setModal({ mode: 'add' }) }
  function openEdit(r)  {
    setForm({
      name: r.name, contact_person: r.contact_person ?? '',
      phone: r.phone ?? '', city: r.city ?? '',
      address: r.address ?? '', credit_terms_days: r.credit_terms_days ?? 30,
      notes: r.notes ?? '',
    })
    setModal({ mode: 'edit', row: r })
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = { ...form, updated_at: new Date().toISOString() }
    const { error } = modal.mode === 'add'
      ? await supabase.from('clients').insert(payload)
      : await supabase.from('clients').update(payload).eq('id', modal.row.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    setModal(null)
    load()
  }

  async function handleDelete() {
    await supabase.from('clients').update({ is_active: false }).eq('id', deleteId)
    setDeleteId(null)
    load()
  }

  // ── Excel import ──────────────────────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (!data || data.length < 2) { alert('No data found in the file.'); return }

      const headers = (data[0] ?? []).map(String)
      const dataRows = data.slice(1).filter((r) => r.some((c) => String(c).trim()))

      // Auto-pick column: first column whose header contains "name" or "party"
      const autoIdx = headers.findIndex((h) =>
        /name|party|client/i.test(h)
      )
      const colIdx = autoIdx >= 0 ? autoIdx : 0

      // Build unique non-empty name list from that column
      const existing = new Set(rows.map((r) => r.name.trim().toLowerCase()))
      const names = [...new Set(
        dataRows
          .map((r) => String(r[colIdx] ?? '').trim())
          .filter((n) => n.length > 0)
      )]

      const selected = new Set(
        names.filter((n) => !existing.has(n.toLowerCase()))
      )

      setImportModal({ headers, rows: dataRows, colIdx, names, selected })
    }
    reader.readAsArrayBuffer(file)
  }

  function changeImportCol(idx) {
    if (!importModal) return
    const existing = new Set(rows.map((r) => r.name.trim().toLowerCase()))
    const names = [...new Set(
      importModal.rows
        .map((r) => String(r[idx] ?? '').trim())
        .filter((n) => n.length > 0)
    )]
    const selected = new Set(
      names.filter((n) => !existing.has(n.toLowerCase()))
    )
    setImportModal((p) => ({ ...p, colIdx: idx, names, selected }))
  }

  function toggleName(name) {
    setImportModal((p) => {
      const s = new Set(p.selected)
      s.has(name) ? s.delete(name) : s.add(name)
      return { ...p, selected: s }
    })
  }

  async function handleImport() {
    if (!importModal || importModal.selected.size === 0) return
    setSaving(true)
    const payload = [...importModal.selected].map((name) => ({
      name,
      credit_terms_days: 30,
      is_active: true,
    }))
    const { error: e } = await supabase.from('clients').insert(payload)
    setSaving(false)
    if (e) { alert(e.message); return }
    setImportModal(null)
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error)   return <div className="py-8 text-center text-danger text-sm">{error}</div>

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{rows.length} client{rows.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" /> Import Excel
          </Button>
          <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" />Add Client</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-base font-medium">No clients yet</p>
          <p className="text-sm mt-1">Click "Add Client" to create your first client.</p>
        </div>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Client Name</Th><Th>Contact Person</Th><Th>Phone</Th>
              <Th>City</Th><Th>Credit Terms</Th><Th>Actions</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td><span className="font-medium text-gray-900">{r.name}</span></Td>
                <Td>{r.contact_person || '—'}</Td>
                <Td>{r.phone || '—'}</Td>
                <Td>{r.city || '—'}</Td>
                <Td>{r.credit_terms_days} days</Td>
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
                    <button title="View Ledger" onClick={() => navigate('/ledgers', { state: { clientId: r.id } })}
                      className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-accent transition-colors">
                      <BookOpen className="w-4 h-4" />
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Client' : 'Edit Client'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Client Name" required>
              <input className={INP} value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Waqas / Mudassir R&M" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact Person">
                <input className={INP} value={form.contact_person}
                  onChange={(e) => setForm((p) => ({ ...p, contact_person: e.target.value }))} />
              </Field>
              <Field label="Phone">
                <input className={INP} value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="City">
                <input className={INP} value={form.city}
                  onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
              </Field>
              <Field label="Credit Terms (days)">
                <input type="number" min="0" className={INP} value={form.credit_terms_days}
                  onChange={(e) => setForm((p) => ({ ...p, credit_terms_days: parseInt(e.target.value) || 0 }))} />
              </Field>
            </div>
            <Field label="Address">
              <input className={INP} value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
            </Field>
            <Field label="Notes">
              <textarea className={INP} rows={2} value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
            </Field>
            <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving && <Spinner size="sm" />}
                {modal.mode === 'add' ? 'Add Client' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Client"
          message="This client will be removed from the list. Existing shipments and ledger data are kept."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {importModal && (
        <Modal title="Import Clients from Excel" onClose={() => setImportModal(null)} size="xl">
          <div className="space-y-4">
            {/* Column picker */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Which column contains the client name?
              </label>
              <select
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={importModal.colIdx}
                onChange={(e) => changeImportCol(Number(e.target.value))}
              >
                {importModal.headers.map((h, i) => (
                  <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                ))}
              </select>
            </div>

            {/* Name list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-700">
                  Found {importModal.names.length} unique name{importModal.names.length !== 1 ? 's' : ''} —
                  {' '}<span className="text-accent font-semibold">{importModal.selected.size} selected</span> to import
                </p>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => setImportModal((p) => ({ ...p, selected: new Set(p.names) }))}
                    className="text-accent hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={() => setImportModal((p) => ({ ...p, selected: new Set() }))}
                    className="text-gray-500 hover:underline"
                  >
                    Deselect all
                  </button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-y-auto max-h-64 divide-y divide-gray-100">
                {importModal.names.map((name) => {
                  const alreadyExists = rows.some((r) => r.name.trim().toLowerCase() === name.toLowerCase())
                  const checked = importModal.selected.has(name)
                  return (
                    <label
                      key={name}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 ${alreadyExists ? 'opacity-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={alreadyExists}
                        onChange={() => toggleName(name)}
                        className="rounded border-gray-300 text-accent focus:ring-accent"
                      />
                      <span className="text-sm text-gray-800 flex-1">{name}</span>
                      {alreadyExists && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> already exists
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setImportModal(null)}>Cancel</Button>
              <Button onClick={handleImport} disabled={saving || importModal.selected.size === 0}>
                {saving && <Spinner size="sm" />}
                Import {importModal.selected.size} Client{importModal.selected.size !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
