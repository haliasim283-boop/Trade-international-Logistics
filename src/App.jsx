import { Routes, Route } from 'react-router-dom'
import { Button } from './components/ui/Button'
import { Card, CardHeader, CardBody } from './components/ui/Card'
import { Table, Thead, Th, Tbody, Tr, Td } from './components/ui/Table'

// Phase 0 scaffold — replaced by full routing shell in Phase 2
export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-4">

        {/* Branding header — matches invoice navy style */}
        <div className="bg-navy rounded-xl p-6 text-center">
          <p className="text-blue-200 text-xs uppercase tracking-widest mb-1">
            IATA Air Cargo Freight Forwarder
          </p>
          <h1 className="text-white text-2xl font-bold uppercase tracking-wider">
            Trade International Logistics
          </h1>
          <p className="text-blue-300 text-sm mt-1">Peshawar, Pakistan</p>
        </div>

        {/* Token / component smoke test */}
        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-navy uppercase tracking-wide">
              Phase 0 — Scaffold Complete
            </span>
            <span className="text-xs text-gray-400">Design tokens ✓ Components ✓</span>
          </CardHeader>
          <CardBody className="space-y-4">

            <div className="flex flex-wrap gap-2">
              <Button size="sm">Primary</Button>
              <Button size="sm" variant="secondary">Secondary</Button>
              <Button size="sm" variant="danger">Danger</Button>
              <Button size="sm" variant="success">Success</Button>
              <Button size="sm" variant="ghost">Ghost</Button>
            </div>

            <div className="flex gap-2 flex-wrap text-xs">
              <span className="px-2 py-1 rounded bg-navy text-white">navy #1a2744</span>
              <span className="px-2 py-1 rounded bg-accent text-white">accent #2563eb</span>
              <span className="px-2 py-1 rounded bg-success text-white">success #16a34a</span>
              <span className="px-2 py-1 rounded bg-warning text-white">warning #d97706</span>
              <span className="px-2 py-1 rounded bg-danger text-white">danger #dc2626</span>
            </div>

            <Table>
              <Thead>
                <tr>
                  <Th>AWB No.</Th>
                  <Th>Client</Th>
                  <Th className="num">Amount (PKR)</Th>
                  <Th>Status</Th>
                </tr>
              </Thead>
              <Tbody>
                <Tr>
                  <Td>176-1421-4841</Td>
                  <Td>Waqas / Mudassir R&M</Td>
                  <Td className="num tabular-nums text-right">892,473.00</Td>
                  <Td>
                    <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-success font-medium">
                      Departed
                    </span>
                  </Td>
                </Tr>
                <Tr>
                  <Td>214-0012-3456</Td>
                  <Td>Mr. Qayum / Imran</Td>
                  <Td className="num tabular-nums text-right">345,100.00</Td>
                  <Td>
                    <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-warning font-medium">
                      Booked
                    </span>
                  </Td>
                </Tr>
              </Tbody>
            </Table>
          </CardBody>
        </Card>

        <p className="text-center text-xs text-gray-400">
          Vite + React + Tailwind + Supabase client wired. Ready for Phase 2.
        </p>
      </div>
    </div>
  )
}
