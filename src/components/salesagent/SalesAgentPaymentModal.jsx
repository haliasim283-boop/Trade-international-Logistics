import { useState } from 'react'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'

const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

const BANKS = ['Sindh Bank','HMB','HBL','BOK','Askari','Meezan','Soneri','Bank Al Habib','Cash','Other']

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

export function SalesAgentPaymentModal({ agentId, periodStart, periodEnd, onClose, onSaved }) {
  const [form, setForm] = useState({
    payment_date:   today(),
    amount:         '',
    bank_account:   'Sindh Bank',
    transaction_id: '',
    notes:          '',
  })
  const [saving, setSaving] = useState(false)

  function setF(k) { return (e) => setForm((p) => ({ ...p, [k]: e.target.value })) }

  async function handleSave() {
    if (!form.payment_date || !form.amount) return
    setSaving(true)
    const { error } = await supabase.from('sales_agent_payments').insert({
      agent_id:       agentId,
      payment_date:   form.payment_date,
      amount:         parseFloat(form.amount),
      period_start:   periodStart ?? null,
      period_end:     periodEnd   ?? null,
      bank_account:   form.bank_account   || null,
      transaction_id: form.transaction_id || null,
      notes:          form.notes          || null,
    })
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  const canSave = !saving && form.payment_date && parseFloat(form.amount) > 0

  return (
    <Modal title="Record Payment to Sales Agent" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Payment Date" required>
            <input type="date" name="payment_date" className={INP}
              value={form.payment_date} onChange={setF('payment_date')} />
          </Field>
          <Field label="Amount (PKR)" required>
            <input type="number" name="amount" step="0.01" min="0" className={INP}
              value={form.amount} onChange={setF('amount')} placeholder="0.00" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Bank / Method">
            <select name="bank_account" className={INP}
              value={form.bank_account} onChange={setF('bank_account')}>
              {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Transaction ID / Reference">
            <input name="transaction_id" className={INP}
              value={form.transaction_id} onChange={setF('transaction_id')}
              placeholder="TRX-XXXX" />
          </Field>
        </div>
        <Field label="Notes">
          <textarea name="notes" className={INP} rows={2}
            value={form.notes} onChange={setF('notes')}
            placeholder="Optional notes…" />
        </Field>
        <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Spinner size="sm" />}
            Record Payment
          </Button>
        </div>
      </div>
    </Modal>
  )
}
