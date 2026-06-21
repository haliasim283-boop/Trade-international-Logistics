import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plane, AlertCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/Button'

export default function Login() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()
  const location   = useLocation()
  const from       = location.state?.from?.pathname ?? '/'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: err } = await signIn(email, password)

    setLoading(false)
    if (err) {
      setError(err.message ?? 'Login failed. Check your credentials.')
    } else {
      navigate(from, { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Navy header */}
        <div className="bg-navy rounded-t-2xl px-8 pt-8 pb-6 text-center">
          <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center mx-auto mb-4">
            <Plane className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-white text-xl font-bold uppercase tracking-wider leading-tight">
            Trade International
          </h1>
          <p className="text-blue-300 text-sm mt-0.5">Logistics · Peshawar</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-b-2xl shadow-lg px-8 py-8">
          <h2 className="text-base font-semibold text-gray-800 mb-6">
            Sign in to your account
          </h2>

          {error && (
            <div className="mb-4 flex items-start gap-2 text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Email address
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="••••••••"
              />
            </div>

            <Button
              type="submit"
              className="w-full justify-center mt-2"
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-400">
            IATA Reg. 27-3 0688/0005
          </p>
        </div>
      </div>
    </div>
  )
}
