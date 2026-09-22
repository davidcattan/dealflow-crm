'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { toArray } from '@/lib/form-utils'
import { parseCompactCurrency } from '@/lib/format'

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length > 0 ? str : null
}

export async function updateLender(formData: FormData) {
  const id = String(formData.get('lender_id') ?? '')
  if (!id) return

  const status = String(formData.get('status') ?? 'active')
  const caresAboutProfit = String(formData.get('cares_about_profit') ?? '')
  const supabase = await createClient()

  await supabase
    .from('lenders')
    .update({
      name: String(formData.get('name') ?? '').trim(),
      contact_name: emptyToNull(formData.get('contact_name')),
      contact_email: emptyToNull(formData.get('contact_email')),
      contact_phone: emptyToNull(formData.get('contact_phone')),
      website: emptyToNull(formData.get('website')),
      lending_type: emptyToNull(formData.get('lending_type')),
      cares_about_profit:
        caresAboutProfit === 'yes' ? true : caresAboutProfit === 'no' ? false : null,
      min_loan_amount: parseCompactCurrency(formData.get('min_loan_amount')),
      max_loan_amount: parseCompactCurrency(formData.get('max_loan_amount')),
      min_revenue: parseCompactCurrency(formData.get('min_revenue')),
      min_ebitda: parseCompactCurrency(formData.get('min_ebitda')),
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
