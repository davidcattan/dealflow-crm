import 'server-only'
import { createHash, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// Personal keys for the iPhone shortcut. The key is shown once when made;
// only its hash is stored.

export function newKey() {
  return `jed_${randomBytes(24).toString('base64url')}`
}

export function hashKey(key: string) {
  return createHash('sha256').update(key).digest('hex')
}

// The person a request's "Authorization: Bearer <key>" belongs to, plus an
// admin client to act with (the shortcut has no browser session).
export async function authenticateShortcut(request: Request) {
  const key = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!key) return null
  const supabase = createAdminClient()
  if (!supabase) return null
  const { data } = await supabase
    .from('api_keys')
    .select('id, user_id')
    .eq('key_hash', hashKey(key))
    .is('revoked_at', null)
    .maybeSingle()
  if (!data) return null
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
  return { userId: data.user_id as string, supabase }
}
