import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Which lenders we're waiting on and should nudge. One row per deal +
// lender: the clock starts at the last email or note between us and that
// lender, and the lender is due a follow-up 3 days later (see followUpDue).
// Worked out from the deal's logged updates — no AI, free.

// Threads that went quiet before this day are left alone: the team didn't
// want reminders for old submissions (Nov 11, 2026). Anything newer counts.
export const FOLLOW_UPS_START = '2026-11-08'
// After this many follow-ups with no answer, suggest stopping instead.
export const MAX_FOLLOW_UPS = 2

export const STOP_NOTE = 'Stopped follow-up reminders'
export const FOLLOWED_UP_NOTE = 'Followed up with'
const LENDER_REPLY = /^Lender reply/i
const INACTIVE = ['dead', 'closed', 'old']
const TZ = 'America/New_York'

export type FollowUp = {
  dealId: string
  dealName: string
  owner: string | null
  lenderId: string
  lenderName: string
  // Last email or note with this lender, and who it came from.
  lastTouchAt: string
  lastBy: 'us' | 'them'
  // ET calendar date (YYYY-MM-DD) the follow-up is due.
  due: string
  // Follow-ups we've already sent since the lender last answered.
  followUpsSent: number
  status: string
}

// A timestamp's calendar date in New York.
export function etDate(iso: string | Date) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() // 0 Sun … 6 Sat

// Three days after the last touch, with the weekend counting as one day,
// and never on a weekend: Mon → Thu, Tue → Fri, Wed → Mon, Thu → Mon,
// Fri → Tue.
export function followUpDue(lastTouch: string | Date) {
  let day = etDate(lastTouch)
  let counted = 0
  while (counted < 3) {
    day = addDays(day, 1)
    if (weekday(day) === 6) continue
    counted++
  }
  if (weekday(day) === 0) day = addDays(day, 1)
  return day
}

type DealRow = { id: string; company_name: string; status: string; owner?: string | null }

// Every lender follow-up that's due today or earlier, oldest first.
export async function loadFollowUps(supabase: SupabaseClient, today = etDate(new Date())): Promise<FollowUp[]> {
  // Works before the owner column exists (migration 037).
  const withOwner = await supabase.from('deals').select('id, company_name, status, owner')
  const dealRows = (
    withOwner.error ? (await supabase.from('deals').select('id, company_name, status')).data : withOwner.data
  ) as DealRow[] | null
  const deals = new Map((dealRows ?? []).filter((d) => !INACTIVE.includes(d.status)).map((d) => [d.id, d]))
  if (!deals.size) return []

  // Only lenders still deciding: "sent" (waiting on them) and "interested"
  // (when we answered last). Asked-for-info, term sheets and passes are
  // handled elsewhere.
  const { data: subs } = await supabase
    .from('deal_submissions')
    .select('deal_id, lender_id, status, last_activity_at, lenders(name)')
    .in('status', ['sent', 'interested'])
    .in('deal_id', [...deals.keys()])
  if (!subs?.length) return []

  // Everything logged with a lender since the start day (emails both ways,
  // calls and notes), newest first.
  const since = new Date(`${FOLLOW_UPS_START}T00:00:00-05:00`).toISOString()
  const { data: updates } = await supabase
    .from('deal_updates')
    .select('deal_id, lender_id, note, created_at')
    .in('deal_id', [...deals.keys()])
    .not('lender_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000)
  const byPair = new Map<string, { note: string; created_at: string }[]>()
  for (const u of updates ?? []) {
    const key = `${u.deal_id}|${u.lender_id}`
    byPair.set(key, [...(byPair.get(key) ?? []), { note: String(u.note ?? ''), created_at: u.created_at as string }])
  }

  const out: FollowUp[] = []
  for (const s of subs) {
    const deal = deals.get(s.deal_id as string)
    if (!deal) continue
    const history = byPair.get(`${s.deal_id}|${s.lender_id}`) ?? []
    const latest = history[0]
    // Nothing since the start day: an old thread, left alone.
    if (!latest) continue
    if (latest.note.startsWith(STOP_NOTE)) continue
    const lastBy = LENDER_REPLY.test(latest.note) ? 'them' : 'us'
    // An interested lender who spoke last is waiting on us, not the other way.
    if (s.status === 'interested' && lastBy === 'them') continue
    const due = followUpDue(latest.created_at)
    if (due > today) continue
    const lastReply = history.findIndex((h) => LENDER_REPLY.test(h.note))
    const ours = (lastReply === -1 ? history : history.slice(0, lastReply)).filter((h) => !h.note.startsWith(STOP_NOTE))
    const lender = (Array.isArray(s.lenders) ? s.lenders[0] : s.lenders) as { name?: string } | null
    out.push({
      dealId: deal.id,
      dealName: deal.company_name,
      owner: deal.owner ?? null,
      lenderId: s.lender_id as string,
      lenderName: lender?.name ?? 'Lender',
      lastTouchAt: latest.created_at,
      lastBy,
      due,
      // The first email after their answer (or the original send) isn't a follow-up.
      followUpsSent: Math.max(0, ours.length - (lastReply === -1 ? 1 : 0)),
      status: s.status as string,
    })
  }
  return out.sort((a, b) => a.lastTouchAt.localeCompare(b.lastTouchAt))
}

// Once a morning: "N lenders to follow up today" on the notification bell.
// Called by the inbox cron; does nothing after the first run of the day.
export async function notifyFollowUpsOnce(supabase: SupabaseClient) {
  const { notify } = await import('@/lib/notifications')
  const today = etDate(new Date())
  const startOfDay = new Date(`${today}T00:00:00-05:00`).toISOString()
  const { data: sent } = await supabase
    .from('notifications')
    .select('id')
    .like('title', 'Follow up today:%')
    .gte('created_at', startOfDay)
    .limit(1)
  if (sent?.length) return
  const due = await loadFollowUps(supabase, today)
  if (!due.length) return
  const list = due.slice(0, 8).map((f) => `${f.dealName} → ${f.lenderName}`)
  await notify(supabase, {
    kind: 'needs_review',
    title: `Follow up today: ${due.length} lender${due.length === 1 ? '' : 's'}`,
    body: `${list.join('; ')}${due.length > list.length ? `; +${due.length - list.length} more` : ''}. See To do.`,
  })
}
