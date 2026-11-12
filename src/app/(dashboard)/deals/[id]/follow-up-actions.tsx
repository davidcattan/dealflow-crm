'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { logLenderFollowUp } from '../../todo/actions'

export type FollowUpInfo = { lastTouchAt: string; lastBy: 'us' | 'them'; followUpsSent: number; maxFollowUps: number }

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })

// The amber "Follow up" strip on a lender that hasn't answered in 3 days:
// draft an Outlook follow-up, log one made by phone, or stop reminding.
export function FollowUpActions({
  dealId,
  lenderId,
  lenderName,
  info,
}: {
  dealId: string
  lenderId: string
  lenderName: string
  info: FollowUpInfo
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [draftLink, setDraftLink] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const exhausted = info.followUpsSent >= info.maxFollowUps

  const log = (how: 'followed_up' | 'stop') =>
    start(async () => {
      setError(null)
      const r = await logLenderFollowUp(dealId, lenderId, lenderName, how)
      if (r.error) setError(r.error)
      else {
        setDone(how === 'stop' ? 'Reminders stopped.' : 'Logged — next reminder in 3 days.')
        router.refresh()
      }
    })

  const draft = () =>
    start(async () => {
      setError(null)
      const res = await fetch('/api/follow-ups/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId, lenderId, followUpsSent: info.followUpsSent }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setError(json.error ?? 'Could not create the draft')
      else setDraftLink(json.webLink ?? 'ok')
    })

  if (done) return <p className="mt-2 text-xs text-emerald-700">{done}</p>

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
      <p className="text-xs text-amber-900">
        <span className="font-semibold">Follow up</span> · {info.lastBy === 'them' ? 'they last wrote' : 'you last wrote'} {day(info.lastTouchAt)}
        {info.followUpsSent > 0 && ` · ${info.followUpsSent} follow-up${info.followUpsSent === 1 ? '' : 's'} sent`}
        {exhausted && ' · no answer yet, stop reminding?'}
        {draftLink && (
          <span className="text-emerald-700">
            {' '}
            · Draft is in Outlook.{' '}
            {draftLink !== 'ok' && (
              <a href={draftLink} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                Open it
              </a>
            )}
          </span>
        )}
        {error && <span className="text-red-600"> · {error}</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {!exhausted && !draftLink && (
          <button
            type="button"
            disabled={pending}
            onClick={draft}
            className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Draft email
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => log('followed_up')}
          title="You called or messaged them — restarts the 3-day clock"
          className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          Followed up
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => log('stop')}
          title="Stop reminding about this lender (comes back if they write)"
          className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          Stop
        </button>
      </div>
    </div>
  )
}
