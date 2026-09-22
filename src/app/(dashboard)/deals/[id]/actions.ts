'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DEAL_STATUSES } from '@/lib/types'

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length > 0 ? str : null
}

function toActivityScoreOrNull(value: FormDataEntryValue | null): number | null {
  const str = String(value ?? '').trim()
  if (!str) return null
  const num = Number(str)
  return Number.isFinite(num) && num >= 0 && num <= 10 ? Math.round(num) : null
}

export async function updateDeal(formData: FormData) {
  const id = String(formData.get('deal_id') ?? '')
  if (!id) return

  const status = String(formData.get('status') ?? '')
  const supabase = await createClient()

  await supabase
    .from('deals')
    .update({
      company_name: String(formData.get('company_name') ?? '').trim(),
      contact_name: emptyToNull(formData.get('contact_name')),
      contact_email: emptyToNull(formData.get('contact_email')),
      contact_phone: emptyToNull(formData.get('contact_phone')),
      industry: emptyToNull(formData.get('industry')),
      website: emptyToNull(formData.get('website')),
      notes: emptyToNull(formData.get('notes')),
      activity_score: toActivityScoreOrNull(formData.get('activity_score')),
      deal_type: emptyToNull(formData.get('deal_type')),
      rep_name: emptyToNull(formData.get('rep_name')),
      status: DEAL_STATUSES.includes(status as (typeof DEAL_STATUSES)[number])
        ? status
        : undefined,
    })
    .eq('id', id)

  revalidatePath(`/deals/${id}`)
  revalidatePath('/deals')
}

export async function addDealUpdate(formData: FormData) {
  const dealId = String(formData.get('deal_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  const entryDateRaw = String(formData.get('entry_date') ?? '').trim()
  if (!dealId || !note) return

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  await supabase.from('deal_updates').insert({
    deal_id: dealId,
    note,
    entry_date: entryDateRaw || new Date().toISOString().slice(0, 10),
    source: 'manual',
    created_by: user?.id ?? null,
  })

  revalidatePath(`/deals/${dealId}`)
}

export async function deleteDealUpdate(formData: FormData) {
  const dealId = String(formData.get('deal_id') ?? '')
  const updateId = String(formData.get('update_id') ?? '')
  if (!updateId) return

  const supabase = await createClient()
  await supabase.from('deal_updates').delete().eq('id', updateId)

  revalidatePath(`/deals/${dealId}`)
}

export async function uploadDocument(formData: FormData) {
  const dealId = String(formData.get('deal_id') ?? '')
  const file = formData.get('file') as File | null

  if (!dealId || !file || file.size === 0) return

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${dealId}/${Date.now()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('borrower-documents')
    .upload(storagePath, file, { contentType: file.type || undefined })

  if (uploadError) return

  await supabase.from('documents').insert({
    deal_id: dealId,
    file_name: file.name,
    storage_path: storagePath,
    file_size: file.size,
    content_type: file.type || null,
    uploaded_by: user?.id ?? null,
  })

  revalidatePath(`/deals/${dealId}`)
}

export async function deleteDocument(formData: FormData) {
  const dealId = String(formData.get('deal_id') ?? '')
  const documentId = String(formData.get('document_id') ?? '')
  const storagePath = String(formData.get('storage_path') ?? '')

  if (!documentId || !storagePath) return

  const supabase = await createClient()
  await supabase.storage.from('borrower-documents').remove([storagePath])
  await supabase.from('documents').delete().eq('id', documentId)

  revalidatePath(`/deals/${dealId}`)
}

export async function deleteDeal(formData: FormData) {
  const id = String(formData.get('deal_id') ?? '')
  if (!id) return

  const supabase = await createClient()

  const { data: documents } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('deal_id', id)

  if (documents && documents.length > 0) {
    await supabase.storage
      .from('borrower-documents')
      .remove(documents.map((d) => d.storage_path))
  }

  await supabase.from('deals').delete().eq('id', id)

  revalidatePath('/deals')
  revalidatePath('/pipeline')
  redirect('/deals')
}

export async function toggleMatchSelected(formData: FormData) {
  const dealId = String(formData.get('deal_id') ?? '')
  const matchId = String(formData.get('match_id') ?? '')
  const nextSelected = String(formData.get('next_selected') ?? '') === 'true'
  if (!matchId) return

  const supabase = await createClient()
  await supabase.from('deal_matches').update({ selected: nextSelected }).eq('id', matchId)

  revalidatePath(`/deals/${dealId}`)
}

export async function getDocumentUrl(storagePath: string) {
  const supabase = await createClient()
  const { data } = await supabase.storage
    .from('borrower-documents')
    .createSignedUrl(storagePath, 60 * 10)

  return data?.signedUrl ?? null
}
