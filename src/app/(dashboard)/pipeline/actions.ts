'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { DEAL_STATUSES, type DealStatus } from '@/lib/types'

export async function updateDealStage(
  dealId: string,
  status: DealStatus
) {
  if (!dealId || !DEAL_STATUSES.includes(status)) return

  const supabase = await createClient()
  await supabase.from('deals').update({ status }).eq('id', dealId)

  revalidatePath('/pipeline')
  revalidatePath('/deals')
  revalidatePath(`/deals/${dealId}`)
  revalidatePath('/')
}
