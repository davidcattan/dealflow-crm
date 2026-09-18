'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BORROWER_STATUSES } from '@/lib/types'

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length > 0 ? str : null
}

export async function updateBorrower(formData: FormData) {
  const id = String(formData.get('borrower_id') ?? '')
  if (!id) return

  const status = String(formData.get('status') ?? '')
  const supabase = await createClient()

  await supabase
    .from('borrowers')
    .update({
      company_name: String(formData.get('company_name') ?? '').trim(),
      contact_name: emptyToNull(formData.get('contact_name')),
      contact_email: emptyToNull(formData.get('contact_email')),
      contact_phone: emptyToNull(formData.get('contact_phone')),
      industry: emptyToNull(formData.get('industry')),
      website: emptyToNull(formData.get('website')),
      notes: emptyToNull(formData.get('notes')),
      status: BORROWER_STATUSES.includes(status as (typeof BORROWER_STATUSES)[number])
        ? status
        : undefined,
    })
    .eq('id', id)

  revalidatePath(`/borrowers/${id}`)
  revalidatePath('/borrowers')
}

export async function uploadDocument(formData: FormData) {
  const borrowerId = String(formData.get('borrower_id') ?? '')
  const file = formData.get('file') as File | null

  if (!borrowerId || !file || file.size === 0) return

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${borrowerId}/${Date.now()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('borrower-documents')
    .upload(storagePath, file, { contentType: file.type || undefined })

  if (uploadError) return

  await supabase.from('documents').insert({
    borrower_id: borrowerId,
    file_name: file.name,
    storage_path: storagePath,
    file_size: file.size,
    content_type: file.type || null,
    uploaded_by: user?.id ?? null,
  })

  revalidatePath(`/borrowers/${borrowerId}`)
}

export async function deleteDocument(formData: FormData) {
  const borrowerId = String(formData.get('borrower_id') ?? '')
  const documentId = String(formData.get('document_id') ?? '')
  const storagePath = String(formData.get('storage_path') ?? '')

  if (!documentId || !storagePath) return

  const supabase = await createClient()
  await supabase.storage.from('borrower-documents').remove([storagePath])
  await supabase.from('documents').delete().eq('id', documentId)

  revalidatePath(`/borrowers/${borrowerId}`)
}

export async function deleteBorrower(formData: FormData) {
  const id = String(formData.get('borrower_id') ?? '')
  if (!id) return

  const supabase = await createClient()

  const { data: documents } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('borrower_id', id)

  if (documents && documents.length > 0) {
    await supabase.storage
      .from('borrower-documents')
      .remove(documents.map((d) => d.storage_path))
  }

  await supabase.from('borrowers').delete().eq('id', id)

  revalidatePath('/borrowers')
  revalidatePath('/pipeline')
  redirect('/borrowers')
}

export async function getDocumentUrl(storagePath: string) {
  const supabase = await createClient()
  const { data } = await supabase.storage
    .from('borrower-documents')
    .createSignedUrl(storagePath, 60 * 10)

  return data?.signedUrl ?? null
}
