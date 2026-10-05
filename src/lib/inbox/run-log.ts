import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncSummary } from './sync'

// Records one inbox check (automatic or manual) for the status display.
// Best-effort: a logging problem never stops the check itself.
export async function startRun(supabase: SupabaseClient, kind: 'auto' | 'manual') {
  const { data } = await supabase.from('inbox_sync_runs').insert({ kind }).select('id').single()
  return (data?.id as string | undefined) ?? null
}

export function describe(s: SyncSummary) {
  if (s.processed === 0) return 'No new emails'
  const parts = [
    s.newDeals && `${s.newDeals} new deal${s.newDeals === 1 ? '' : 's'}`,
    s.dealUpdates && `${s.dealUpdates} deal follow-up${s.dealUpdates === 1 ? '' : 's'}`,
    s.lenderReplies && `${s.lenderReplies} lender repl${s.lenderReplies === 1 ? 'y' : 'ies'}`,
    s.other && `${s.other} other`,
    s.errors && `${s.errors} error${s.errors === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return `Read ${s.processed} email${s.processed === 1 ? '' : 's'}: ${parts.join(', ')}`
}

export async function finishRun(
  supabase: SupabaseClient,
  id: string | null,
  result: { summary?: SyncSummary; error?: string }
) {
  if (!id) return
  await supabase
    .from('inbox_sync_runs')
    .update({
      finished_at: new Date().toISOString(),
      processed: result.summary?.processed ?? 0,
      summary: result.summary ? describe(result.summary) : null,
      error: result.error ?? null,
    })
    .eq('id', id)
}
