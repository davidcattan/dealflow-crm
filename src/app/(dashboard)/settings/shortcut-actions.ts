'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { hashKey, newKey } from '@/lib/shortcut/keys'

// Makes a personal key for the iPhone shortcut. The key itself is only
// ever returned here, once.
export async function createShortcutKey(label: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }
  const key = newKey()
  const { error } = await supabase
    .from('api_keys')
    .insert({ user_id: user.id, label: label.trim() || 'iPhone', key_hash: hashKey(key) })
  if (error) {
    return { error: error.message.includes('api_keys') ? 'Run migration 034_api_keys.sql in Supabase first.' : error.message }
  }
  revalidatePath('/settings')
  return { key }
}

export async function revokeShortcutKey(id: string) {
  const supabase = await createClient()
  await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/settings')
}
