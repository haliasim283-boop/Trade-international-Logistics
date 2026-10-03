import { useCallback, useEffect, useRef, useState } from 'react'
import { AlarmClock, Ban, BellRing, Clock3, UserRoundCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const POLL_MS = 30_000
let alarmAudioContext

export function enableFblAlarmSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return false
  if (!alarmAudioContext) alarmAudioContext = new AudioContextClass()
  alarmAudioContext.resume()
  return true
}

function ringAlarm() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return
  if (!alarmAudioContext) alarmAudioContext = new AudioContextClass()
  const context = alarmAudioContext
  const start = context.currentTime
  ;[0, 0.32, 0.72].forEach((offset, index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = index === 1 ? 660 : 880
    gain.gain.setValueAtTime(0.0001, start + offset)
    gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.24)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start + offset)
    oscillator.stop(start + offset + 0.25)
  })
}

function formatFlight(row) {
  const time = String(row.flight_time || '00:00').slice(0, 5)
  const flightAt = new Date(`${row.flight_date}T${time}:00+05:00`)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(flightAt)
}

export function FblAlarmMonitor() {
  const navigate = useNavigate()
  const [alarms, setAlarms] = useState([])
  const checkedNotificationKeys = useRef(new Set())

  const checkAlarms = useCallback(async () => {
    if (!supabase) return
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('pia_booking_plans')
      .select('id, awb_number, origin, destination, flight_date, flight_time, alert_at, snoozed_until')
      .eq('resolution_status', 'open')
      .ilike('booking_status', '%confirm%')
      .lte('alert_at', now)
      .or(`snoozed_until.is.null,snoozed_until.lte.${now}`)
      .order('alert_at', { ascending: true })
      .limit(20)
    if (error) return
    const due = data ?? []
    setAlarms(due)

    if ('Notification' in window && Notification.permission === 'granted') {
      due.forEach((row) => {
        const key = `${row.id}:${row.alert_at}:${row.snoozed_until || ''}`
        if (checkedNotificationKeys.current.has(key)) return
        checkedNotificationKeys.current.add(key)
        try {
          const notification = new Notification('PIA booking needs attention', {
            body: `${row.awb_number} · ${row.origin}-${row.destination}. FBL cutoff is approaching.`,
            tag: `pia-booking-${row.id}`,
            requireInteraction: true,
          })
          notification.onclick = () => {
            window.focus()
            navigate('/fbl-bookings')
            notification.close()
          }
        } catch {
          // The in-app alarm remains available if desktop notifications fail.
        }
      })
    }
  }, [navigate])

  useEffect(() => {
    checkAlarms()
    const interval = window.setInterval(checkAlarms, POLL_MS)
    const onFocus = () => checkAlarms()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [checkAlarms])

  useEffect(() => {
    if (!alarms.length) return undefined
    ringAlarm()
    const interval = window.setInterval(ringAlarm, 2200)
    return () => window.clearInterval(interval)
  }, [alarms.length])

  async function updateAlarm(row, changes) {
    if (!supabase) return
    const { error } = await supabase.from('pia_booking_plans').update({
      ...changes,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (!error) await checkAlarms()
  }

  if (!alarms.length) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-950/65 p-4" role="alertdialog" aria-modal="true" aria-labelledby="fbl-alarm-title">
      <section className="w-full max-w-xl border-t-4 border-red-600 bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
          <div className="rounded-full bg-red-50 p-2 text-red-700"><BellRing className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 id="fbl-alarm-title" className="text-lg font-semibold text-gray-900">FBL removal deadline alarm</h2>
            <p className="mt-1 text-sm text-gray-600">These confirmed bookings still need a client or cancellation.</p>
          </div>
        </header>
        <div className="max-h-[55vh] divide-y divide-gray-100 overflow-y-auto">
          {alarms.map((row) => (
            <article key={row.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-base font-semibold text-gray-900">{row.awb_number}</p>
                  <p className="mt-1 text-sm text-gray-600">{row.origin} → {row.destination}</p>
                </div>
                <p className="inline-flex items-center gap-1.5 text-xs text-gray-500"><AlarmClock className="h-4 w-4" /> Flight {formatFlight(row)} PKT</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => updateAlarm(row, { resolution_status: 'client_confirmed', snoozed_until: null })} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800">
                  <UserRoundCheck className="h-4 w-4" /> Client confirmed
                </button>
                <button onClick={() => updateAlarm(row, { resolution_status: 'cancelled', snoozed_until: null })} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <Ban className="h-4 w-4" /> Cancelled
                </button>
                {[5, 15, 30].map((minutes) => (
                  <button key={minutes} onClick={() => updateAlarm(row, { snoozed_until: new Date(Date.now() + minutes * 60_000).toISOString() })} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <Clock3 className="h-4 w-4" /> {minutes} min
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
        <footer className="flex justify-end border-t border-gray-200 px-5 py-3">
          <button onClick={() => navigate('/fbl-bookings')} className="text-sm font-medium text-accent hover:underline">Open booking alarms</button>
        </footer>
      </section>
    </div>
  )
}