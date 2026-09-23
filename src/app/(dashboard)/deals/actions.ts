'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { DEAL_STATUSES, type DealStatus } from '@/lib/types'

export type FormState = { error?: string; dealId?: string } | undefined

export async function createDeal(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const companyName = String(formData.get('company_name') ?? '').trim()

  if (!companyName) {
    return { error: 'Company name is required.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('deals')
    .insert({
      company_name: companyName,
      contact_name: emptyToNull(formData.get('contact_name')),
      contact_email: emptyToNull(formData.get('contact_email')),
      contact_phone: emptyToNull(formData.get('contact_phone')),
      industry: emptyToNull(formData.get('industry')),
      loan_type: emptyToNull(formData.get('loan_type')),
      website: emptyToNull(formData.get('website')),
      notes: emptyToNull(formData.get('notes')),
      deal_type: emptyToNull(formData.get('deal_type')),
      rep_name: emptyToNull(formData.get('rep_name')),
      activity_score: toActivityScoreOrNull(formData.get('activity_score')),
      status: DEAL_STATUSES.includes(String(formData.get('status')) as (typeof DEAL_STATUSES)[number])
        ? String(formData.get('status'))
        : 'new',
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { error: 'Could not create deal. Please try again.' }
  }

  revalidatePath('/deals')
  // No redirect() here — any attached documents still need to be uploaded
  // (client-side, straight to Storage) before navigating, and the client
  // needs the new id back to do that. See new-deal-form.tsx.
  return { dealId: data.id }
}

function toActivityScoreOrNull(value: FormDataEntryValue | null): number | null {
  const str = String(value ?? '').trim()
  if (!str) return null
  const num = Number(str)
  return Number.isFinite(num) && num >= 0 && num <= 10 ? Math.round(num) : null
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length > 0 ? str : null
}

// Updates in chunks so selecting hundreds of deals never builds a
// request URL that's too long.
async function setStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
  status: DealStatus
) {
  for (let i = 0; i < ids.length; i += 50) {
    await supabase.from('deals').update({ status }).in('id', ids.slice(i, i + 50))
  }
}

// Bulk "mark as dead" from the Deals list checkboxes.
export async function markDealsDead(formData: FormData) {
  const ids = formData.getAll('deal_ids').map(String).filter(Boolean)
  if (ids.length === 0) return

  const supabase = await createClient()
  await setStatus(supabase, ids, 'dead')

  revalidatePath('/deals')
  revalidatePath('/pipeline')
}

// Bulk status change from the Deals list checkboxes.
export async function updateDealsStatus(formData: FormData) {
  const ids = formData.getAll('deal_ids').map(String).filter(Boolean)
  const status = String(formData.get('status') ?? '') as DealStatus
  if (ids.length === 0 || !DEAL_STATUSES.includes(status)) return

  const supabase = await createClient()
  await setStatus(supabase, ids, status)

  revalidatePath('/deals')
  revalidatePath('/pipeline')
}
