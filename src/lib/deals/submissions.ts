import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SubmissionStatus } from './submission-status'

// Stages before "submitted": sending a deal to a lender moves it forward.
const BEFORE_SUBMITTED = ['new', 'in_review', 'underwritten', 'matched', 'old']

// Records that a deal went to a lender (or that the lender responded).
// Creates the submission if it doesn't exist; otherwise bumps its activity
// time and, when given, its status. Moves the deal itself to Submitted if it
// was at an earlier stage. Returns true if the deal's status changed.
export async function recordSubmission(
  supabase: SupabaseClient,
  {
    dealId,
    lenderId,
    status,
    conversationId,
  }: { dealId: string; lenderId: string; status?: SubmissionStatus; conversationId?: string | null }
) {
  const now = new Date().toISOString()
  const { data: existing } = await supabase
    .from('deal_submissions')
    .select('id, outlook_conversation_id')
    .eq('deal_id', dealId)
    .eq('lender_id', lenderId)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('deal_submissions')
      .update({
        last_activity_at: now,
        ...(status ? { status } : {}),
        ...(conversationId && !existing.outlook_conversation_id ? { outlook_conversation_id: conversationId } : {}),
      })
      .eq('id', existing.id)
  } else {
    // Carry over the Outlook thread if the CRM drafted the email.
    const { data: match } = await supabase
      .from('deal_matches')
      .select('outlook_conversation_id')
      .eq('deal_id', dealId)
      .eq('lender_id', lenderId)
      .not('outlook_conversation_id', 'is', null)
      .limit(1)
      .maybeSingle()
    await supabase.from('deal_submissions').insert({
      deal_id: dealId,
      lender_id: lenderId,
      status: status ?? 'sent',
      outlook_conversation_id: conversationId ?? match?.outlook_conversation_id ?? null,
      last_activity_at: now,
    })
  }

  const { data: deal } = await supabase.from('deals').select('status').eq('id', dealId).single()
  if (deal && BEFORE_SUBMITTED.includes(deal.status)) {
    await supabase.from('deals').update({ status: 'submitted' }).eq('id', dealId)
    return { movedFrom: deal.status as string }
  }
  return { movedFrom: null }
}
