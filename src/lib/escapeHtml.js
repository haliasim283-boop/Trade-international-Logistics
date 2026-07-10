// Escapes text before it is spliced into a raw HTML string (print/report
// builders that use document.write instead of React). Without this, a
// user-entered description/notes/name field containing markup executes as
// live script in the print window — which shares localStorage (and thus
// the Supabase session token) with the main app.
export function escapeHtml(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
