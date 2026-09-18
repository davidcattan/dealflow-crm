'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { toArray } from '@/lib/form-utils'

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length > 0 ? str : null
}

function toNumberOrNull(value: FormDataEntryValue | null): number | null {
  const str = String(value ?? '').trim()
  if (!str) return null
  const num = Number(str)
  return Number.isFinite(num) ? num : null
}

export async function updateLender(formData: FormData) {
  const id = String(formData.get('lender_id') ?? '')
  if (!id) return

  const status = String(formData.get('status') ?? 'active')
  const supabase = await createClient()

  await supabase
    .from('lenders')
    .update({
      name: String(formData.get('name') ?? '').trim(),
      contact_name: emptyToNull(formData.get('contact_name')),
      contact_email: emptyToNull(formData.get('contact_email')),
      contact_phone: emptyToNull(formData.get('contact_phone')),
      website: emptyToNull(formData.get('website')),
      min_loan_amount: toNumberOrNull(formData.get('min_loan_amount')),
      max_loan_amount: toNumberOrNull(formData.get('max_loan_amount')),
      asset_types: toArray(formData.get('asset_types')),
      industries: toArray(formData.get('industries')),
      geographies: toArray(formData.get('geographies')),
      mandate_notes: emptyToNull(formData.get('mandate_notes')),
      status: status === 'inactive' ? 'inactive' : 'active',
    })
    .eq('id', id)

  revalidatePath(`/lenders/${id}`)
  revalidatePath('/lenders')
}

export async function deleteLender(formData: FormData) {
  const id = String(formData.get('lender_id') ?? '')
  if (!id) return

  const supabase = await createClient()
  await supabase.from('lenders').delete().eq('id', id)

  revalidatePath('/lenders')
  redirect('/lenders')
}
