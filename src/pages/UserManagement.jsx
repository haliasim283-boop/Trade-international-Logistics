import { useState, useEffect } from 'react'
import { UserCog, Pencil, Shield, KeyRound, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { supabaseAdmin } from '../lib/supabaseAdmin'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/Button'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Table, Thead, Th, Tbody, Tr, Td } from '../components/ui/Table'
import { Spinner } from '../components/ui/Spinner'
import { Modal } from '../components/ui/Modal'
import { ROLE_COLORS } from '../config/nav'

const ROLES = ['Admin', 'Manager', 'Data Entry', 'Report Viewer', 'Invoice Agent']

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
      type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
    }`}>
      {type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
      {msg}
    </div>
  )
}

// ── Password Reset Modal ───────────────────────────────────────────────────────

function ResetPasswordModal({ user, onClose, onSuccess }) {
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew,         setShowNew]         = useState(false)
  const [showConfirm,     setShowConfirm]     = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState('')

  const minLength  = 8
  const strength   = newPassword.length === 0 ? null
    : newPassword.length < minLength           ? 'weak'
    : /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword) ? 'strong'
    : 'medium'
  const strengthColor = { weak: 'bg-red-400', medium: 'bg-amber-400', strong: 'bg-green-500' }
  const strengthLabel = { weak: 'Too short', medium: 'Fair', strong: 'Strong' }
  const strengthWidth = { weak: 'w-1/3', medium: 'w-2/3', strong: 'w-full' }

  async function handleReset() {
    setError('')
    if (newPassword.length < minLength) {
      setError(`Password must be at least ${minLength} characters.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!supabaseAdmin) {
      setError('Admin client not configured. Add VITE_SUPABASE_SERVICE_KEY to your .env file.')
      return
    }

    setSaving(true)
    const { error: err } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    })
    setSaving(false)

    if (err) {
      setError(err.message)
    } else {
      onSuccess()
    }
  }

  return (
    <Modal title={`Reset Password — ${user.email}`} onClose={onClose} size="sm">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Set a new password for this user. They will be able to sign in immediately with the new password.
        </p>

        {/* New password */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">New Password</label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Strength bar */}
          {strength && (
            <div className="mt-1.5 space-y-0.5">
              <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-300 ${strengthColor[strength]} ${strengthWidth[strength]}`} />
              </div>
              <p className={`text-xs font-medium ${
                strength === 'weak' ? 'text-red-500' : strength === 'medium' ? 'text-amber-500' : 'text-green-600'
              }`}>
                {strengthLabel[strength]}
              </p>
            </div>
          )}
        </div>

        {/* Confirm password */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Confirm Password</label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              className={`w-full border rounded-md px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-accent ${
                confirmPassword && confirmPassword !== newPassword
                  ? 'border-red-400 focus:ring-red-300'
                  : 'border-gray-300'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {confirmPassword && confirmPassword !== newPassword && (
            <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleReset}
            disabled={saving || !newPassword || !confirmPassword}
          >
            {saving
              ? <><Spinner size="sm" /> Saving…</>
              : <><KeyRound className="w-4 h-4" /> Set Password</>
            }
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UserManagement() {
  const { profile: myProfile } = useAuth()
  const [users,        setUsers]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [editing,      setEditing]      = useState(null)   // profile id being role-edited
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const [resetTarget,  setResetTarget]  = useState(null)   // { id, email } of user to reset
  const [toast,        setToast]        = useState(null)   // { msg, type }

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

  function handleResetSuccess() {
    setResetTarget(null)
    setToast({ msg: `Password updated for ${resetTarget?.email}`, type: 'success' })
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
                  <Th>Actions</Th>
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
                      <div className="flex items-center gap-2">
                        {editing !== u.id && (
                          <button
                            onClick={() => setEditing(u.id)}
                            className="text-gray-400 hover:text-accent transition-colors"
                            title="Change role"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setResetTarget({ id: u.id, email: u.email })}
                          className="text-gray-400 hover:text-amber-500 transition-colors"
                          title="Reset password"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                      </div>
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
          <li>Use the <KeyRound className="w-3 h-3 inline mx-0.5" /> button to set their actual password</li>
        </ol>
      </div>

      {/* Password reset modal */}
      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onSuccess={handleResetSuccess}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  )
}
