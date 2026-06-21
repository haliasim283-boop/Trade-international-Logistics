import { useState, useEffect } from 'react'
import { Users, Plane, FileCheck, Truck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components/ui/Spinner'
import { Card } from '../components/ui/Card'
import { ClientsTab }        from '../components/party/ClientsTab'
import { AirlinesTab }       from '../components/party/AirlinesTab'
import { FormESuppliersTab } from '../components/party/FormESuppliersTab'
import { ClearingAgentsTab } from '../components/party/ClearingAgentsTab'

// ── Seed data (runs once when tables are empty) ──────────────────────────────

const SEED = {
  airlines: [
    {
      name: 'PIA', iata_prefix: '214', cass_commission_pct: 5,
      other_charges_standard: 6246, other_charges_self_upload: 5000, bta_rate_per_awb: 1800,
    },
    {
      name: 'Emirates', iata_prefix: '176', cass_commission_pct: 5,
      other_charges_standard: 6186, other_charges_self_upload: 6186, bta_rate_per_awb: 1800,
    },
    {
      name: 'Qatar Airways', iata_prefix: '157', cass_commission_pct: 5,
      other_charges_standard: 0, other_charges_self_upload: 0, bta_rate_per_awb: 0,
    },
  ],
  clients: [
    { name: 'Waqas / Mudassir R&M', contact_person: 'Waqas / Mudassir', city: 'Peshawar', credit_terms_days: 30 },
    { name: 'Mr. Qayum Care of Imran', contact_person: 'Mr. Qayum', city: 'Peshawar', credit_terms_days: 30 },
  ],
  clearing_agents: [
    {
      name: 'In-House (Peshawar)', city: 'Peshawar',
      origin_code: 'PEW', per_shipment_charge: 10000, is_in_house: true,
    },
  ],
  form_e_suppliers: [
    { name: 'Supplier A', default_pkr_rate: 13.00 },
  ],
}

async function runSeedIfEmpty() {
  if (!supabase) return

  const [{ count: ac }, { count: cc }, { count: cac }, { count: fc }] = await Promise.all([
    supabase.from('airlines').select('*', { count: 'exact', head: true }),
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('clearing_agents').select('*', { count: 'exact', head: true }),
    supabase.from('form_e_suppliers').select('*', { count: 'exact', head: true }),
  ])

  const inserts = []
  if (ac === 0) inserts.push(supabase.from('airlines').insert(SEED.airlines))
  if (cc === 0) inserts.push(supabase.from('clients').insert(SEED.clients))
  if (cac === 0) inserts.push(supabase.from('clearing_agents').insert(SEED.clearing_agents))
  if (fc === 0) inserts.push(supabase.from('form_e_suppliers').insert(SEED.form_e_suppliers))

  if (inserts.length > 0) await Promise.all(inserts)
}

// ── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'clients',  label: 'Clients',          Icon: Users,      Component: ClientsTab },
  { id: 'airlines', label: 'Airlines',          Icon: Plane,      Component: AirlinesTab },
  { id: 'form-e',   label: 'Form E Suppliers',  Icon: FileCheck,  Component: FormESuppliersTab },
  { id: 'agents',   label: 'Clearing Agents',   Icon: Truck,      Component: ClearingAgentsTab },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PartyManagement() {
  const [tab, setTab]     = useState('clients')
  const [ready, setReady] = useState(false)
  const [seedErr, setSeedErr] = useState(null)

  useEffect(() => {
    runSeedIfEmpty()
      .catch((e) => setSeedErr(e?.message ?? 'Seed error'))
      .finally(() => setReady(true))
  }, [])

  const ActiveTab = TABS.find((t) => t.id === tab)?.Component ?? ClientsTab

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-navy tracking-tight">Party Management</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage clients, airlines, Form E suppliers, and clearing agents.
        </p>
        {seedErr && (
          <p className="mt-2 text-xs text-danger">
            Warning: seed data check failed — {seedErr}
          </p>
        )}
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
