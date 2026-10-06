import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TimeAgo } from '@/components/time-ago'
import { MarkSeen } from './mark-seen'

const KINDS = {
  new_deal: { label: 'New deal', icon: '＋', style: 'bg-emerald-100 text-emerald-800' },
  deal_update: { label: 'Deal updated', icon: '↻', style: 'bg-sky-100 text-sky-800' },
  lender_reply: { label: 'Lender reply', icon: '✉', style: 'bg-violet-100 text-violet-800' },
  sent: { label: 'Sent', icon: '➚', style: 'bg-slate-100 text-slate-700' },
  needs_review: { label: 'Needs a look', icon: '!', style: 'bg-amber-100 text-amber-800' },
} as const
type Kind = keyof typeof KINDS

function dayLabel(iso: string) {
  // Grouped in Eastern time so "Today" matches the team's day.
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' })
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams
  const filter = kind && kind in KINDS ? (kind as Kind) : null
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: seen } = await supabase.from('notification_seen').select('seen_at').eq('user_id', user?.id ?? '').maybeSingle()
  let query = supabase
    .from('notifications')
    .select('id, kind, title, body, deal_id, created_at')
    .order('created_at', { ascending: false })
    .limit(150)
  if (filter) query = query.eq('kind', filter)
  const { data: items, error } = await query

  const groups: { day: string; rows: NonNullable<typeof items> }[] = []
  for (const n of items ?? []) {
    const day = dayLabel(n.created_at)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.rows.push(n)
    else groups.push({ day, rows: [n] })
  }

  return (
    <div className="space-y-6">
      <MarkSeen />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Activity</h1>
        <p className="mt-1 text-sm text-slate-500">
          Everything the inbox changed: new deals, deal updates, lender replies, emails sent, and anything that needs you.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/activity"
          className={`rounded-full border px-3 py-1 ${!filter ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
        >
          All
        </Link>
        {(Object.keys(KINDS) as Kind[]).map((k) => (
          <Link
            key={k}
            href={`/activity?kind=${k}`}
            className={`rounded-full border px-3 py-1 ${filter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            {KINDS[k].label}
          </Link>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-amber-700">The activity feed isn&apos;t set up yet (run the latest Supabase step).</p>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Nothing yet. New activity shows up here as the inbox is read.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.day}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{g.day}</h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {g.rows.map((n) => {
                const k = KINDS[n.kind as Kind] ?? KINDS.deal_update
                const isNew = !seen?.seen_at || n.created_at > seen.seen_at
                return (
                  <li key={n.id} className={`flex gap-3 px-4 py-3 ${isNew ? 'bg-sky-50/60' : ''}`}>
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${k.style}`}>
                      {k.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium text-slate-900">
                          {n.deal_id ? (
                            <Link href={`/deals/${n.deal_id}`} className="hover:underline">
                              {n.title}
                            </Link>
                          ) : (
                            n.title
                          )}
                          {isNew && <span className="ml-2 rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] text-white">NEW</span>}
                        </p>
                        <span className="shrink-0 text-xs text-slate-400">
                          <TimeAgo iso={n.created_at} />
                        </span>
                      </div>
                      {n.body && <p className="mt-0.5 line-clamp-3 text-sm text-slate-600">{n.body}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
