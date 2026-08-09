import { escapeHtml as esc } from '../../lib/escapeHtml'

/* Poppins is bundled locally (not fetched from a CDN) so the PDF renders the
   same font every time, including offline. */
import poppins400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?url'
import poppins400i from '@fontsource/poppins/files/poppins-latin-400-italic.woff2?url'
import poppins500 from '@fontsource/poppins/files/poppins-latin-500-normal.woff2?url'
import poppins500i from '@fontsource/poppins/files/poppins-latin-500-italic.woff2?url'
import poppins600 from '@fontsource/poppins/files/poppins-latin-600-normal.woff2?url'
import poppins700 from '@fontsource/poppins/files/poppins-latin-700-normal.woff2?url'
import poppins800 from '@fontsource/poppins/files/poppins-latin-800-normal.woff2?url'

const POPPINS_FACES = [
  [400, 'normal', poppins400],
  [400, 'italic', poppins400i],
  [500, 'normal', poppins500],
  [500, 'italic', poppins500i],
  [600, 'normal', poppins600],
  [700, 'normal', poppins700],
  [800, 'normal', poppins800],
].map(([weight, style, url]) => `@font-face{font-family:'Poppins';font-style:${style};font-weight:${weight};font-display:block;src:url('${url}') format('woff2')}`).join('\n')

/* Every face the card actually uses, in the shape FontFaceSet.load() expects. */
const POPPINS_SPECS = [
  '400 16px Poppins', '500 16px Poppins', '600 16px Poppins',
  '700 16px Poppins', '800 16px Poppins',
  'italic 400 16px Poppins', 'italic 500 16px Poppins',
]

const POPPINS_STYLE_ID = 'til-booking-poppins'

/* html2canvas measures each word in one document but paints it onto a canvas
   owned by another, so BOTH need Poppins. If the painting document falls back
   to Segoe UI, glyphs land at coordinates measured from Poppins and the text
   collides ("17:00" -> "1700") or drifts apart ("Airport   Reporting"). */
