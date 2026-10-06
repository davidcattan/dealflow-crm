'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// Clears the signed-in user's unread count.
export async function markActivitySeen() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('notification_seen').upsert({ user_id: user.id, seen_at: new Date().toISOString() })
  revalidatePath('/', 'layout')
}
