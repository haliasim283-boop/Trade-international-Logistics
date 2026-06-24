import { useState } from 'react'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'

const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

const BANKS = ['Sindh Bank','HMB','HBL','BOK','Askari','Meezan','Soneri','Bank Al Habib','Cash','Other']

const SOURCES = [
  'Commission Earned (CASS)',
  'Other Charges Recovered',
  'Refund / Reversal',
  'Miscellaneous Income',
  'Other',
]

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

const today = () => new Date().toISOString().slice(0, 10)

const EMPTY = {
  income_date: today(), source: SOURCES[0],
  description: '', amount: '', bank_account: 'Sindh Bank', transaction_id: '',
}

function fromRow(r) {
  return {
    income_date: r.income_date, source: r.source,
    description: r.description ?? '', amount: String(r.amount),
    bank_account: r.bank_account ?? 'Sindh Bank', transaction_id: r.transaction_id ?? '',
  }
}

export function ManualIncomeModal({ existing, onClose, onSaved }) {
  const [form, setForm]     = useState(existing ? fromRow(existing) : EMPTY)
  const [saving, setSaving] = useState(false)

  function setF(k) { return (e) => setForm((p) => ({ ...p, [k]: e.target.value })) }

  async function handleSave() {
    if (!form.income_date || !form.source || !form.amount) return
    setSaving(true)
    const payload = {
      income_date:    form.income_date,
      source:         form.source.trim(),
      description:    form.description.trim() || null,
      amount:         parseFloat(form.amount),
      bank_account:   form.bank_account || null,
      transaction_id: form.transaction_id.trim() || null,
    }
    const { error } = existing
      ? await supabase.from('manual_income').update(payload).eq('id', existing.id)
      : await supabase.from('manual_income').insert(payload)
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  const canSave = !saving && form.income_date && form.source.trim() && parseFloat(form.amount) > 0

  return (
    <Modal title={existing ? 'Edit Income Entry' : 'Add Manual Income'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" required>
            <input type="date" name="income_date" className={INP} value={form.income_date} onChange={setF('income_date')} />
          </Field>
          <Field label="Amount (PKR)" required>
            <input type="number" name="amount" step="0.01" min="0" className={INP}
              value={form.amount} onChange={setF('amount')} placeholder="0.00" />
          </Field>
        </div>

        <Field label="Source" required>
          <input list="income-sources" name="source" className={INP} value={form.source} onChange={setF('source')}
            placeholder="e.g. Commission Earned (CASS)" />
          <datalist id="income-sources">
            {SOURCES.map((s) => <option key={s} value={s} />)}
          </datalist>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Bank / Account">
            <select name="bank_account" className={INP + ' appearance-none'} value={form.bank_account} onChange={setF('bank_account')}>
              {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Transaction ID / Ref">
            <input name="transaction_id" className={INP} value={form.transaction_id} onChange={setF('transaction_id')}
              placeholder="TRX-XXXX" />
          </Field>
        </div>

        <Field label="Description">
          <textarea name="description" className={INP} rows={2} value={form.description} onChange={setF('description')}
            placeholder="Optional notes…" />
        </Field>

        <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Spinner size="sm" />}
            {existing ? 'Save Changes' : 'Add Income'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
