'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { logLenderFollowUp } from './actions'

export type LenderFollowUpItem = {
  dealId: string
  dealName: string
  lenderId: string
  lenderName: string
  lastTouchAt: string
  lastBy: 'us' | 'them'
  followUpsSent: number
  maxFollowUps: number
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })

function Row({ item, onGone }: { item: LenderFollowUpItem; onGone: (key: string, msg: string) => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [draftLink, setDraftLink] = useState<string | null>(null)
  const key = `${item.dealId}|${item.lenderId}`
  const exhausted = item.followUpsSent >= item.maxFollowUps

  const log = (how: 'followed_up' | 'stop') =>
    start(async () => {
      setError(null)
      const r = await logLenderFollowUp(item.dealId, item.lenderId, item.lenderName, how)
      if (r.error) setError(r.error)
      else onGone(key, how === 'stop' ? `Stopped reminders for ${item.lenderName}` : `Logged follow-up with ${item.lenderName}`)
    })

  const draft = () =>
    start(async () => {
      setError(null)
      const res = await fetch('/api/follow-ups/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: item.dealId, lenderId: item.lenderId, followUpsSent: item.followUpsSent }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setError(json.error ?? 'Could not create the draft')
      else setDraftLink(json.webLink ?? 'ok')
    })

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">
            <Link href={`/deals/${item.dealId}`} className="hover:underline">
              {item.dealName}
            </Link>
            <span className="text-slate-400"> → </span>
            {item.lenderName}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {item.lastBy === 'them' ? 'They last wrote' : 'You last wrote'} {day(item.lastTouchAt)}
            {item.followUpsSent > 0 && ` · ${item.followUpsSent} follow-up${item.followUpsSent === 1 ? '' : 's'} sent`}
          </p>
          {exhausted && (
            <p className="mt-0.5 text-xs text-amber-700">No answer after {item.followUpsSent} follow-ups. Stop reminding?</p>
          )}
          {draftLink && (
            <p className="mt-1 text-xs text-emerald-700">
              Draft is in your Outlook Drafts.{' '}
              {draftLink !== 'ok' && (
                <a href={draftLink} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                  Open it
                </a>
              )}
            </p>
          )}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
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
            className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            Followed up
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => log('stop')}
            title="Stop reminding about this lender (comes back if they write)"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 disabled:opacity-50 ${exhausted ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'text-slate-500 ring-slate-200 hover:bg-slate-50'}`}
          >
            Stop
          </button>
        </div>
      </div>
    </li>
  )
}

// "Lenders to follow up": one row per lender that hasn't answered in 3 days.
export function LenderFollowUps({ items }: { items: LenderFollowUpItem[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const shown = items.filter((i) => !gone.has(`${i.dealId}|${i.lenderId}`))
  if (!shown.length && !notice) return null
  return (
    <section>
      <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Lenders to follow up <span className="font-normal text-slate-400">· {shown.length}</span>
      </h2>
      {shown.length > 0 ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
          {shown.map((i) => (
            <Row
              key={`${i.dealId}|${i.lenderId}`}
              item={i}
              onGone={(key, msg) => {
                setGone((g) => new Set(g).add(key))
                setNotice(msg)
              }}
            />
          ))}
        </ul>
      ) : null}
      {notice && <p className="mt-1 px-1 text-xs text-emerald-700">{notice}</p>}
    </section>
  )
}
