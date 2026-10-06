import Link from 'next/link'
import type { InboxHealth } from '@/lib/inbox/health'

const DOT: Record<InboxHealth['level'], string> = {
  ok: 'bg-emerald-500',
  waiting: 'bg-amber-400',
  problem: 'bg-red-500',
  off: 'bg-slate-300',
  paused: 'bg-indigo-300',
}

const LABEL: Record<InboxHealth['level'], string> = {
  ok: 'Inbox: live',
  waiting: 'Inbox: starting',
  problem: 'Inbox: check',
  off: 'Inbox: off',
  paused: 'Inbox: paused overnight',
}

// Small header indicator; links to the full status in Settings.
export function InboxHealthBadge({ health }: { health: InboxHealth }) {
  return (
    <Link
      href="/settings#inbox"
      title={`${health.headline}${health.detail ? ` — ${health.detail}` : ''}`}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[health.level]} ${health.level === 'ok' ? 'animate-pulse' : ''}`} />
      {LABEL[health.level]}
    </Link>
  )
}
