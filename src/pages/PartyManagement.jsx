import { useState } from 'react'
import { Users, Plane, FileCheck, Truck } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { ClientsTab }        from '../components/party/ClientsTab'
import { AirlinesTab }       from '../components/party/AirlinesTab'
import { FormESuppliersTab } from '../components/party/FormESuppliersTab'
import { ClearingAgentsTab } from '../components/party/ClearingAgentsTab'


// ── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'clients',  label: 'Clients',          Icon: Users,      Component: ClientsTab },
  { id: 'airlines', label: 'Airlines',          Icon: Plane,      Component: AirlinesTab },
  { id: 'form-e',   label: 'Form E Suppliers',  Icon: FileCheck,  Component: FormESuppliersTab },
  { id: 'agents',   label: 'Clearing Agents',   Icon: Truck,      Component: ClearingAgentsTab },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PartyManagement() {
  const [tab, setTab] = useState('clients')
  const ready = true

  const ActiveTab = TABS.find((t) => t.id === tab)?.Component ?? ClientsTab

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-navy tracking-tight">Party Management</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage clients, airlines, Form E suppliers, and clearing agents.
        </p>
      </div>

      <Card>
        {/* Tab navigation */}
        <div className="border-b border-gray-200">
          <nav className="flex overflow-x-auto">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={[
                  'flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap',
                  'border-b-2 transition-colors',
                  tab === id
                    ? 'border-navy text-navy bg-navy/[0.03]'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                ].join(' ')}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="p-6">
          {!ready ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : (
            <ActiveTab />
          )}
        </div>
      </Card>
    </div>
  )
}
