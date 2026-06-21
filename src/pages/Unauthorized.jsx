import { ShieldOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'

export default function Unauthorized() {
  const navigate = useNavigate()
  return (
    <div className="flex items-center justify-center min-h-[28rem]">
      <div className="text-center">
        <ShieldOff className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <h2 className="text-xl font-semibold text-gray-600 mb-2">Access Denied</h2>
        <p className="text-sm text-gray-400 mb-6">
          Your role does not have permission to view this page.
        </p>
        <Button variant="secondary" onClick={() => navigate('/')}>
          Go to Dashboard
        </Button>
      </div>
    </div>
  )
}
