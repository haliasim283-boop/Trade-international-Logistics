import { useState, useCallback } from 'react'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { PaymentImageUpload } from '../ui/PaymentImageUpload'
import { uploadPaymentImage } from '../../lib/uploadPaymentImage'
import { supabase } from '../../lib/supabase'

const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'
const BANKS = ['Sindh Bank','HMB','HBL','BOK','Askari','Meezan','Soneri','Bank Al Habib','Other']

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

export function CassPaymentModal({ periodId, airlineId, existing, onClose, onSaved }) {
  const isEdit = !!existing
  const [form, setForm] = useState({
    payment_date:   existing?.payment_date   ?? today(),
    amount:         existing?.amount?.toString() ?? '',
    bank_account:   existing?.bank_account   ?? 'Sindh Bank',
    transaction_id: existing?.transaction_id ?? '',
    notes:          existing?.notes          ?? '',
  })
  const [imageFile,        setImageFile]        = useState(null)
  const [imagePreview,     setImagePreview]     = useState(null)
  const [existingReceiptUrl, setExistingReceiptUrl] = useState(existing?.receipt_url ?? null)
  const [saving,           setSaving]           = useState(false)

  function setF(k) { return (e) => setForm((p) => ({ ...p, [k]: e.target.value })) }

  const handleImageChange = useCallback((file) => {
    setImageFile(file)
    setImagePreview(file ? URL.createObjectURL(file) : null)
  }, [])

  const handleImageClear = useCallback(() => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(null); setImagePreview(null)
  }, [imagePreview])

  async function handleSave() {
    if (!form.payment_date || !form.amount) return
    setSaving(true)
    try {
      const receipt_url = imageFile
        ? await uploadPaymentImage(imageFile)
        : (existingReceiptUrl ?? null)

      const payload = {
        payment_date:   form.payment_date,
        amount:         parseFloat(form.amount),
        bank_account:   form.bank_account   || null,
        transaction_id: form.transaction_id || null,
        notes:          form.notes          || null,
        receipt_url,
      }

      const { error } = isEdit
        ? await supabase.from('cass_payments').update(payload).eq('id', existing.id)
        : await supabase.from('cass_payments').insert({ ...payload, cass_period_id: periodId, airline_id: airlineId })

      if (error) { alert(error.message); return }
      onSaved()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const canSave = !saving && form.payment_date && parseFloat(form.amount) > 0

  return (
    <Modal title={isEdit ? 'Edit CASS Payment' : 'Record CASS Payment'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Payment Date" required>
            <input type="date" className={INP} value={form.payment_date} onChange={setF('payment_date')} />
          </Field>
          <Field label="Amount (PKR)" required>
            <input type="number" step="0.01" min="0" className={INP}
              value={form.amount} onChange={setF('amount')} placeholder="0.00" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Bank / Account">
            <select className={INP} value={form.bank_account} onChange={setF('bank_account')}>
              {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Transaction ID / Reference">
            <input className={INP} value={form.transaction_id} onChange={setF('transaction_id')} placeholder="TRX-XXXX" />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className={INP} rows={2} value={form.notes} onChange={setF('notes')} placeholder="Optional notes…" />
        </Field>
        <PaymentImageUpload
          file={imageFile} previewUrl={imagePreview} existingUrl={existingReceiptUrl}
          onChange={handleImageChange} onClear={handleImageClear}
          onClearExisting={() => setExistingReceiptUrl(null)}
        />
        <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Spinner size="sm" />}
            {saving ? (imageFile ? 'Uploading…' : 'Saving…') : (isEdit ? 'Update Payment' : 'Record Payment')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
