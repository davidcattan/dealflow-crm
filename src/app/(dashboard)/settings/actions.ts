'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function setAutoSync(enabled: boolean) {
  const supabase = await createClient()
  await supabase.from('inbox_sync_state').update({ auto_sync_enabled: enabled }).eq('id', 1)
  revalidatePath('/settings')
  revalidatePath('/inbox')
}

// Removes one connected mailbox. Its emails already in the CRM stay.
export async function disconnectOutlook(connectionId: string) {
  if (!connectionId) return
  const supabase = await createClient()
  await supabase.from('outlook_connections').delete().eq('id', connectionId)
  revalidatePath('/settings')
  revalidatePath('/inbox')
}

// Saves one mailbox owner's intro paragraph and signature for lender emails.
export async function saveEmailProfile(connectionId: string, intro: string, signature: string) {
  if (!connectionId) return
  const supabase = await createClient()
  await supabase
    .from('outlook_connections')
    .update({ email_intro: intro.trim() || null, email_signature: signature.trim() || null })
    .eq('id', connectionId)
  revalidatePath('/settings')
  revalidatePath('/inbox')
}
