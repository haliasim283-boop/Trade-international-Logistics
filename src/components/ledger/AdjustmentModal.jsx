import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

function today() { return new Date().toISOString().slice(0, 10) }

const COPY = {
  credit: {
    addTitle:    'Add Credit (Additional Charge)',
    editTitle:   'Edit Credit',
    amountLabel: 'Credit Amount (PKR) *',
    help:        "Adds to what the client owes, on top of shipment charges — e.g. a manual fee, or a transfer that should be recorded against this account.",
    descPlaceholder: 'e.g. Credit Transfer From WAQAS EJAZ Statement',
    addLabel:    'Add Credit',
    updateLabel: 'Update Credit',
    variant:     'primary',
  },
  debit: {
    addTitle:    'Add Debit (Deduction)',
    editTitle:   'Edit Debit',
    amountLabel: 'Debit Amount (PKR) *',
    help:        "Deducts from the client's balance — e.g. goods bought from the client (honey, etc.) that offset what they owe.",
    descPlaceholder: 'e.g. Honey purchase — 20kg',
    addLabel:    'Add Debit',
    updateLabel: 'Update Debit',
    variant:     'danger',
  },
}

// existing: full adjustment row from DB (for edit mode), or null for add mode
export function AdjustmentModal({ clientId, type, existing, onSave, onUpdate, onClose, saving }) {
  const isEdit = !!existing
  const copy = COPY[type]

  const [form, setForm] = useState({
    entry_date:  existing?.entry_date  ?? today(),
    amount:      existing?.amount?.toString() ?? '',
    description: existing?.description ?? '',
    notes:       existing?.notes ?? '',
  })

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.amount || Number(form.amount) <= 0) { alert('Amount must be greater than zero'); return }
    if (!form.description.trim()) { alert('Description is required'); return }

    const payload = {
      entry_date:  form.entry_date,
      amount:      Number(form.amount),
      description: form.description.trim(),
      notes:       form.notes.trim() || null,
    }

    if (isEdit) onUpdate({ id: existing.id, ...payload })
    else onSave({ client_id: clientId, type, ...payload })
  }

  const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white'
  const LBL = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <Modal title={isEdit ? copy.editTitle : copy.addTitle} onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-gray-500">{copy.help}</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={LBL}>Date *</label>
            <input type="date" className={INP} value={form.entry_date} onChange={set('entry_date')} required />
          </div>
          <div>
            <label className={LBL}>{copy.amountLabel}</label>
            <input type="number" step="0.01" min="0.01" className={INP}
              value={form.amount} onChange={set('amount')} required placeholder="0.00" />
          </div>
        </div>
        <div>
          <label className={LBL}>Description (shown in ledger statement) *</label>
          <input className={INP} value={form.description} onChange={set('description')}
            placeholder={copy.descPlaceholder} required />
        </div>
        <div>
          <label className={LBL}>Notes (internal only)</label>
          <input className={INP} value={form.notes} onChange={set('notes')} placeholder="Optional" />
        </div>
        <div className="flex gap-3 justify-end pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={copy.variant} disabled={saving}>
            {saving && <Spinner size="sm" />}
            {saving ? 'Saving…' : (isEdit ? copy.updateLabel : copy.addLabel)}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
