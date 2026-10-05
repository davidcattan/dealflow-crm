import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type InboxHealth = {
  level: 'ok' | 'waiting' | 'problem' | 'off'
  headline: string
  detail: string | null
  lastAutoAt: string | null
}

const MINUTES = 60 * 1000

// Is the 30-minute automatic inbox check actually running? Based on the
// run log the scheduled job writes each time it fires.
export async function getInboxHealth(supabase: SupabaseClient): Promise<InboxHealth> {
  const [{ data: state }, { data: lastAuto, error }] = await Promise.all([
    supabase.from('inbox_sync_state').select('auto_sync_enabled').eq('id', 1).maybeSingle(),
    supabase
      .from('inbox_sync_runs')
      .select('started_at, finished_at, summary, error')
      .eq('kind', 'auto')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!state?.auto_sync_enabled) {
    return { level: 'off', headline: 'Automatic inbox check is off', detail: 'Turn it on in Settings → Inbox.', lastAutoAt: null }
  }
  if (error || !lastAuto) {
    return {
      level: 'waiting',
      headline: 'Waiting for the first automatic check',
      detail: 'It runs every 30 minutes, on the hour and half hour.',
      lastAutoAt: null,
    }
  }

  const age = Date.now() - new Date(lastAuto.started_at).getTime()
  if (!lastAuto.finished_at && age > 15 * MINUTES) {
    return {
      level: 'problem',
      headline: 'The last automatic check stopped partway',
      detail: 'It will pick up where it left off on the next run. If this keeps showing, tell Claude.',
      lastAutoAt: lastAuto.started_at,
    }
  }
  if (age > 45 * MINUTES) {
    return {
      level: 'problem',
      headline: 'Automatic check has stopped running',
      detail: 'Check that CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY are set in Vercel (Production), then redeploy.',
      lastAutoAt: lastAuto.started_at,
    }
  }
  if (lastAuto.error) {
    return { level: 'problem', headline: 'Last automatic check hit an error', detail: lastAuto.error, lastAutoAt: lastAuto.started_at }
  }
  return {
    level: 'ok',
    headline: 'Automatic inbox check is working',
    detail: lastAuto.finished_at ? (lastAuto.summary ?? 'No new emails') : 'Checking right now…',
    lastAutoAt: lastAuto.started_at,
  }
}
