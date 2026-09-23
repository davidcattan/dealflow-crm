'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

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

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length > 0 ? str : null
}

// Bulk "mark as dead" from the Deals list checkboxes.
export async function markDealsDead(formData: FormData) {
  const ids = formData.getAll('deal_ids').map(String).filter(Boolean)
  if (ids.length === 0) return

  const supabase = await createClient()
  await supabase.from('deals').update({ status: 'dead' }).in('id', ids)

  revalidatePath('/deals')
  revalidatePath('/pipeline')
}
