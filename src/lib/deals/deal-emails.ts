import type { SupabaseClient } from '@supabase/supabase-js'

export type DealEmail = {
  id: string
  from_email: string | null
  subject: string | null
  received_at: string | null
  classification: string
  summary: string | null
  body_text: string | null
  mailbox?: string | null
}

// Emails the inbox reader filed on this deal, newest first.
export async function loadDealEmails(supabase: SupabaseClient, dealId: string, limit = 20): Promise<DealEmail[]> {
  const { data, error } = await supabase
    .from('inbox_messages')
    .select('id, from_email, subject, received_at, classification, summary, body_text, mailbox')
    .eq('deal_id', dealId)
    .order('received_at', { ascending: false })
    .limit(limit)
  if (!error) return (data ?? []) as DealEmail[]
  // body_text missing (migration 019 not run yet): fall back to summaries.
  const { data: fallback } = await supabase
    .from('inbox_messages')
    .select('id, from_email, subject, received_at, classification, summary')
    .eq('deal_id', dealId)
    .order('received_at', { ascending: false })
    .limit(limit)
  return ((fallback ?? []) as Omit<DealEmail, 'body_text'>[]).map((e) => ({ ...e, body_text: null }))
}

// Plain-text block for the AI: oldest first so the story reads in order.
// Uses the full email when stored, otherwise the AI summary.
export function emailsToText(emails: DealEmail[], maxChars = 30000): string | null {
  if (emails.length === 0) return null
  const parts: string[] = []
  let used = 0
  for (const e of [...emails].reverse()) {
    const date = e.received_at ? e.received_at.slice(0, 10) : 'undated'
    const body = e.body_text?.trim() || (e.summary ? `[summary] ${e.summary}` : '')
    const block = `--- Email ${date} from ${e.from_email ?? 'unknown'}: "${e.subject ?? ''}"\n${body}`
    if (used + block.length > maxChars) break
    parts.push(block)
    used += block.length
  }
  return `Emails about this deal (from the inbox, oldest first). Treat facts in them like document facts and cite "email" as the source:\n${parts.join('\n\n')}`
}
