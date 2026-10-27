import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runInboxSync, type SyncSummary } from '@/lib/inbox/sync'
import { startRun, finishRun } from '@/lib/inbox/run-log'
import { isQuietHours } from '@/lib/inbox/quiet-hours'
import { advancePendingCalls } from '@/lib/calls/process'
import { refreshStaleKeyFacts } from '@/lib/deals/key-facts'
import { readPendingLenderDocuments } from '@/lib/lenders/tear-sheet'
import { removeDuplicateDocuments } from '@/lib/deals/duplicate-documents'

// Needs Fluid Compute on Vercel Pro (max 800s).
export const maxDuration = 800

// Called by Vercel Cron on a schedule (see vercel.json). Vercel sends
// "Authorization: Bearer $CRON_SECRET" automatically once CRON_SECRET is
// set, so nobody else can trigger it. Does nothing until auto-sync is
// switched on in Settings.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  if (!supabase) {
    return NextResponse.json({ skipped: 'SUPABASE_SERVICE_ROLE_KEY is not configured' })
  }

  // Finish any recorded calls still processing (cheap; runs even overnight).
  await advancePendingCalls(supabase).catch((err) => console.error('Pending calls failed', err))
  // Read lender tear sheets that came in by email (a few each run).
  await readPendingLenderDocuments(supabase).catch((err) => console.error('Lender documents failed', err))
  // The same file saved twice on a deal (email + Mac folder + drag and drop).
  await removeDuplicateDocuments(supabase, { sinceHours: 24 }).catch((err) => console.error('Duplicate documents failed', err))

  // Paused overnight; the first run after 7am catches up.
  if (isQuietHours()) {
    return NextResponse.json({ skipped: 'Overnight pause (10pm–7am ET)' })
  }

  const { data: state } = await supabase.from('inbox_sync_state').select('auto_sync_enabled').eq('id', 1).single()
  if (!state?.auto_sync_enabled) {
    return NextResponse.json({ skipped: 'Auto-sync is off' })
  }

  // Runs every 5 minutes: if the previous check is still going (a big batch),
  // let it finish instead of reading the same emails twice. A run that died
  // without finishing stops counting after 15 minutes.
  const { data: busy } = await supabase
    .from('inbox_sync_runs')
    .select('id')
    .is('finished_at', null)
    .gte('started_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .limit(1)
  if (busy?.length) return NextResponse.json({ skipped: 'Previous check still running' })

  // Keep reading batches until caught up, so a busy stretch never leaves
  // mail behind. Stop starting new batches after ~6 minutes to stay well
  // inside maxDuration; progress is saved per email, so the next run
  // continues exactly where this one stopped.
  const startedAt = Date.now()
  const runId = await startRun(supabase, 'auto')
  const total: SyncSummary = { processed: 0, newDeals: 0, dealUpdates: 0, lenderReplies: 0, other: 0, errors: 0, moreWaiting: false }
  try {
    let batch: SyncSummary
    do {
      batch = await runInboxSync(supabase)
      for (const k of ['processed', 'newDeals', 'dealUpdates', 'lenderReplies', 'other', 'errors'] as const) total[k] += batch[k]
      total.moreWaiting = batch.moreWaiting
    } while (batch.moreWaiting && Date.now() - startedAt < 6 * 60 * 1000)
    await finishRun(supabase, runId, { summary: total })
    // Then bring a few deals' key facts and next steps up to date with what
    // just came in (a few cents each).
    const refreshed = await refreshStaleKeyFacts(supabase, 8).catch(() => 0)
    return NextResponse.json({ ...total, keyFactsRefreshed: refreshed })
  } catch (err) {
    console.error('Scheduled inbox sync failed', err)
    const message = err instanceof Error ? err.message : 'Sync failed'
    await finishRun(supabase, runId, { summary: total, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
