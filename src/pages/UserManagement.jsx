import { useState, useEffect } from 'react'
import { UserCog, Plus, Pencil, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/Button'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Table, Thead, Th, Tbody, Tr, Td } from '../components/ui/Table'
import { Spinner } from '../components/ui/Spinner'
import { ROLE_COLORS } from '../config/nav'

const ROLES = ['Admin', 'Manager', 'Data Entry', 'Report Viewer', 'Invoice Agent']

export default function UserManagement() {
  const { profile: myProfile } = useAuth()
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // profile being edited
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at')
    if (!error) setUsers(data ?? [])
    setLoading(false)
  }

  async function saveRole(id, role) {
    setSaving(true)
    setError('')
    const { error } = await supabase
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id)
    setSaving(false)
    if (error) { setError(error.message); return }
    setEditing(null)
    loadUsers()
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-navy">User Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage who can access this system and their role.</p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <span className="text-sm font-semibold text-navy uppercase tracking-wide flex items-center gap-2">
            <Shield className="w-4 h-4" /> System Users
          </span>
          <span className="text-xs text-gray-400">
            Add users via Supabase Dashboard → Authentication → Users
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <UserCog className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No users found. Create users in Supabase Dashboard first.</p>
            </div>
          ) : (
            <Table>
              <Thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Joined</Th>
                  <Th></Th>
                </tr>
              </Thead>
              <Tbody>
                {users.map(u => (
                  <Tr key={u.id}>
                    <Td>
                      <span className="font-medium text-gray-800">{u.full_name}</span>
                      {u.id === myProfile?.id && (
                        <span className="ml-2 text-xs text-accent">(you)</span>
                      )}
                    </Td>
                    <Td>{u.email}</Td>
                    <Td>
                      {editing === u.id ? (
                        <select
                          className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                          defaultValue={u.role}
                          onChange={e => saveRole(u.id, e.target.value)}
                          disabled={saving}
                        >
                          {ROLES.map(r => <option key={r}>{r}</option>)}
                        </select>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[u.role] ?? ''}`}>
                          {u.role}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {new Date(u.created_at).toLocaleDateString('en-GB')}
                    </Td>
                    <Td>
                      {editing !== u.id && (
                        <button
                          onClick={() => setEditing(u.id)}
                          className="text-gray-400 hover:text-accent transition-colors"
                          title="Change role"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">To add a new user:</p>
        <ol className="list-decimal ml-4 space-y-0.5 text-amber-700">
          <li>Go to Supabase Dashboard → Authentication → Users → Add user</li>
          <li>Enter their email and a temporary password</li>
          <li>Return here and set their role</li>
          <li>Ask them to sign in and change their password</li>
        </ol>
      </div>
    </div>
  )
}
