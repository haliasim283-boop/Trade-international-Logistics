import { Construction } from 'lucide-react'

export function PlaceholderPage({ title, phase, Icon }) {
  return (
    <div className="flex items-center justify-center min-h-[28rem]">
      <div className="text-center text-gray-300 select-none">
        {Icon
          ? <Icon className="w-20 h-20 mx-auto mb-5 opacity-20" />
          : <Construction className="w-20 h-20 mx-auto mb-5 opacity-20" />
        }
        <h2 className="text-xl font-semibold text-gray-400 mb-1">{title}</h2>
        {phase && (
          <p className="text-sm text-gray-300">
            Coming in <span className="font-medium text-gray-400">Phase {phase}</span>
          </p>
        )}
      </div>
    </div>
  )
}
