import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runInboxSync } from '@/lib/inbox/sync'

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

  const { data: state } = await supabase.from('inbox_sync_state').select('auto_sync_enabled').eq('id', 1).single()
  if (!state?.auto_sync_enabled) {
    return NextResponse.json({ skipped: 'Auto-sync is off' })
  }

  try {
    const summary = await runInboxSync(supabase)
    return NextResponse.json(summary)
  } catch (err) {
    console.error('Scheduled inbox sync failed', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
