const sizes = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-[3px]',
  xl: 'w-16 h-16 border-4',
}

export function Spinner({ size = 'md', className = '' }) {
  return (
    <div
      className={`animate-spin rounded-full border-gray-200 border-t-navy ${sizes[size]} ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

export function FullPageSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-50 z-50">
      <div className="text-center">
        <Spinner size="xl" className="mx-auto" />
        <p className="mt-4 text-sm text-gray-400">Loading…</p>
      </div>
    </div>
  )
}
