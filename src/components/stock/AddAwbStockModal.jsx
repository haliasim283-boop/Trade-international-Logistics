import { useState, useMemo } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

const INP = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'
const MAX_RANGE = 500

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function generateRange(startStr, endStr, stepStr) {
  const start = parseInt(startStr, 10)
  const end   = parseInt(endStr, 10)
  const step  = parseInt(stepStr, 10) || 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || step < 1) return []
  const width = startStr.trim().length
  const out = []
  for (let n = start; n <= end && out.length <= MAX_RANGE; n += step) {
    out.push(String(n).padStart(width, '0'))
  }
  return out
}

function parseManualList(text) {
  return [...new Set(
    text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
  )]
}

export function AddAwbStockModal({ airlines, defaultAirlineId, existingKeys, onSave, onClose, saving }) {
  const [tab, setTab] = useState('range') // 'range' | 'manual'
  const [airlineId, setAirlineId] = useState(defaultAirlineId ?? airlines[0]?.id ?? '')
  const [prefix, setPrefix] = useState(() => airlines.find((a) => a.id === defaultAirlineId)?.current_awb_prefix ?? '')
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd]     = useState('')
  const [rangeStep, setRangeStep]   = useState('1')
  const [manualText, setManualText] = useState('')

  function onAirlineChange(id) {
    setAirlineId(id)
    const a = airlines.find((x) => x.id === id)
    setPrefix(a?.current_awb_prefix ?? '')
  }

  const serials = useMemo(() => {
    return tab === 'range' ? generateRange(rangeStart, rangeEnd, rangeStep) : parseManualList(manualText)
  }, [tab, rangeStart, rangeEnd, rangeStep, manualText])

  const rangeTooLarge = tab === 'range' &&
    Number.isFinite(parseInt(rangeStart, 10)) && Number.isFinite(parseInt(rangeEnd, 10)) &&
    parseInt(rangeEnd, 10) >= parseInt(rangeStart, 10) &&
    (parseInt(rangeEnd, 10) - parseInt(rangeStart, 10)) / (parseInt(rangeStep, 10) || 1) + 1 > MAX_RANGE

  const cleanPrefix = prefix.trim()
  const duplicates = useMemo(() => {
    if (!cleanPrefix) return 0
    return serials.filter((s) => existingKeys.has(`${airlineId}|${cleanPrefix}|${s}`)).length
  }, [serials, existingKeys, airlineId, cleanPrefix])

  const newCount = serials.length - duplicates
  const canSave = !saving && airlineId && cleanPrefix && serials.length > 0 && newCount > 0

  function handleSave() {
    const rows = serials
      .filter((s) => !existingKeys.has(`${airlineId}|${cleanPrefix}|${s}`))
      .map((s) => ({
        airline_id: airlineId,
        prefix: cleanPrefix,
        awb_serial: s,
        received_date: receivedDate || null,
        notes: notes.trim() || null,
      }))
    onSave(rows)
  }

  return (
    <Modal title="Add AWB Numbers" onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Airline" required>
            <select className={INP} value={airlineId} onChange={(e) => onAirlineChange(e.target.value)}>
              {airlines.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.iata_prefix})</option>)}
            </select>
          </Field>
          <Field label="Prefix" required hint="e.g. 157-9678 — stays the same across a batch">
            <input className={INP} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="157-9678" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date Received">
            <input type="date" className={INP} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className={INP} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>

        <div className="border-b border-gray-200 flex gap-4">
          {[['range', 'Generate Range'], ['manual', 'Paste List']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'range' ? (
          <div className="grid grid-cols-3 gap-4">
            <Field label="Start Serial" required>
              <input className={`${INP} font-mono`} value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} placeholder="4714" />
            </Field>
            <Field label="End Serial" required>
              <input className={`${INP} font-mono`} value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} placeholder="4806" />
            </Field>
            <Field label="Step">
              <input type="number" min="1" className={`${INP} font-mono`} value={rangeStep} onChange={(e) => setRangeStep(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="AWB Serials" required hint="One per line, or comma-separated">
            <textarea className={`${INP} font-mono`} rows={6} value={manualText} onChange={(e) => setManualText(e.target.value)}
              placeholder={'4714\n4725\n4736'} />
          </Field>
        )}

        {rangeTooLarge ? (
          <p className="text-sm text-danger">Range too large — max {MAX_RANGE} numbers at once.</p>
        ) : serials.length > 0 && (
          <p className="text-sm text-gray-500">
            {serials.length} number{serials.length !== 1 ? 's' : ''} parsed
            {duplicates > 0 && <span className="text-amber-600"> · {duplicates} already in stock (skipped)</span>}
            {' · '}<span className="font-medium text-gray-700">{Math.max(newCount, 0)} will be added</span>
          </p>
        )}

        <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Spinner size="sm" />}
            Add {newCount > 0 ? newCount : ''} AWB{newCount === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
