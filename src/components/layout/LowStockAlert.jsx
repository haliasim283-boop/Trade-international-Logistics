import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { buildShipmentAwbMap, classifyStockRow } from '../../lib/awbStock'

const LOW_STOCK_THRESHOLD = 5
const POLL_MS = 120_000

function playAlertSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    ;[880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = now + i * 0.18
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.18)
    })
    setTimeout(() => ctx.close(), 600)
  } catch {
    // Autoplay blocked or unsupported — the banner still shows.
  }
}

export function LowStockAlert() {
  const navigate = useNavigate()
  const [lowAirlines, setLowAirlines] = useState([])
  const [dismissedKey, setDismissedKey] = useState('')
  const notifiedRef = useRef(new Set())

  const check = useCallback(async () => {
    if (!supabase) return
    const [airlinesRes, stockRes, shipmentsRes] = await Promise.all([
      supabase.from('airlines').select('id, name').eq('is_active', true),
      supabase.from('awb_stock').select('airline_id, prefix, awb_serial'),
      supabase.from('shipments').select('awb_number, status'),
    ])
    if (airlinesRes.error || stockRes.error || shipmentsRes.error) return

    const shipmentByAwb = buildShipmentAwbMap(shipmentsRes.data ?? [])
    const counts = new Map()
    for (const row of stockRes.data ?? []) {
      const c = counts.get(row.airline_id) ?? { total: 0, available: 0 }
      c.total += 1
      if (classifyStockRow(row, shipmentByAwb) === 'available') c.available += 1
      counts.set(row.airline_id, c)
    }

    const low = (airlinesRes.data ?? [])
      .map((a) => ({ ...a, ...(counts.get(a.id) ?? { total: 0, available: 0 }) }))
      .filter((a) => a.total > 0 && a.available <= LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.available - b.available)

    setLowAirlines(low)

    const newlyLow = low.filter((a) => !notifiedRef.current.has(a.id))
    if (newlyLow.length > 0) playAlertSound()

    const lowIds = new Set(low.map((a) => a.id))
    notifiedRef.current = new Set([...lowIds])
  }, [])

  useEffect(() => {
    check()
    const id = setInterval(check, POLL_MS)
    return () => clearInterval(id)
  }, [check])

  const currentKey = lowAirlines.map((a) => `${a.id}:${a.available}`).join(',')
  if (lowAirlines.length === 0 || dismissedKey === currentKey) return null

  return (
    <div className="sticky top-14 z-10 bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5 flex items-center gap-3 text-sm">
      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
      <div className="flex-1 text-amber-800 min-w-0 truncate">
        <span className="font-medium">Low AWB stock — </span>
        {lowAirlines.map((a, i) => (
          <span key={a.id}>
            {i > 0 && ', '}
            {a.name} ({a.available} left)
          </span>
        ))}
      </div>
      <button
        onClick={() => navigate('/stock')}
        className="text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2 flex-shrink-0"
      >
        View Stock
      </button>
      <button
        onClick={() => setDismissedKey(currentKey)}
        className="text-amber-500 hover:text-amber-700 p-1 flex-shrink-0"
        title="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
