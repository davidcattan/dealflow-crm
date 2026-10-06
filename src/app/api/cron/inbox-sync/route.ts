import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runInboxSync, type SyncSummary } from '@/lib/inbox/sync'
import { startRun, finishRun } from '@/lib/inbox/run-log'
import { isQuietHours } from '@/lib/inbox/quiet-hours'

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

  // Paused overnight; the first run after 7am catches up.
  if (isQuietHours()) {
    return NextResponse.json({ skipped: 'Overnight pause (10pm–7am ET)' })
  }

  const supabase = createAdminClient()
  if (!supabase) {
    return NextResponse.json({ skipped: 'SUPABASE_SERVICE_ROLE_KEY is not configured' })
  }

  const { data: state } = await supabase.from('inbox_sync_state').select('auto_sync_enabled').eq('id', 1).single()
  if (!state?.auto_sync_enabled) {
    return NextResponse.json({ skipped: 'Auto-sync is off' })
  }

  // Keep reading batches until caught up, so a busy half hour never leaves
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
    return NextResponse.json(total)
  } catch (err) {
    console.error('Scheduled inbox sync failed', err)
    const message = err instanceof Error ? err.message : 'Sync failed'
    await finishRun(supabase, runId, { summary: total, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
