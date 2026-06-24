import { useState } from 'react'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'

const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'
const SEL = INP + ' appearance-none'

export const CATEGORIES = [
  'Airline Payments (CASS)',
  'Form E Supplier Payments',
  'Clearing Agent Payments',
  'Salaries',
  'Rent',
  'Utilities',
  'Office / Stationery',
  'IATA / CASS Fees',
  'Bank Charges',
  'Miscellaneous',
]

export const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'RAAST']

const BANKS = ['Sindh Bank', 'HMB', 'HBL', 'BOK', 'Askari', 'Meezan', 'Soneri', 'Bank Al Habib', 'Other']

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
  expense_date: today(), category: CATEGORIES[3],
  payee: '', amount: '', payment_method: 'Bank Transfer',
  bank_account: 'Sindh Bank', transaction_id: '', description: '', receipt_number: '',
}

function fromRow(r) {
  return {
    expense_date: r.expense_date, category: r.category,
    payee: r.payee ?? '', amount: String(r.amount),
    payment_method: r.payment_method, bank_account: r.bank_account ?? 'Sindh Bank',
    transaction_id: r.transaction_id ?? '', description: r.description ?? '',
    receipt_number: r.receipt_number ?? '',
  }
}

export function ExpenseFormModal({ existing, onClose, onSaved }) {
  const [form, setForm]   = useState(existing ? fromRow(existing) : EMPTY)
  const [saving, setSaving] = useState(false)

  function setF(k) { return (e) => setForm((p) => ({ ...p, [k]: e.target.value })) }

  async function handleSave() {
    if (!form.expense_date || !form.category || !form.amount || !form.payment_method) return
    setSaving(true)
    const payload = {
      expense_date:   form.expense_date,
      category:       form.category,
      payee:          form.payee.trim() || null,
      amount:         parseFloat(form.amount),
      payment_method: form.payment_method,
      bank_account:   form.payment_method === 'Cash' ? null : (form.bank_account || null),
      transaction_id: form.transaction_id.trim() || null,
      description:    form.description.trim() || null,
      receipt_number: form.receipt_number.trim() || null,
      updated_at:     new Date().toISOString(),
    }
    const { error } = existing
      ? await supabase.from('expenses').update(payload).eq('id', existing.id)
      : await supabase.from('expenses').insert(payload)
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  const canSave = !saving && form.expense_date && form.category && parseFloat(form.amount) > 0 && form.payment_method
  const needsBank = form.payment_method !== 'Cash'

  return (
    <Modal title={existing ? 'Edit Expense' : 'Add Expense'} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" required>
            <input type="date" name="expense_date" className={INP} value={form.expense_date} onChange={setF('expense_date')} />
          </Field>
          <Field label="Amount (PKR)" required>
            <input type="number" name="amount" step="0.01" min="0" className={INP}
              value={form.amount} onChange={setF('amount')} placeholder="0.00" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Category" required>
            <select name="category" className={SEL} value={form.category} onChange={setF('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Payee">
            <input name="payee" className={INP} value={form.payee} onChange={setF('payee')}
              placeholder="e.g. PIA, Haider Ali, Utility Company…" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Payment Method" required>
            <select name="payment_method" className={SEL} value={form.payment_method} onChange={setF('payment_method')}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          {needsBank ? (
            <Field label="Bank Account">
              <select name="bank_account" className={SEL} value={form.bank_account} onChange={setF('bank_account')}>
                {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
          ) : (
            <div /> /* empty column for cash */
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={form.payment_method === 'Cheque' ? 'Cheque No.' : 'Transaction ID / Ref'}>
            <input name="transaction_id" className={INP} value={form.transaction_id} onChange={setF('transaction_id')}
              placeholder={form.payment_method === 'Cheque' ? 'CHQ-XXXX' : 'TRX-XXXX'} />
          </Field>
          <Field label="Receipt No.">
            <input name="receipt_number" className={INP} value={form.receipt_number} onChange={setF('receipt_number')}
              placeholder="Optional receipt number" />
          </Field>
        </div>

        <Field label="Description / Notes">
          <textarea name="description" className={INP} rows={2} value={form.description} onChange={setF('description')}
            placeholder="Optional description…" />
        </Field>

        <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Spinner size="sm" />}
            {existing ? 'Save Changes' : 'Add Expense'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
