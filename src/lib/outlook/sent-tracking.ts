import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findSentInConversation, getValidAccessToken, listConnections } from './graph'
import { recordSubmission } from '@/lib/deals/submissions'

// Notices CRM-created Outlook drafts that have since been sent: looks for
// the thread in the mailbox's Sent Items, then puts the lender on the
// deal's "Lenders sent to" list (with the real send date), logs it, and
// moves the deal to Submitted. Outlook lookups only — no AI, free.
export async function detectSentDrafts(supabase: SupabaseClient, dealId?: string) {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  let query = supabase
    .from('deal_matches')
    .select('deal_id, lender_id, outlook_conversation_id, outlook_draft_connection_id, lenders(name)')
    .not('outlook_conversation_id', 'is', null)
    .gte('outlook_draft_created_at', since)
  if (dealId) query = query.eq('deal_id', dealId)
  const { data: drafts } = await query
  if (!drafts?.length) return 0

  // Skip lenders already on the deal's sent list.
  const { data: existing } = await supabase
    .from('deal_submissions')
    .select('deal_id, lender_id')
    .in('deal_id', [...new Set(drafts.map((d) => d.deal_id))])
  const have = new Set((existing ?? []).map((r) => `${r.deal_id}|${r.lender_id}`))
  const pending = drafts.filter((d) => !have.has(`${d.deal_id}|${d.lender_id}`))
  if (!pending.length) return 0

  const connections = await listConnections(supabase)
  const tokens = new Map<string, string | null>()
  const tokenFor = async (id: string) => {
    if (!tokens.has(id)) {
      try {
        tokens.set(id, (await getValidAccessToken(supabase, id)).accessToken)
      } catch {
        tokens.set(id, null)
      }
    }
    return tokens.get(id) ?? null
  }

  let found = 0
  for (const d of pending) {
    // The mailbox it was drafted in; older drafts didn't record it, so try each.
    const ids = d.outlook_draft_connection_id ? [d.outlook_draft_connection_id as string] : connections.map((c) => c.id)
    for (const id of ids) {
      const token = await tokenFor(id)
      if (!token) continue
      let sent: Awaited<ReturnType<typeof findSentInConversation>> = null
      try {
        sent = await findSentInConversation(token, d.outlook_conversation_id as string)
      } catch {
        continue
      }
      if (!sent) continue
      const lender = Array.isArray(d.lenders) ? d.lenders[0] : d.lenders
      await recordSubmission(supabase, {
        dealId: d.deal_id,
        lenderId: d.lender_id,
        conversationId: d.outlook_conversation_id as string,
        sentOn: sent.sentDateTime.slice(0, 10),
      })
      await supabase.from('deal_updates').insert({
        deal_id: d.deal_id,
        lender_id: d.lender_id,
        entry_date: sent.sentDateTime.slice(0, 10),
        note: `Submission email sent to ${(lender as { name?: string } | null)?.name ?? 'lender'}: "${sent.subject}".`,
        source: 'email',
      })
      found++
      break
    }
  }
  return found
}