async function ensurePoppins(doc, inject = true) {
  if (!doc) return
  if (inject && !doc.getElementById(POPPINS_STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = POPPINS_STYLE_ID
    style.textContent = POPPINS_FACES
    doc.head.appendChild(style)
  }
  if (!doc.fonts) return
  // font-display:block only kicks off a fetch once a face is used, so ask for
  // each one explicitly rather than trusting fonts.ready alone
  await Promise.all(POPPINS_SPECS.map((spec) => doc.fonts.load(spec).catch(() => {})))
  await doc.fonts.ready
}

/* ------------------------------------------------------------------
   AIRPORTS
   city    -> shown after the code:  "ISB — ISLAMABAD"
   country -> appended when present: "SHJ — SHARJAH, UAE"
   (domestic PK airports intentionally have no country)
------------------------------------------------------------------- */
const AIRPORTS = {
  PEW: { city: 'PESHAWAR' },
  ISB: { city: 'ISLAMABAD' },
  MUX: { city: 'MULTAN' },
  SKT: { city: 'SIALKOT' },
  LHE: { city: 'LAHORE' },
  KHI: { city: 'KARACHI' },

  DXB: { city: 'DUBAI', country: 'UAE' },
  SHJ: { city: 'SHARJAH', country: 'UAE' },
  AUH: { city: 'ABU DHABI', country: 'UAE' },
  RKT: { city: 'RAS AL KHAIMAH', country: 'UAE' },
  DOH: { city: 'DOHA', country: 'QATAR' },
  BAH: { city: 'BAHRAIN', country: 'BAHRAIN' },
  JED: { city: 'JEDDAH', country: 'SAUDI ARABIA' },
  RUH: { city: 'RIYADH', country: 'SAUDI ARABIA' },
  MCT: { city: 'MUSCAT', country: 'OMAN' },
  KWI: { city: 'KUWAIT', country: 'KUWAIT' },
  AAN: { city: 'ADEN', country: 'YEMEN' },
  MAN: { city: 'MANCHESTER', country: 'UK' },
  LHR: { city: 'LONDON', country: 'UK' },
  FRA: { city: 'FRANKFURT', country: 'GERMANY' },
  CDG: { city: 'PARIS', country: 'FRANCE' },
  AMS: { city: 'AMSTERDAM', country: 'NETHERLANDS' },
  YYZ: { city: 'TORONTO', country: 'CANADA' },
  JFK: { city: 'NEW YORK', country: 'USA' },
  ORD: { city: 'CHICAGO', country: 'USA' },
  BKK: { city: 'BANGKOK', country: 'THAILAND' },
  KUL: { city: 'KUALA LUMPUR', country: 'MALAYSIA' },
  SIN: { city: 'SINGAPORE', country: 'SINGAPORE' },
  PVG: { city: 'SHANGHAI', country: 'CHINA' },
  CAN: { city: 'GUANGZHOU', country: 'CHINA' },
  PEK: { city: 'BEIJING', country: 'CHINA' },
  HKG: { city: 'HONG KONG', country: 'HONG KONG' },
  BOM: { city: 'MUMBAI', country: 'INDIA' },
  DEL: { city: 'NEW DELHI', country: 'INDIA' },
  MAA: { city: 'CHENNAI', country: 'INDIA' },
  HYD: { city: 'HYDERABAD', country: 'INDIA' },
}

/** "ISB — ISLAMABAD"  /  "SHJ — SHARJAH, UAE" */
function airportLine(code) {
  if (!code) return '—'
  const upper = String(code).trim().toUpperCase()
  const a = AIRPORTS[upper]
  if (!a) return upper
  return `${upper} — ${a.country ? `${a.city}, ${a.country}` : a.city}`
}

export const BOOKING_LOGO_URL = new URL('../../../assets/favicon.png', import.meta.url).href

/* Aircraft artwork for the card hero — inlined as a data URI so the PDF
   renderer never has to fetch an external file. */
const AIRCRAFT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="280" viewBox="0 0 660 280">
  <defs>
    <linearGradient id="fus" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2c4a75"/><stop offset="1" stop-color="#152b47"/>
    </linearGradient>
  </defs>
  <path d="M92 168 L36 74 L86 74 L150 152 Z" fill="#152b47"/>
  <path d="M96 168 L44 128 L84 128 L124 164 Z" fill="#1e3a5f"/>
  <path d="M330 178 L214 258 L272 258 L398 186 Z" fill="#152b47"/>
  <path d="M344 168 L250 96 L296 96 L404 160 Z" fill="#2c4a75"/>
  <path d="M614 154 C614 138 588 128 548 126 L140 138 C104 140 84 148 84 158
           C84 170 104 180 140 182 L548 184 C588 182 614 170 614 154 Z" fill="url(#fus)"/>
  <path d="M566 134 C592 138 610 145 614 154 C610 163 592 170 566 174 Z" fill="#1f8fa8" opacity=".85"/>
  <rect x="286" y="176" width="86" height="30" rx="15" fill="#35c7d6" opacity=".9"/>
  <rect x="296" y="182" width="66" height="18" rx="9" fill="#0f2437"/>
  <g fill="#dfe9f3">
    <path d="M572 143 L596 148 L596 156 L572 160 Z" opacity=".9"/>
    <rect x="180" y="152" width="13" height="9" rx="2.5"/>
    <rect x="212" y="151" width="13" height="9" rx="2.5"/>
    <rect x="244" y="150" width="13" height="9" rx="2.5"/>
    <rect x="276" y="149" width="13" height="9" rx="2.5"/>
    <rect x="308" y="148" width="13" height="9" rx="2.5"/>
    <rect x="340" y="147" width="13" height="9" rx="2.5"/>
    <rect x="372" y="147" width="13" height="9" rx="2.5"/>
    <rect x="404" y="146" width="13" height="9" rx="2.5"/>
    <rect x="436" y="145" width="13" height="9" rx="2.5"/>
    <rect x="468" y="144" width="13" height="9" rx="2.5"/>
    <rect x="500" y="143" width="13" height="9" rx="2.5"/>
  </g>
  <ellipse cx="330" cy="268" rx="210" ry="7" fill="#132033" opacity=".10"/>
</svg>`

export const AIRCRAFT_IMAGE_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AIRCRAFT_SVG)}`

/* ------------------------------------------------------------------
   AIRLINE ARTWORK
   Every image in assets/airlines is picked up automatically — drop a
   new file in and it becomes available under its own file name.
   `airplanebg.png` is the fallback for airlines with no picture yet.
------------------------------------------------------------------- */
const AIRLINE_IMAGE_MODULES = import.meta.glob(
  '../../../assets/airlines/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}',
  { eager: true, query: '?url', import: 'default' },
)

/** { pia: '/assets/pia-a1b2.png', emirates: '…' } */
const AIRLINE_IMAGES = Object.entries(AIRLINE_IMAGE_MODULES).reduce((acc, [path, url]) => {
  const key = path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase()
  acc[key] = url
  return acc
}, {})

/** Extra names that should resolve to an existing file. */
const AIRLINE_ALIASES = {
  pakistaninternationalairlines: 'pia',
  pakistaninternational: 'pia',
  piapakistaninternationalairlines: 'pia',
  qatarairways: 'qatar',
  saudia: 'saudiairlines',
  saudiarabianairlines: 'saudiairlines',
  saudi: 'saudiairlines',
  flydubaiairlines: 'flydubai',
  airarabiaabudhabi: 'airarabia',
  jinnah: 'flyjinnah',
  sial: 'airsial',
  dhlaviation: 'dhl',
  dhlexpress: 'dhl',
  nas: 'flynas',
  salam: 'salamair',
  omanair: 'salamair',
}

function normalizeAirline(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Picture for this shipment's airline, falling back to the generic artwork. */
export function airlineImageUrl(shipment) {
  const key = normalizeAirline(shipment?.airlines?.name ?? shipment?.airline_name)
  if (key) {
    const direct = AIRLINE_IMAGES[key] || AIRLINE_IMAGES[AIRLINE_ALIASES[key]]
    if (direct) return direct
    // "Emirates SkyCargo" -> matches "emirates". Only for names long enough
    // that a substring hit is meaningful ("pia" would match "ethiopian").
    const partial = Object.keys(AIRLINE_IMAGES).find(
      (k) => k !== 'airplanebg' && k.length >= 5 && (key.includes(k) || k.includes(key)),
    )
    if (partial) return AIRLINE_IMAGES[partial]
  }
  return AIRLINE_IMAGES.airplanebg || AIRCRAFT_IMAGE_URL
}

/* ---------------- date ---------------- */
function ordinalSuffix(day) {
  if (!day) return ''
  const padded = String(day).padStart(2, '0')      // 8 -> "08TH"
  const tens = day % 100
  if (tens >= 11 && tens <= 13) return `${padded}TH`
  switch (day % 10) {
    case 1: return `${padded}ST`
    case 2: return `${padded}ND`
    case 3: return `${padded}RD`
    default: return `${padded}TH`
  }
}

/** "08TH AUGUST 2026 SATURDAY" */
function formatFullDateWithDay(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dayName = date.toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase()
  const monthName = date.toLocaleDateString('en-GB', { month: 'long' }).toUpperCase()
  return `${ordinalSuffix(d)} ${monthName} ${y} ${dayName}`
}

/* ---------------- time ---------------- */
function parseTime12(time, period) {
  if (!time) return null
  const match = String(time).trim().match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (!match) return null
  let hour = parseInt(match[1], 10)
  const minute = parseInt(match[2] || '0', 10)
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null
  if (period === 'PM' && hour !== 12) hour += 12
  if (period === 'AM' && hour === 12) hour = 0
  return { hour, minute }
}

function minutesToTime(mins) {
  const m = ((mins % 1440) + 1440) % 1440
  return { hour: Math.floor(m / 60), minute: m % 60 }
}

/** "13:10" */
function to24(t) {
  if (!t) return '—'
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}

/** "1PM" / "1:10PM"  (compact, no space — matches the WhatsApp card) */
function to12Compact(t) {
  if (!t) return '—'
  const period = t.hour >= 12 ? 'PM' : 'AM'
  const h12 = t.hour % 12 || 12
  const min = t.minute === 0 ? '' : `:${String(t.minute).padStart(2, '0')}`
  return `${h12}${min}${period}`
}

/** "5:00 AM"  (spaced, always shows minutes) */
function to12Spaced(t) {
  if (!t) return '—'
  const period = t.hour >= 12 ? 'PM' : 'AM'
  const h12 = t.hour % 12 || 12
  return `${h12}:${String(t.minute).padStart(2, '0')} ${period}`
}

function dayPart(t) {
  if (!t) return ''
  if (t.hour < 12) return 'MORNING'
  if (t.hour < 17) return 'AFTERNOON'
  if (t.hour < 21) return 'EVENING'
  return 'NIGHT'
}

/** Airport reporting = departure minus N hours (default 8). */
const REPORTING_LEAD_HOURS = 8
function reportingFrom(departure) {
  if (!departure) return null
  return minutesToTime(departure.hour * 60 + departure.minute - REPORTING_LEAD_HOURS * 60)
}

/* ---------------- commodity ---------------- */
/** Selectable commodities and the emoji shown to the left of the cargo line. */
export const COMMODITY_OPTIONS = [
  { value: 'FRESH MEAT',            emoji: '🥩' },
  { value: 'FRUITS AND VEGETABLES', emoji: '🍎' },
  { value: 'FRESH VEGETABLES',      emoji: '🥦' },
  { value: 'HONEY',                 emoji: '🍯' },
  { value: 'PLANTS',                emoji: '🌿' },
  { value: 'PINE NUTS',             emoji: '🥜' },
  { value: 'FRESH MANGO',           emoji: '🥭' },
]

const COMMODITY_EMOJI = COMMODITY_OPTIONS.reduce((acc, o) => {
  acc[o.value] = o.emoji
  return acc
}, {})

export function commodityEmoji(commodity) {
  if (!commodity) return '🥩'
  return COMMODITY_EMOJI[String(commodity).trim().toUpperCase()] || '📦'
}

/** "2,000 KGS FRESH MEAT" */
function cargoLine(shipment, details = {}) {
  const kgs = Number(shipment?.chargeable_weight || 0)
  const weight = `${kgs.toLocaleString('en-US', { maximumFractionDigits: 0 })} KGS`
  const commodity = details.commodity || shipment?.commodity || ''
  return commodity ? `${weight} ${commodity}` : weight
}

/* A continuous rule — underscores render as a broken/half line in WhatsApp. */
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━'

/* ==================================================================
   WHATSAPP MESSAGE
================================================================== */
export function buildBookingMessage(shipment, client, details = {}) {
  const shipper = (client?.name || 'Customer').toUpperCase()
  const flight = details.flightNumber || '—'

  const departure = parseTime12(details.departureTime, details.departurePeriod)
  const arrival = parseTime12(details.arrivalTime, details.arrivalPeriod)
  const reporting = parseTime12(details.reportingTime, details.reportingPeriod) || reportingFrom(departure)

  const departureLabel = departure
    ? `${to24(departure)} (${to12Compact(departure)}) ${dayPart(departure)}`.trim()
    : '—'
  const arrivalLabel = arrival ? `${to24(arrival)} (${to12Compact(arrival)})` : '—'

  return [
    '✈️ FLIGHT CONFIRMATION ALERT',
    DIVIDER,
    'IATA: TRADE INTERNATIONAL LOGISTICS',
    'CASS: 27-3-0688',
    DIVIDER,
    `📦 SHIPPER: ${shipper}`,
    `✈️ AWB: ${shipment?.awb_number ?? '—'}`,
    `🛫 FLIGHT: ${flight}`,
    `📅 DATE: ${formatFullDateWithDay(shipment?.flight_date)}`,
    DIVIDER,
    `📍 ${airportLine(shipment?.origin)}`,
    `🚚 Reporting: ${to12Spaced(reporting)}`,
    `🛫 Departure: ${departureLabel}`,
    `📍 ${airportLine(shipment?.destination)}`,
    `🛬 Arrival: ${arrivalLabel}`,
    `${commodityEmoji(details.commodity || shipment?.commodity)} Cargo: ${cargoLine(shipment, details)}`,
    '✅ Booking Status: CONFIRMED',
  ].join('\n')
}

/* ==================================================================
   AIRWAY BILL CARD  (HTML → PDF)
================================================================== */

/** "Peshawar" */
function cityTitle(code) {
  const a = AIRPORTS[String(code ?? '').trim().toUpperCase()]
  if (!a) return String(code ?? '').trim().toUpperCase()
  return a.city.charAt(0) + a.city.slice(1).toLowerCase()
}

/** "Abu Dhabi (AUH), UAE" */
function placeLine(code) {
  const upper = String(code ?? '').trim().toUpperCase()
  if (!upper) return '—'
  const a = AIRPORTS[upper]
  if (!a) return upper
  return a.country ? `${cityTitle(upper)} (${upper}), ${a.country}` : `${cityTitle(upper)} (${upper})`
}

/** "PEW-AUH (Peshawar ➞ Abu Dhabi)" */
function routeLine(shipment) {
  const o = String(shipment?.origin ?? '').trim().toUpperCase()
  const d = String(shipment?.destination ?? '').trim().toUpperCase()
  if (!o && !d) return '—'
  return `${o}-${d} (${cityTitle(o)} &#10142; ${cityTitle(d)})`
}

export function buildBookingHTML(shipment, client, details = {}, logoUrl = BOOKING_LOGO_URL) {
  const heroUrl = airlineImageUrl(shipment)
  const departure = parseTime12(details.departureTime, details.departurePeriod)
  const arrival = parseTime12(details.arrivalTime, details.arrivalPeriod)
  const reporting = parseTime12(details.reportingTime, details.reportingPeriod) || reportingFrom(departure)

  const stops = [
    { t: reporting, ico: '&#128666;', label: 'Reporting' },
    { t: departure, ico: '&#9992;', label: 'Departure' },
    { t: arrival, ico: '&#128748;', label: 'Arrival' },
  ]

  const timeline = stops.map((s) => `
          <div class="tl-item">
            <span class="dot"></span>
            <span class="t">${to24(s.t)}</span><span class="l">(${to12Spaced(s.t)})</span>
          </div>`).join('')

  const events = stops.map((s) => `
          <div class="event">
            <span class="ico">${s.ico}</span>
            <b>${to24(s.t)}</b> <span>(${to12Spaced(s.t)}) &ndash; ${esc(s.label)}</span>
          </div>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Airway Bill — ${esc(shipment?.awb_number ?? '')}</title>
<style>
${POPPINS_FACES}
:root{
  --navy:#1e3a5f;
  --navy-dark:#152b47;
  --navy-mid:#2c4a75;
  --accent:#1f8fa8;
  --ink:#132033;
  --ink-soft:#4a5a6e;
  --panel:#eef2f6;
  --panel-2:#f8fafc;
  --line:#c9d4e0;
  --line-strong:#8fa5bd;
  --bezel:#3a3a3a;
  --shadow:0 18px 45px rgba(0,0,0,.35);
  --radius:14px;
  --font:"Poppins", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--font);
  background:#d8d4c8;
  display:flex;justify-content:center;align-items:flex-start;
  padding:20px 18px;
  color:var(--ink);
}
.awb-card{width:100%;max-width:1080px;background:var(--bezel);border-radius:var(--radius);padding:12px;box-shadow:var(--shadow)}
.awb-inner{background:linear-gradient(180deg,#fbfcfd 0%,#eef2f6 100%);border-radius:8px;overflow:hidden}

.awb-header{background:linear-gradient(180deg,var(--navy) 0%,var(--navy-dark) 100%);display:flex;align-items:center;gap:22px;padding:14px 18px 14px 26px;position:relative}
.awb-brand{flex:1 1 auto;min-width:0;color:#fff}
.awb-brand h1{font-size:31px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;line-height:1.12}
.awb-brand span{display:block;font-size:18px;letter-spacing:.22em;color:#c2d2e4;text-transform:uppercase;margin-top:5px}
.awb-dots{display:flex;gap:8px;align-items:center;flex:0 0 auto}
.awb-dots i{width:32px;height:11px;border-radius:3px;display:block}
.awb-dots i:nth-child(1){background:#e8eef5}
.awb-dots i:nth-child(2){background:#35c7d6}
.awb-dots i:nth-child(3){background:#f2c14e}
/* The mark is square, so the cap's HEIGHT is what caps its size — keep the two
   close in shape or the logo shrinks to fit while the panel sits half empty. */
.awb-header-cap{flex:0 0 auto;width:188px;height:124px;background:#fff;border-radius:6px 6px 48px 6px;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:10px 14px}
.awb-header-cap img{max-height:104px;max-width:160px;object-fit:contain}

.awb-title{margin:20px 22px 0;background:var(--panel-2);border:4px solid var(--line-strong);border-radius:10px;padding:18px 22px;text-align:center}
.awb-title h2{font-size:42px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--ink);line-height:1.1}
.awb-title p{font-size:36px;font-weight:600;margin-top:6px;color:var(--ink-soft);line-height:1.2}
.awb-title p b{color:var(--accent);font-weight:700;letter-spacing:.02em}

.awb-body{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:24px 26px 10px}
.awb-col{display:flex;flex-direction:column;gap:18px}
/* ICON_SLOT: every icon column on the card is this wide and its glyph is
   centred in it, so section icons, timeline dots and event icons all share one
   vertical axis — and the text beside them shares one left edge. */
.sec-title{display:flex;align-items:center;gap:12px;font-size:26px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--ink)}
.sec-title .ico{flex:0 0 auto;width:28px;text-align:center;font-size:26px;line-height:1}

.kv{display:flex;flex-direction:column;gap:9px;font-size:22px}
.kv .row{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;line-height:1.35}
.kv .k{font-style:italic;color:var(--ink-soft);white-space:nowrap}
.kv .v{font-weight:700;color:var(--ink)}

.awb-hero{width:100%;height:225px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:10px}
.awb-hero img{max-width:100%;max-height:100%;object-fit:contain}

.hr{height:1px;background:var(--line);margin:4px 0}

/* Fixed row height keeps the rail between dots exact: the ring is centred in a
   34px row, so it spans 8px..30px and the rail below it is pure arithmetic.
   3px side margins pad the 22px ring out to the 28px ICON_SLOT, putting its
   centre on 14px — the same axis as the section icon above it.
   top:2px is an optical nudge: html2canvas pads its measured baseline by 2px,
   so rasterised text lands 2px below where CSS boxes do. */
.timeline{display:flex;flex-direction:column;gap:16px}
.tl-item{display:flex;align-items:center;gap:12px;font-size:22px;height:34px;position:relative}
.tl-item .dot{flex:0 0 auto;width:22px;height:22px;margin:0 3px;border-radius:50%;border:3px solid var(--navy-mid);background:#fff;position:relative;top:2px}
.tl-item .t{font-weight:700}
.tl-item .l{color:var(--ink-soft)}
/* 4px to the row bottom + 16px gap + 8px tucked under the next ring */
.timeline.connected .tl-item:not(:last-child)::before{content:"";position:absolute;left:13px;top:30px;height:28px;width:2px;background:var(--line)}

.events{display:flex;flex-direction:column;gap:16px;font-size:22px}
.event{display:flex;align-items:center;gap:12px;line-height:1.3}
.event .ico{font-size:24px;width:28px;text-align:center;flex:0 0 auto}
.event b{font-weight:700}
.event span{color:var(--ink-soft)}

.awb-footer{margin-top:16px;background:linear-gradient(180deg,var(--navy) 0%,var(--navy-dark) 100%);color:#fff;text-align:center;font-size:24px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;padding:14px}

@media print{ body{background:#fff;padding:0} .awb-card{box-shadow:none;background:#fff;padding:0} }
</style>
</head>
<body>

<div class="awb-card">
  <div class="awb-inner">

    <header class="awb-header">
      <div class="awb-brand">
        <h1>Trade International Logistic</h1>
        <span>${esc(cityTitle(shipment?.origin) || 'Pakistan')}</span>
      </div>
      <div class="awb-dots"><i></i><i></i><i></i></div>
      <div class="awb-header-cap">
        <img src="${logoUrl}" alt="">
      </div>
    </header>

    <section class="awb-title">
      <h2>Airway Bill</h2>
      <p>AWB Number: <b>${esc(shipment?.awb_number ?? '—')}</b></p>
    </section>

    <div class="awb-body">

      <div class="awb-col">
        <div class="sec-title"><span class="ico">&#9992;</span> Flight Details</div>

        <div class="awb-hero">
          <img src="${heroUrl}" alt="${esc(shipment?.airlines?.name ?? 'Aircraft')}">
        </div>

        <div class="sec-title"><span class="ico">&#128337;</span> Timeline</div>
        <div class="timeline connected">${timeline}
        </div>
      </div>

      <div class="awb-col">
        <div class="kv">
          <div class="row"><span class="k">Dated:</span><span class="v">${esc(formatFullDateWithDay(shipment?.flight_date))}</span></div>
          <div class="row"><span class="k">Flight Number:</span><span class="v">${esc(details.flightNumber || '—')}</span></div>
          <div class="row"><span class="k">Route:</span><span class="v">${routeLine(shipment)}</span></div>
        </div>

        <div class="sec-title"><span class="ico">&#127760;</span> Shipment Overview</div>
        <div class="kv">
          <div class="row"><span class="k">Shipper:</span><span class="v">${esc((client?.name ?? 'Customer').toUpperCase())}</span></div>
          <div class="row"><span class="k">Origin:</span><span class="v">${esc(placeLine(shipment?.origin))}</span></div>
          <div class="row"><span class="k">Destination:</span><span class="v">${esc(placeLine(shipment?.destination))}</span></div>
          <div class="row"><span class="k">Commodity:</span><span class="v">${commodityEmoji(details.commodity || shipment?.commodity)} ${esc(cargoLine(shipment, details))}</span></div>
        </div>

        <div class="hr"></div>

        <div class="events">${events}
        </div>
      </div>

    </div>

    <footer class="awb-footer">Booking Confirmed</footer>

  </div>
</div>

</body>
</html>`
}

/** Renders the card off-screen and returns a jsPDF sized to the card (single page). */
export async function buildBookingPdf(shipment, client, details = {}, logoUrl = BOOKING_LOGO_URL) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  const CARD_WIDTH = 1120   // 1080px card + body padding
  const html = buildBookingHTML(shipment, client, details, logoUrl)
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${CARD_WIDTH}px;height:1px;border:none;`
  document.body.appendChild(iframe)

  try {
    await new Promise((resolve) => {
      iframe.onload = resolve
      iframe.contentDocument.open()
      iframe.contentDocument.write(html)
      iframe.contentDocument.close()
    })

    // let the artwork decode and Poppins load before the snapshot
    const doc = iframe.contentDocument
    await Promise.all(
      Array.from(doc.images).map((img) => (img.complete ? null : new Promise((r) => {
        img.onload = r
        img.onerror = r
      }))),
    )
    await Promise.all([
      ensurePoppins(doc, false),   // faces already ship inside the card's own <style>
      ensurePoppins(document),     // the canvas html2canvas paints on lives here
    ])
    await new Promise((resolve) => setTimeout(resolve, 250))

    const body = doc.body
    const height = Math.ceil(body.scrollHeight)
    const canvas = await html2canvas(body, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#d8d4c8',
      width: CARD_WIDTH,
      height,
      windowWidth: CARD_WIDTH,
      // html2canvas re-measures every word inside a throwaway clone; it must
      // have Poppins too or the coordinates it hands the painter are wrong
      onclone: (clonedDoc) => ensurePoppins(clonedDoc, false),
    })

    // A page shaped exactly like the card, so nothing is cropped or split.
    const PX_TO_MM = 25.4 / 96
    const pageW = CARD_WIDTH * PX_TO_MM
    const pageH = height * PX_TO_MM
    const pdf = new jsPDF({
      unit: 'mm',
      format: [pageW, pageH],
      orientation: pageW >= pageH ? 'landscape' : 'portrait',
    })
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageW, pageH)
    return pdf
  } finally {
    document.body.removeChild(iframe)
  }
}

/** PDF as a File, ready for navigator.share / download. */
export async function buildBookingPdfFile(shipment, client, details = {}) {
  const pdf = await buildBookingPdf(shipment, client, details)
  const name = `Booking-${shipment?.awb_number || 'shipment'}.pdf`
  return { pdf, name, file: new File([pdf.output('blob')], name, { type: 'application/pdf' }) }
}
