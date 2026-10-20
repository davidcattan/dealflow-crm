import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { SUBMISSION_LABELS, SUBMISSION_STATUSES, type SubmissionStatus } from './submission-status'

const MODEL = 'claude-haiku-5-5'

const NoteActions = z.object({
  status: z
    .enum(SUBMISSION_STATUSES)
    .nullable()
    .describe('The lender’s new status on this deal if the note clearly says so (e.g. "they passed" → declined, "sent a term sheet" → term_sheet); else null.'),
  not_on_this_deal: z
    .boolean()
    .describe('True only if the note says this firm isn’t actually a lender on this deal (e.g. it is advising, or was listed by mistake).'),
  not_a_lender: z
    .boolean()
    .describe('True only if the note says this firm is not a lender at all (e.g. an advisor, consultant or referral partner, "not lenders in general").'),
})

// Reads a note someone added on a lender in a deal's "Lenders sent to" and
// makes the change it describes: the lender's status on the deal, taking it
// off the deal, or marking the firm as not a lender at all. Returns what
// changed, in plain words (empty when the note is just a note).
export async function applyLenderNote(supabase: SupabaseClient, dealId: string, lenderId: string, note: string): Promise<string[]> {
  const [{ data: lender }, { data: sub }] = await Promise.all([
    supabase.from('lenders').select('name').eq('id', lenderId).single(),
    supabase.from('deal_submissions').select('id, status').eq('deal_id', dealId).eq('lender_id', lenderId).maybeSingle(),
  ])
  if (!lender) return []

  const res = await new Anthropic().messages.parse({
    model: MODEL,
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `A loan broker keeps a list of lenders each deal was sent to. On this deal, "${lender.name}" is listed${sub ? ` with status "${sub.status}"` : ''}. Someone on the team added this note about ${lender.name}:\n\n"${note}"\n\nSay only what the note clearly states. Most notes are just updates and change nothing.`,
      },
    ],
    output_config: { format: zodOutputFormat(NoteActions) },
  })
  await logUsage({ feature: 'lender-note', model: MODEL, dealId, usage: res.usage, supabase })
  const act = res.parsed_output
  if (!act) return []

  const done: string[] = []
  // Before migration 047 the mark can't be saved; then only this deal changes.
  const marked = act.not_a_lender && !(await supabase.from('lenders').update({ is_lender: false }).eq('id', lenderId)).error
  if (marked) done.push(`Marked ${lender.name} as not a lender — it won’t be matched or logged as a lender`)
  if (marked) {
    // Not a lender anywhere: off every deal's "Lenders sent to".
    const { data: gone } = await supabase.from('deal_submissions').delete().eq('lender_id', lenderId).select('id')
    if (gone?.length) done.push(`Took ${lender.name} off “Lenders sent to”${gone.length > 1 ? ` on ${gone.length} deals` : ''}`)
  } else if ((act.not_on_this_deal || act.not_a_lender) && sub) {
    await supabase.from('deal_submissions').delete().eq('id', sub.id)
    done.push(`Took ${lender.name} off “Lenders sent to”`)
  } else if (act.status && sub && act.status !== sub.status) {
    await supabase
      .from('deal_submissions')
      .update({ status: act.status, last_activity_at: new Date().toISOString() })
      .eq('id', sub.id)
    done.push(`Moved ${lender.name} to “${SUBMISSION_LABELS[act.status as SubmissionStatus]}”`)
  }
  return done
}
