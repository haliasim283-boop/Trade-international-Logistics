export function normalizeAwb(s) {
  return (s ?? '').toString().replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

export function buildShipmentAwbMap(shipments) {
  const map = new Map()
  for (const s of shipments) {
    const key = normalizeAwb(s.awb_number)
    if (key) map.set(key, s)
  }
  return map
}

// Returns 'used' (shipped), 'reserved' (on a shipment, not yet shipped), or 'available'.
export function classifyStockRow(row, shipmentByAwb) {
  const key = normalizeAwb(`${row.prefix}${row.awb_serial}`)
  const match = shipmentByAwb.get(key)
  if (!match) return 'available'
  return match.status === 'SHPD' ? 'used' : 'reserved'
}
