const variants = {
  primary:   'bg-navy text-white hover:bg-navy-light active:bg-navy-dark',
  secondary: 'bg-white text-navy border border-navy hover:bg-gray-50',
  danger:    'bg-danger text-white hover:bg-red-700 active:bg-red-800',
  ghost:     'text-navy hover:bg-gray-100 active:bg-gray-200',
  success:   'bg-success text-white hover:bg-green-700',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function Button({
  children,
  variant  = 'primary',
  size     = 'md',
  className = '',
  ...props
}) {
  return (
    <button
      className={[
        'inline-flex items-center gap-2 rounded-md font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant] ?? variants.primary,
        sizes[size]       ?? sizes.md,
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </button>
  )
}
