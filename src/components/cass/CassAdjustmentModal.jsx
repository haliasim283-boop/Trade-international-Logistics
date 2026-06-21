import { useState } from 'react'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'

const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

function Field({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
        {hint && <span className="text-gray-400 font-normal ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

export function CassAdjustmentModal({ periodId, existing, onClose, onSaved }) {
  const [form, setForm] = useState({
    description: existing?.description ?? '',
    amount: existing?.amount != null ? String(existing.amount) : '',
  })
  const [saving, setSaving] = useState(false)

  function setF(k) { return (e) => setForm((p) => ({ ...p, [k]: e.target.value })) }

  async function handleSave() {
    if (!form.description.trim() || form.amount === '') return
    setSaving(true)
    const payload = {
      cass_period_id: periodId,
      description: form.description.trim(),
      amount: parseFloat(form.amount),
    }
    const { error } = existing
      ? await supabase.from('cass_adjustments').update(payload).eq('id', existing.id)
      : await supabase.from('cass_adjustments').insert(payload)
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  const canSave = !saving && form.description.trim() && form.amount !== '' && !isNaN(parseFloat(form.amount))

  return (
    <Modal title={existing ? 'Edit Adjustment' : 'Add Adjustment'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Description" required>
          <input className={INP} value={form.description} onChange={setF('description')}
            placeholder="e.g. Credit from previous period, BTA correction…" />
        </Field>
        <Field label="Amount (PKR)" required hint="negative for credit">
          <input type="number" step="0.01" className={INP}
            value={form.amount} onChange={setF('amount')} placeholder="e.g. -5000.00 or 2500.00" />
        </Field>
        <p className="text-xs text-gray-400">
          Positive amounts add to the Grand Total. Negative amounts are credits that reduce it.
        </p>
        <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Spinner size="sm" />}
            {existing ? 'Save Changes' : 'Add Adjustment'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
