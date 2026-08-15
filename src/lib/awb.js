// AWB number handling shared by the importers.
//
// An air waybill number is a 3-digit airline prefix followed by an 8-digit
// serial: 960-0036-0931. Two things make the same waybill look different
// depending on where it came from:
//
//   * Punctuation — "214-8220-4920", "214 8220 4920", "21482204920".
//   * A dropped leading zero — when a spreadsheet holds the serial as a NUMBER,
//     0036-0931 comes back as 36931 and the AWB reads "960-0036-931". This is
//     the same waybill, one digit short.
//
// Every comparison therefore runs through awbKey(), which strips punctuation
// and pads the serial back to its full 8 digits.

const PREFIX_LEN = 3
const SERIAL_LEN = 8

export function awbKey(v) {
  if (v === null || v === undefined) return ''
  const groups = String(v).match(/\d+/g)
  if (!groups) return ''

  let prefix, serial
  if (groups.length >= 3) {
    // PPP-AAAA-BBBB. Each half of the serial is padded on its own, because it
    // is the individual group that sat in a numeric cell and lost its zero:
    // 960-0036-931 is 0931 in the last group, not 0036 in the first.
    prefix = groups[0]
    serial = groups[1].padStart(4, '0') + groups.slice(2).join('').padStart(4, '0')
  } else if (groups.length === 2) {
    // PPP-SSSSSSSS — the whole serial was one numeric cell.
    prefix = groups[0]
    serial = groups[1].padStart(SERIAL_LEN, '0')
  } else {
    const digits = groups[0]
    if (digits.length <= PREFIX_LEN) return ''
    prefix = digits.slice(0, PREFIX_LEN)
    serial = digits.slice(PREFIX_LEN).padStart(SERIAL_LEN, '0')
  }

  if (prefix.length !== PREFIX_LEN || serial.length !== SERIAL_LEN) {
    // Not AWB-shaped — too long, or too mangled to repair safely. Fall back to
    // the raw digits so identical strings still compare equal, rather than
    // inventing a number.
    const flat = groups.join('')
    return flat.length >= PREFIX_LEN + SERIAL_LEN - 1 ? flat : ''
  }
  return prefix + serial
}

// Canonical display form, "960-0036-0931". Falls back to the input untouched
// if it isn't AWB-shaped, so nothing unexpected gets rewritten.
export function formatAwb(v) {
  const key = awbKey(v)
  if (key.length !== PREFIX_LEN + SERIAL_LEN) return String(v ?? '').trim()
  return `${key.slice(0, 3)}-${key.slice(3, 7)}-${key.slice(7)}`
}

// Every spelling the number might already be stored under, for a Supabase
// `.in()` lookup — punctuation cannot be stripped server-side.
//
// Both the padded form and the digits exactly as given are covered, so a row
// saved earlier under the short spelling is still found. For a well-formed AWB
// the two are identical and this collapses to four variants.
export function awbLookupVariants(raw) {
  const key = awbKey(raw)
  if (!key) return []

  // The raw spelling is always included, so a row saved by an earlier import
  // under the zero-stripped form is still found.
  const variants = new Set([String(raw).trim(), String(raw).replace(/\D/g, '')])
  if (key.length === PREFIX_LEN + SERIAL_LEN) {
    const prefix = key.slice(0, PREFIX_LEN)
    const serial = key.slice(PREFIX_LEN)
    variants.add(key)
    variants.add(`${prefix}-${serial}`)
    variants.add(`${prefix}-${serial.slice(0, 4)}-${serial.slice(4)}`)
    variants.add(`${prefix} ${serial.slice(0, 4)} ${serial.slice(4)}`)
  } else {
    variants.add(key)
  }
  return [...variants].filter(Boolean)
}

export function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Look up which of `awbs` already exist in the shipments table.
 * Returns a Set of awbKey()s that are present.
 */
export async function fetchExistingAwbKeys(supabase, awbs) {
  const variants = [...new Set(awbs.flatMap(awbLookupVariants))]
  const present = new Set()
  for (const batch of chunk(variants, 250)) {
    const { data, error } = await supabase
      .from('shipments')
      .select('awb_number')
      .in('awb_number', batch)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      const k = awbKey(row.awb_number)
      if (k) present.add(k)
    }
  }
  return present
}
