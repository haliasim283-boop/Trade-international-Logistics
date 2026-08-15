// AWB number handling shared by the importers.
//
// awb_number is free text, so the same waybill can be stored as
// "214-8220-4920", "214 8220 4920" or "21482204920" depending on where it came
// from. Comparisons are therefore made on the digits alone.

export function awbKey(v) {
  if (v === null || v === undefined) return ''
  const digits = String(v).replace(/\D/g, '')
  return digits.length >= 10 ? digits : ''
}

// Spellings to hand to a Supabase `.in()` lookup, since punctuation cannot be
// stripped server-side.
export function awbLookupVariants(raw) {
  const key = awbKey(raw)
  if (!key) return []
  const variants = new Set([String(raw).trim(), key])
  if (key.length === 11) {
    variants.add(`${key.slice(0, 3)}-${key.slice(3, 7)}-${key.slice(7)}`)
    variants.add(`${key.slice(0, 3)}-${key.slice(3)}`)
    variants.add(`${key.slice(0, 3)} ${key.slice(3, 7)} ${key.slice(7)}`)
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
