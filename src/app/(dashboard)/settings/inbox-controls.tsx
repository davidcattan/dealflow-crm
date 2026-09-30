'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'
import { setAutoSync } from './actions'

type Summary = {
  processed: number
  newDeals: number
  dealUpdates: number
  lenderReplies: number
  other: number
  errors: number
  moreWaiting: boolean
}

export function InboxControls({
  connected,
  autoSyncEnabled,
  hasRunBefore,
}: {
  connected: boolean
  autoSyncEnabled: boolean
  hasRunBefore: boolean
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toggling, startToggle] = useTransition()

  async function run() {
    setConfirming(false)
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/inbox/sync', { method: 'POST' })
      const parsed = await readJsonResponse<Summary>(res)
      if (!parsed.ok) throw new Error(parsed.message)
      setResult(parsed.body)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inbox check failed')
    } finally {
      setRunning(false)
    }
  }

  if (!connected) {
    return <p className="mt-3 text-sm text-slate-400">Connect Outlook above first.</p>
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setConfirming(true)}
          disabled={running || confirming}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {running ? 'Checking inbox…' : 'Check inbox now'}
        </button>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={autoSyncEnabled}
            disabled={toggling || (!hasRunBefore && !autoSyncEnabled)}
            onChange={(e) => startToggle(() => setAutoSync(e.target.checked))}
            className="rounded border-slate-300"
          />
          Check automatically every 30 minutes
        </label>
        {!hasRunBefore && (
          <span className="text-xs text-slate-400">(available after the first manual check)</span>
        )}
      </div>

      {confirming && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800">
          <p>
            This reads up to 25 new emails{hasRunBefore ? ' since the last check' : ' from the last 3 days'}. A
            cheap model sorts each one (well under 1¢); only emails that look like a deal or a lender reply get a
            full read (about 3–5¢ each). A typical batch costs a few cents to about 50¢. Automated senders
            (no-reply, notifications) are skipped for free.
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={run} className="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800">
              Yes, check now
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Checked {result.processed} email{result.processed === 1 ? '' : 's'}: {result.newDeals} new deal
          {result.newDeals === 1 ? '' : 's'}, {result.dealUpdates} follow-up{result.dealUpdates === 1 ? '' : 's'} on
          existing deals, {result.lenderReplies} lender repl{result.lenderReplies === 1 ? 'y' : 'ies'},{' '}
          {result.other} other{result.errors ? `, ${result.errors} errors` : ''}.
          {result.moreWaiting && ' More emails are waiting — run it again to continue.'}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}
    </div>
  )
}
