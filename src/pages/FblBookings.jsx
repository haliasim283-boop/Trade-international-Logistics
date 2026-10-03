import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlarmClock, Bell, BellRing, Ban, Clock3, FileSpreadsheet, RefreshCw, Trash2, Undo2, Upload, UserRoundCheck, Volume2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { readCargoSpotFile } from '../lib/fblBookings'
import { enableFblAlarmSound } from '../components/layout/FblAlarmMonitor'

const LEAD_HOURS = [73, 74]

function flightDateTime(flightDate, flightTime) {
  const time = String(flightTime || '00:00').slice(0, 5)
  return new Date(`${flightDate}T${time}:00+05:00`)
}

function alertAtFor(flightDate, flightTime, leadHours) {
  const flightAt = flightDateTime(flightDate, flightTime)
  return new Date(flightAt.getTime() - (Number(leadHours) + 5) * 60 * 60 * 1000).toISOString()
}

function formatPakistanDate(date, time = '00:00') {
  if (!date) return '—'
  const value = flightDateTime(date, time)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(value)
}

function formatTimestamp(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function permissionLabel() {
  if (!('Notification' in window)) return 'Browser notifications unavailable'
  if (Notification.permission === 'granted') return 'Browser alerts enabled'
  if (Notification.permission === 'denied') return 'Browser alerts blocked'
  return 'Enable browser alerts'
}

export default function FblBookings() {
  const { role } = useAuth()
  const canWrite = ['Admin', 'Manager', 'Data Entry'].includes(role)
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('open')
  const [showImport, setShowImport] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [leadHours, setLeadHours] = useState(73)
  const [parsing, setParsing] = useState(false)
  const [uploading, setUploading] = useState(false)

  const loadBookings = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured. Add the project environment variables to use booking alarms.')
      setLoading(false)
      return
    }
    try {
      const { data, error: queryError } = await supabase
        .from('pia_booking_plans')
        .select('*')
        .order('flight_date', { ascending: true })
        .limit(1000)
      if (queryError) setError(queryError.message)
      else {
        setError('')
        setBookings(data ?? [])
      }
    } catch (queryError) {
      setError(queryError.message || 'Could not load PIA booking alarms.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadBookings() }, [loadBookings])

  const visibleBookings = useMemo(() => {
    if (filter === 'open') return bookings.filter((row) => row.resolution_status === 'open')
    if (filter === 'resolved') return bookings.filter((row) => row.resolution_status !== 'open')
    return bookings
  }, [bookings, filter])

  const now = Date.now()
  const dueCount = bookings.filter((row) => row.resolution_status === 'open' &&
    row.booking_status.toLowerCase().includes('confirm') && new Date(row.alert_at).getTime() <= now &&
    (!row.snoozed_until || new Date(row.snoozed_until).getTime() <= now)).length

  async function chooseFiles(fileList) {
    const file = fileList?.[0]
    if (!file) return
    setParsing(true)
    setParsed(null)
    setError('')
    setNotice('')
    setFileName(file.name)
    try {
      setParsed(await readCargoSpotFile(file))
    } catch (err) {
      setParsed(null)
      setError(err.message || 'Could not read this file. Please select a valid CargoSpot .xlsx or .csv planning file.')
    }
    setParsing(false)
  }

  async function importBookings() {
    if (!parsed?.bookings.length || !supabase) return
    setUploading(true)
    setError('')
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      const now = new Date().toISOString()
      const rows = parsed.bookings.map((booking) => ({
        ...booking,
        lead_hours: leadHours,
        alert_at: alertAtFor(booking.flight_date, booking.flight_time, leadHours),
        updated_at: now,
        ...(authData.user?.id ? { created_by: authData.user.id } : {}),
      }))
      const { error: saveError } = await supabase
        .from('pia_booking_plans')
        .upsert(rows, { onConflict: 'awb_number,flight_date' })
      if (saveError) throw saveError
      setNotice(`Imported ${rows.length} booking${rows.length === 1 ? '' : 's'}. Existing AWB/date rows were refreshed.`)
      setParsed(null)
      setFileName('')
      setShowImport(false)
      await loadBookings()
    } catch (saveError) {
      setError(saveError.message || 'Could not import these bookings. Please retry.')
    } finally {
      setUploading(false)
    }
  }

  async function updateBooking(row, changes) {
    if (!supabase) return
    const next = { ...row, ...changes }
    const update = { ...changes, updated_at: new Date().toISOString() }
    if (changes.flight_time !== undefined || changes.lead_hours !== undefined) {
      update.alert_at = alertAtFor(next.flight_date, next.flight_time, next.lead_hours)
      update.snoozed_until = null
    }
    const { error: updateError } = await supabase.from('pia_booking_plans').update(update).eq('id', row.id)
    if (updateError) setError(updateError.message)
    else {
      setError('')
      await loadBookings()
    }
  }

  async function deleteBooking(row) {
    if (!window.confirm(`Remove booking ${row.awb_number} from the alarm list?`)) return
    const { error: deleteError } = await supabase.from('pia_booking_plans').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message)
    else await loadBookings()
  }

  async function enableBrowserAlerts() {
    if (!('Notification' in window)) return
    const permission = await Notification.requestPermission()
    setNotice(permission === 'granted' ? 'Browser alerts enabled on this device.' : 'Browser notification permission was not granted.')
  }

  const unresolvedCount = bookings.filter((row) => row.resolution_status === 'open').length
  const canEnableAlerts = 'Notification' in window && Notification.permission !== 'granted'

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-navy">
            <AlarmClock className="h-5 w-5 text-accent" />
            <h1 className="text-xl font-semibold">PIA Booking Alarms</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">Track confirmed CargoSpot bookings before their FBL removal cutoff.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => {
            const enabled = enableFblAlarmSound()
            setNotice(enabled ? 'Alarm sound enabled for this browser session.' : 'This browser does not support alarm sound.')
          }} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Volume2 className="h-4 w-4" /> Enable alarm sound
          </button>
          {canEnableAlerts && (
            <button onClick={enableBrowserAlerts} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Bell className="h-4 w-4" /> {permissionLabel()}
            </button>
          )}
          {!canEnableAlerts && 'Notification' in window && Notification.permission === 'granted' && (
            <span className="inline-flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <BellRing className="h-4 w-4" /> Browser alerts enabled
            </span>
          )}
          <button onClick={() => setShowImport((value) => !value)} disabled={!canWrite} className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">
            <Upload className="h-4 w-4" /> Upload planning
          </button>
          <button onClick={loadBookings} className="rounded-md border border-gray-300 bg-white p-2 text-gray-600 hover:bg-gray-50" title="Refresh bookings" aria-label="Refresh bookings">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div className={`rounded-md border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-800'}`}>
          {error || notice}
        </div>
      )}

      {showImport && (
        <section className="border-y border-gray-200 bg-white py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-gray-900">Import CargoSpot planning</h2>
              <p className="mt-1 max-w-3xl text-sm text-gray-500">Upload a CargoSpot planning spreadsheet (.xlsx or .csv). The table columns will be parsed and displayed for review before import.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              FBL cutoff
              <select value={leadHours} onChange={(event) => setLeadHours(Number(event.target.value))} className="rounded-md border border-gray-300 bg-white px-2 py-1.5">
                {LEAD_HOURS.map((hours) => <option key={hours} value={hours}>{hours} hours before flight</option>)}
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-gray-500">Alarm is scheduled 5 hours before the cutoff. Dates and times use Pakistan time. When no flight time is in the file, 00:00 is assumed so you can adjust it below.</p>
          <label className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-600 hover:bg-gray-100">
            <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
            <span>{parsing ? 'Reading planning file…' : fileName || 'Choose CargoSpot file (.xlsx or .csv)'}</span>
            <input type="file" accept=".xlsx,.csv,.xls" className="sr-only" disabled={parsing} onChange={(event) => chooseFiles(event.target.files)} />
          </label>
          <p className="mt-2 text-xs text-gray-500">File is processed in your browser; booking rows are saved to Supabase when you click Import.</p>
          {parsed && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
              <div className="text-sm text-gray-700">
                <strong>{parsed.bookings.length}</strong> ready to import
                {parsed.skipped.length > 0 && <span className="ml-2 text-amber-700">{parsed.skipped.length} row(s) need review</span>}
                {parsed.bookings.length > 0 && <p className="mt-1 text-xs text-gray-500">First booking: {parsed.bookings[0].awb_number} · {parsed.bookings[0].origin}-{parsed.bookings[0].destination} · {parsed.bookings[0].flight_date}</p>}
              </div>
              <button onClick={importBookings} disabled={uploading || parsed.bookings.length === 0} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">
                {uploading ? 'Importing…' : 'Import bookings'}
              </button>
            </div>
          )}
          {parsed?.skipped.length > 0 && (
            <div className="mt-3 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">Check these CargoSpot rows</p>
              <ul className="mt-1 space-y-1">
                {parsed.skipped.map((row, index) => (
                  <li key={`${row.rowNumber}-${index}`}>
                    Row {row.rowNumber}: {row.reason}
                    {row.flightDetails ? ` · ${row.flightDetails}` : ''}
                    {row.origin || row.destination ? ` · ${row.origin || '?'}-${row.destination || '?'}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {parsed?.bookings.length > 0 && (
            <div className="mt-4 max-h-72 overflow-auto border border-gray-200">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="sticky top-0 bg-gray-100 text-gray-600">
                  <tr><th className="px-3 py-2">AWB</th><th className="px-3 py-2">Flight date</th><th className="px-3 py-2">Route</th><th className="px-3 py-2">Flight details</th><th className="px-3 py-2">Pieces / weight</th><th className="px-3 py-2">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {parsed.bookings.map((booking) => (
                    <tr key={`${booking.awb_number}-${booking.flight_date}`}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">{booking.awb_number}</td>
                      <td className="whitespace-nowrap px-3 py-2">{booking.flight_date}</td>
                      <td className="whitespace-nowrap px-3 py-2">{booking.origin}-{booking.destination}</td>
                      <td className="px-3 py-2">{booking.flight_details || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{booking.pieces ?? '—'} / {booking.weight_kg ?? '—'} kg</td>
                      <td className="whitespace-nowrap px-3 py-2">{booking.booking_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="border-l-2 border-accent bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase text-gray-500">Open bookings</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{unresolvedCount}</p>
        </div>
        <div className="border-l-2 border-red-500 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase text-gray-500">Alarms due</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{dueCount}</p>
        </div>
        <div className="border-l-2 border-emerald-600 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase text-gray-500">Resolved</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{bookings.length - unresolvedCount}</p>
        </div>
      </section>

      <section className="border-y border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="flex gap-1" role="tablist" aria-label="Booking filter">
            {[['open', 'Open'], ['all', 'All'], ['resolved', 'Resolved']].map(([value, label]) => (
              <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`rounded px-3 py-1.5 text-sm ${filter === value ? 'bg-navy text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500">Alarms require a CargoSpot status containing “Confirmed”.</p>
        </div>

        {loading ? <div className="px-4 py-12 text-center text-sm text-gray-500">Loading bookings…</div> : visibleBookings.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Clock3 className="mx-auto h-6 w-6 text-gray-400" />
            <p className="mt-2 text-sm font-medium text-gray-800">No {filter === 'open' ? 'open ' : ''}bookings to show</p>
            <p className="mt-1 text-sm text-gray-500">Upload a CargoSpot planning file to create FBL alarms.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">AWB / status</th><th className="px-4 py-3">Flight</th><th className="px-4 py-3">CargoSpot details</th><th className="px-4 py-3">Cutoff</th><th className="px-4 py-3">Alarm time</th><th className="px-4 py-3">Resolution</th><th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleBookings.map((row) => {
                  const alarmEligible = row.booking_status.toLowerCase().includes('confirm')
                  return (
                    <tr key={row.id} className="align-top hover:bg-gray-50/70">
                      <td className="px-4 py-3">
                        <p className="font-mono font-medium text-gray-900">{row.awb_number}</p>
                        <p className={`mt-1 text-xs ${alarmEligible ? 'text-emerald-700' : 'text-amber-700'}`}>{row.booking_status || 'Status unknown'}</p>
                        <p className="mt-1 text-xs text-gray-500">{row.origin} → {row.destination}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="whitespace-nowrap">{formatPakistanDate(row.flight_date, row.flight_time).split(', ').slice(0, 2).join(', ')}</p>
                        {canWrite ? (
                          <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="sr-only">Pakistan flight time</span>
                            <input type="time" value={row.flight_time?.slice(0, 5) || '00:00'} onChange={(event) => updateBooking(row, { flight_time: event.target.value })} className="rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-700" /> PKT
                          </label>
                        ) : <p className="mt-1 text-xs text-gray-500">{row.flight_time?.slice(0, 5)} PKT</p>}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-gray-600">
                        <p>{row.flight_details || '—'}</p>
                        <p className="mt-1">{[row.nature_of_goods, row.price_class].filter(Boolean).join(' · ') || '—'}</p>
                        <p className="mt-1">{row.pieces ?? '—'} pcs · {row.weight_kg ?? '—'} kg · {row.volume ?? '—'} m³</p>
                      </td>
                      <td className="px-4 py-3">
                        {canWrite ? <select value={row.lead_hours} onChange={(event) => updateBooking(row, { lead_hours: Number(event.target.value) })} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
                          {LEAD_HOURS.map((hours) => <option key={hours} value={hours}>{hours}h before flight</option>)}
                        </select> : <span>{row.lead_hours}h before flight</span>}
                        <p className="mt-1 whitespace-nowrap text-xs text-gray-500">{formatTimestamp(new Date(flightDateTime(row.flight_date, row.flight_time).getTime() - row.lead_hours * 3600000).toISOString())} PKT</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-medium text-gray-800">{formatTimestamp(row.alert_at)} PKT</p>
                        {row.snoozed_until && <p className="mt-1 text-xs text-amber-700">Snoozed until {formatTimestamp(row.snoozed_until)} PKT</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${row.resolution_status === 'open' ? 'bg-amber-50 text-amber-800' : row.resolution_status === 'cancelled' ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-800'}`}>
                          {row.resolution_status === 'open' ? 'Needs client' : row.resolution_status === 'cancelled' ? 'Cancelled' : 'Client confirmed'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.resolution_status === 'open' && canWrite ? <div className="flex flex-col items-start gap-1.5">
                          <button onClick={() => updateBooking(row, { resolution_status: 'client_confirmed', snoozed_until: null })} className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 hover:text-green-900"><UserRoundCheck className="h-4 w-4" /> Client confirmed</button>
                          <button onClick={() => updateBooking(row, { resolution_status: 'cancelled', snoozed_until: null })} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"><Ban className="h-4 w-4" /> Cancelled</button>
                          <button onClick={() => deleteBooking(row)} className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-800"><Trash2 className="h-4 w-4" /> Remove</button>
                        </div> : row.resolution_status !== 'open' && canWrite ? (
                          <button onClick={() => updateBooking(row, { resolution_status: 'open', snoozed_until: null })} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
                            <Undo2 className="h-4 w-4" /> Undo resolution
                          </button>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-gray-500">The alarm runs while this app is open. Browser alerts require permission; alarms cannot ring after the browser is closed.</p>
    </div>
  )
}