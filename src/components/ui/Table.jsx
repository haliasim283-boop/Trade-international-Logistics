export function Table({ children, className = '' }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-sm text-left border-collapse ${className}`}>
        {children}
      </table>
    </div>
  )
}

export function Thead({ children }) {
  return (
    <thead className="bg-navy text-white sticky top-0 z-10">
      {children}
    </thead>
  )
}

export function Th({ children, className = '' }) {
  return (
    <th className={`px-4 py-3 font-semibold uppercase tracking-wide text-xs whitespace-nowrap ${className}`}>
      {children}
    </th>
  )
}

export function Tbody({ children }) {
  return (
    <tbody className="divide-y divide-gray-100">
      {children}
    </tbody>
  )
}

export function Tr({ children, className = '' }) {
  return (
    <tr className={`hover:bg-gray-50 transition-colors ${className}`}>
      {children}
    </tr>
  )
}

export function Td({ children, className = '', ...props }) {
  return (
    <td className={`px-4 py-2.5 text-gray-700 ${className}`} {...props}>
      {children}
    </td>
  )
}

export function Tfoot({ children }) {
  return (
    <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
      {children}
    </tfoot>
  )
}
