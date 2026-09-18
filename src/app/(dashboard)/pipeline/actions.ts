'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { BORROWER_STATUSES, type BorrowerStatus } from '@/lib/types'

export async function updateBorrowerStage(
  borrowerId: string,
  status: BorrowerStatus
) {
  if (!borrowerId || !BORROWER_STATUSES.includes(status)) return

  const supabase = await createClient()
  await supabase.from('borrowers').update({ status }).eq('id', borrowerId)

  revalidatePath('/pipeline')
  revalidatePath('/borrowers')
  revalidatePath(`/borrowers/${borrowerId}`)
  revalidatePath('/')
}
