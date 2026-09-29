import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client for background jobs that run with no signed-in user
// (the scheduled inbox sync). Bypasses row-level security, so it must only
// ever be used server-side, never exposed to a browser. Returns null when
// the key isn't configured so callers can fail with a clear message.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}
