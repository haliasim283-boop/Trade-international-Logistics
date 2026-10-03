import { createClient } from '@supabase/supabase-js'

// This client uses the service-role key, which bypasses Row Level Security
// and is required to call supabase.auth.admin.* (e.g. updateUserById for
// password resets).
//
// ⚠  The service-role key is powerful. This file is intentionally kept
//    separate so callers are forced to be explicit about what they are doing.
//    Only the Admin-only User Management page should import from here.

const supabaseUrl        = import.meta.env.VITE_SUPABASE_URL
const supabaseServiceKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY

export const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          // Disable automatic session persistence for the admin client so it
          // does not accidentally overwrite the logged-in user's session in
          // localStorage.
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null
