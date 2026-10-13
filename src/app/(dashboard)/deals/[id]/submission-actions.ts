'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { recordSubmission } from '@/lib/deals/submissions'
import { SUBMISSION_LABELS, SUBMISSION_STATUSES, type SubmissionStatus } from '@/lib/deals/submission-status'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function refresh(dealId: string) {
  revalidatePath(`/deals/${dealId}`)
  revalidatePath('/deals')
  revalidatePath('/pipeline')
  revalidatePath('/')
}

async function logLenderNote(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dealId: string,
  lenderId: string,
  note: string
) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await supabase.from('deal_updates').insert({
    deal_id: dealId,
    lender_id: lenderId,
    entry_date: today(),
    note,
    source: 'manual',
    created_by: user?.id ?? null,
  })
}

// Marks a deal as sent to one or more existing lenders.
export async function addSubmissions(dealId: string, lenderIds: string[]) {
  if (!dealId || lenderIds.length === 0) return
  const supabase = await createClient()
  for (const lenderId of lenderIds) {
    const { data: already } = await supabase
      .from('deal_submissions')
      .select('id')
      .eq('deal_id', dealId)
      .eq('lender_id', lenderId)
      .maybeSingle()
    if (already) continue
    await recordSubmission(supabase, { dealId, lenderId })
    await logLenderNote(supabase, dealId, lenderId, 'Deal sent to this lender.')
  }
  refresh(dealId)
}

// Adds a lender that isn't in the CRM yet (name, optional email) and marks
// the deal as sent to it. Reuses an existing lender with the same name.
export async function addNewLenderSubmission(dealId: string, name: string, email: string | null) {
  const cleanName = name.trim()
  if (!dealId || !cleanName) return { error: 'Enter the lender name.' }
  const supabase = await createClient()

  const { data: existing } = await supabase.from('lenders').select('id').ilike('name', cleanName).limit(1).maybeSingle()
  let lenderId = existing?.id as string | undefined
  if (!lenderId) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { data: created, error } = await supabase
      .from('lenders')
      .insert({ name: cleanName, contact_email: email?.trim() || null, created_by: user?.id ?? null })
      .select('id')
      .single()
    if (error || !created) return { error: 'Could not add that lender. Please try again.' }
    lenderId = created.id as string
  }

  await addSubmissions(dealId, [lenderId])
  return { ok: true }
}

export async function setSubmissionStatus(dealId: string, submissionId: string, status: string) {
  if (!SUBMISSION_STATUSES.includes(status as SubmissionStatus)) return
  const supabase = await createClient()
  const { data: sub } = await supabase
    .from('deal_submissions')
    .update({ status, last_activity_at: new Date().toISOString() })
    .eq('id', submissionId)
    .select('lender_id')
    .single()
  if (sub) await logLenderNote(supabase, dealId, sub.lender_id, `Status changed to ${SUBMISSION_LABELS[status as SubmissionStatus]}.`)
  refresh(dealId)
}

export async function setSubmissionSentOn(dealId: string, submissionId: string, sentOn: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sentOn)) return
  const supabase = await createClient()
  await supabase.from('deal_submissions').update({ sent_on: sentOn }).eq('id', submissionId)
  refresh(dealId)
}

// Takes the lender off the "sent to" list. Its notes stay in the deal's
// main Updates log.
export async function removeSubmission(dealId: string, submissionId: string) {
  const supabase = await createClient()
  await supabase.from('deal_submissions').delete().eq('id', submissionId)
  refresh(dealId)
}

export async function addLenderNote(dealId: string, lenderId: string, note: string) {
  const text = note.trim()
  if (!dealId || !lenderId || !text) return
  const supabase = await createClient()
  await logLenderNote(supabase, dealId, lenderId, text)
  await supabase
    .from('deal_submissions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('deal_id', dealId)
    .eq('lender_id', lenderId)
  refresh(dealId)
}
