'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type FormState = { error?: string } | undefined

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

  // Upload any diligence documents attached at creation time — best
  // effort per file, since the deal itself is already created and
  // shouldn't be blocked by one bad upload.
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${data.id}/${Date.now()}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from('borrower-documents')
      .upload(storagePath, file, { contentType: file.type || undefined })

    if (uploadError) continue

    await supabase.from('documents').insert({
      deal_id: data.id,
      file_name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      content_type: file.type || null,
      uploaded_by: user?.id ?? null,
    })
  }

  revalidatePath('/deals')
  redirect(`/deals/${data.id}`)
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length > 0 ? str : null
}
