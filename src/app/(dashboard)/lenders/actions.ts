'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { toArray } from '@/lib/form-utils'

export type FormState = { error?: string } | undefined

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

export async function createLender(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const name = String(formData.get('name') ?? '').trim()

  if (!name) {
    return { error: 'Lender name is required.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('lenders')
    .insert({
      name,
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
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { error: 'Could not create lender. Please try again.' }
  }

  revalidatePath('/lenders')
  redirect(`/lenders/${data.id}`)
}
