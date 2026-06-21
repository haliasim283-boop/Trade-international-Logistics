import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

// ── Constants ─────────────────────────────────────────────────────────────────

const BANKS   = ['Sindh Bank', 'Bank Al Habib', 'HMB', 'HBL', 'BOK', 'Askari', 'Meezan', 'Soneri', 'Other']
const METHODS = ['Bank Transfer', 'RAAST', 'Cheque', 'Cash', 'Foreign Remittance']

function today() { return new Date().toISOString().slice(0, 10) }

const BLANK = {
  payment_date:   today(),
  amount:         '',
  payment_method: 'Bank Transfer',
  bank_account:   'Sindh Bank',
  transaction_id: '',
  description:    '',
  notes:          '',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PaymentModal({ clientId, onSave, onClose, saving }) {
  const [form,       setForm]       = useState(BLANK)
  const [descEdited, setDescEdited] = useState(false)

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  // Auto-generate description unless user has manually edited it
  useEffect(() => {
    if (descEdited) return
    const parts = ['AMOUNT RECEIVED']
    if (form.bank_account && form.bank_account !== 'Other') {
      parts.push(form.bank_account.toUpperCase() + ' BANK')
    }
    if (form.transaction_id) parts.push(`TRX ID ${form.transaction_id}`)
    setForm((f) => ({ ...f, description: parts.join(' ') }))
  }, [form.bank_account, form.transaction_id, descEdited])

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.amount || Number(form.amount) <= 0) { alert('Amount must be greater than zero'); return }
    onSave({
      client_id:      clientId,
      payment_date:   form.payment_date,
      amount:         Number(form.amount),
      payment_method: form.payment_method,
      bank_account:   form.bank_account || null,
      transaction_id: form.transaction_id.trim() || null,
      description:    form.description.trim() || null,
      notes:          form.notes.trim() || null,
    })
  }

  const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white'
  const LBL = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <Modal title="Record Payment Received" onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Date + Amount */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={LBL}>Payment Date *</label>
            <input type="date" className={INP} value={form.payment_date} onChange={set('payment_date')} required />
          </div>
          <div>
            <label className={LBL}>Amount Received (PKR) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className={INP}
              value={form.amount}
              onChange={set('amount')}
              required
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Method + Bank */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={LBL}>Payment Method</label>
            <select className={INP} value={form.payment_method} onChange={set('payment_method')}>
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className={LBL}>Received Into (Trade's Bank)</label>
            <select className={INP} value={form.bank_account} onChange={set('bank_account')}>
              {BANKS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
        </div>

        {/* TRX ID */}
        <div>
          <label className={LBL}>Transaction ID / Cheque No.</label>
          <input className={INP} value={form.transaction_id} onChange={set('transaction_id')} placeholder="e.g. 115354" />
        </div>

        {/* Description */}
        <div>
          <label className={LBL}>Description (shown in ledger statement)</label>
          <input
            className={INP}
            value={form.description}
            onChange={(e) => { setDescEdited(true); set('description')(e) }}
            placeholder="AMOUNT RECEIVED SINDH BANK TRX ID ..."
          />
          {!descEdited && (
            <p className="text-xs text-gray-400 mt-1">Auto-generated from bank + TRX — edit to customise</p>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className={LBL}>Notes (internal only)</label>
          <input className={INP} value={form.notes} onChange={set('notes')} placeholder="Optional" />
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="success" disabled={saving}>
            {saving && <Spinner size="sm" />}
            Record Payment
          </Button>
        </div>
      </form>
    </Modal>
  )
}
