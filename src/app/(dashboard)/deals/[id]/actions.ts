'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DEAL_STATUSES, type DealStatus } from '@/lib/types'

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
      loan_type: emptyToNull(formData.get('loan_type')),
      website: emptyToNull(formData.get('website')),
      description: emptyToNull(formData.get('description')),
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

// Moves a document to another group (and, for term sheets, sets the lender).
export async function setDocumentGroup(dealId: string, documentId: string, category: string, lenderId: string | null) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('documents')
    .update({ category, lender_id: lenderId })
    .eq('id', documentId)
    .eq('deal_id', dealId)
  if (error) return { error: error.message.includes('category') ? 'Run migration 035_document_groups.sql in Supabase first.' : error.message }
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
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

// Quick one-click status change from the deal detail page — e.g. "Mark as
// dead" / "Reopen deal" — distinct from the destructive deleteDeal above
// (this just changes the pipeline stage, nothing is removed).
export async function setDealStatusQuick(formData: FormData) {
  const dealId = String(formData.get('deal_id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!dealId || !DEAL_STATUSES.includes(status as DealStatus)) return

  const supabase = await createClient()
  await supabase.from('deals').update({ status }).eq('id', dealId)

  revalidatePath(`/deals/${dealId}`)
  revalidatePath('/deals')
  revalidatePath('/pipeline')
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

// Queue (or unqueue) a deal for underwriting by Claude Code — runs on the
// Claude subscription, not the paid API.
export async function setUnderwritingQueued(
  dealId: string,
  queued: boolean,
  kind: 'snapshot' | 'report' = 'snapshot'
) {
  if (!dealId) return
  const supabase = await createClient()
  await supabase
    .from('deals')
    .update({
      underwriting_requested_at: queued ? new Date().toISOString() : null,
      underwriting_requested_kind: queued ? kind : null,
    })
    .eq('id', dealId)
  revalidatePath(`/deals/${dealId}`)
  revalidatePath('/')
}

// Merges a duplicate deal (source) into the deal being kept (target):
// documents, updates, emails, lender submissions, matches and AI spend all
// move over; blank fields on the target are filled from the source; then
// the source deal is removed. Documents' stored files are untouched — only
// which deal they belong to changes.
export async function mergeDeals(sourceId: string, targetId: string) {
  if (!sourceId || !targetId || sourceId === targetId) return { error: 'Pick a different deal to merge into.' }
  const supabase = await createClient()
  const [{ data: source }, { data: target }] = await Promise.all([
    supabase.from('deals').select('*').eq('id', sourceId).single(),
    supabase.from('deals').select('*').eq('id', targetId).single(),
  ])
  if (!source || !target) return { error: 'Deal not found.' }

  const { count: docCount } = await supabase
    .from('documents')
    .update({ deal_id: targetId }, { count: 'exact' })
    .eq('deal_id', sourceId)
  const { count: emailCount } = await supabase
    .from('inbox_messages')
    .update({ deal_id: targetId }, { count: 'exact' })
    .eq('deal_id', sourceId)
  await supabase.from('deal_updates').update({ deal_id: targetId }).eq('deal_id', sourceId)
  await supabase.from('ai_usage').update({ deal_id: targetId }).eq('deal_id', sourceId)

  // Lender rows are unique per deal: move the ones the target doesn't have.
  for (const table of ['deal_submissions', 'deal_matches'] as const) {
    const [{ data: targetRows }, { data: sourceRows }] = await Promise.all([
      supabase.from(table).select('lender_id').eq('deal_id', targetId),
      supabase.from(table).select('id, lender_id').eq('deal_id', sourceId),
    ])
    const have = new Set((targetRows ?? []).map((r) => r.lender_id))
    const move = (sourceRows ?? []).filter((r) => !have.has(r.lender_id)).map((r) => r.id)
    if (move.length) await supabase.from(table).update({ deal_id: targetId }).in('id', move)
  }

  // Fill the target's blanks from the source; keep both notes.
  const fill: Record<string, unknown> = {}
  for (const key of [
    'contact_name', 'contact_email', 'contact_phone', 'industry', 'loan_type', 'website',
    'description', 'deal_type', 'rep_name', 'snapshot', 'snapshot_generated_at',
    'underwriting', 'underwriting_generated_at',
  ]) {
    if (target[key] == null && source[key] != null) fill[key] = source[key]
  }
  if (source.notes) fill.notes = target.notes ? `${target.notes}\n\n[From merged deal "${source.company_name}"] ${source.notes}` : source.notes
  if (Object.keys(fill).length) await supabase.from('deals').update(fill).eq('id', targetId)

  const {
    data: { user },
  } = await supabase.auth.getUser()
  await supabase.from('deal_updates').insert({
    deal_id: targetId,
    entry_date: new Date().toISOString().slice(0, 10),
    note: `Merged duplicate deal "${source.company_name}" into this one (${docCount ?? 0} documents, ${emailCount ?? 0} emails moved).`,
    source: 'manual',
    created_by: user?.id ?? null,
  })

  await supabase.from('deals').delete().eq('id', sourceId)

  revalidatePath('/deals')
  revalidatePath('/pipeline')
  revalidatePath('/')
  redirect(`/deals/${targetId}`)
}

// Queue (or unqueue) a "find new lenders" web search for Claude Code — free.
export async function setLenderSearchQueued(dealId: string, queued: boolean) {
  if (!dealId) return
  const supabase = await createClient()
  await supabase
    .from('deals')
    .update({ lender_search_requested_at: queued ? new Date().toISOString() : null })
    .eq('id', dealId)
  revalidatePath(`/deals/${dealId}`)
}

// Adds a lender found by the web search to the lender list (or reuses an
// existing one with the same name). Returns the lender id.
export async function addFoundLender(
  dealId: string,
  found: {
    name: string
    website: string
    lending_type: string
    loan_size: string | null
    geographies: string | null
    why_fit: string
    contact: string | null
    source_url: string
  }
) {
  const name = found.name.trim()
  if (!name) return { error: 'Missing lender name.' }
  const supabase = await createClient()
  const { data: existing } = await supabase.from('lenders').select('id').ilike('name', name).limit(1).maybeSingle()
  if (existing) return { id: existing.id as string }

  const email = found.contact?.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null
  const phone = !email ? (found.contact?.match(/\+?\d[\d\s().-]{8,}\d/)?.[0] ?? null) : null
  const notes = [
    `[Found by web search ${new Date().toISOString().slice(0, 10)}] ${found.lending_type}.`,
    found.loan_size ? `Loan size: ${found.loan_size}.` : null,
    found.geographies ? `Lends in: ${found.geographies}.` : null,
    found.contact && !email && !phone ? `Submit via: ${found.contact}.` : null,
    `Source: ${found.source_url}`,
  ]
    .filter(Boolean)
    .join(' ')

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: created, error } = await supabase
    .from('lenders')
    .insert({
      name,
      website: found.website || null,
      lending_type: found.lending_type || null,
      contact_email: email,
      contact_phone: phone,
      mandate_notes: notes,
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()
  if (error || !created) return { error: 'Could not add the lender.' }
  revalidatePath(`/deals/${dealId}`)
  revalidatePath('/lenders')
  return { id: created.id as string }
}

// Fix an update's text or date (e.g. something the inbox logged wrong).
export async function editDealUpdate(dealId: string, updateId: string, note: string, entryDate: string | null) {
  const text = note.trim()
  if (!updateId || !text) return
  const supabase = await createClient()
  await supabase
    .from('deal_updates')
    .update({ note: text, ...(entryDate && /^\d{4}-\d{2}-\d{2}$/.test(entryDate) ? { entry_date: entryDate } : {}) })
    .eq('id', updateId)
  revalidatePath(`/deals/${dealId}`)
}

export async function removeDealUpdate(dealId: string, updateId: string) {
  if (!updateId) return
  const supabase = await createClient()
  await supabase.from('deal_updates').delete().eq('id', updateId)
  revalidatePath(`/deals/${dealId}`)
}
