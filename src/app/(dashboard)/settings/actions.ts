'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function setAutoSync(enabled: boolean) {
  const supabase = await createClient()
  await supabase.from('inbox_sync_state').update({ auto_sync_enabled: enabled }).eq('id', 1)
  revalidatePath('/settings')
}

// Removes one connected mailbox. Its emails already in the CRM stay.
export async function disconnectOutlook(connectionId: string) {
  if (!connectionId) return
  const supabase = await createClient()
  await supabase.from('outlook_connections').delete().eq('id', connectionId)
  revalidatePath('/settings')
}
