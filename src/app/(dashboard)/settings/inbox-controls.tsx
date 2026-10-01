'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
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

type Status = {
  readThrough: string
  hasRunBefore: boolean
  newest: { receivedDateTime: string; subject: string; from: string } | null
  waiting: number
  waitingCapped: boolean
}

// Safety stop for "read everything": 40 batches = 1,000 emails.
const MAX_BATCHES = 40

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function costRange(n: number) {
  // Most emails get only the cheap sort (<1¢); deal/lender emails ~3–5¢.
  const low = Math.max(0.01, n * 0.01)
  const high = Math.max(0.05, n * 0.05)
  return `about $${low.toFixed(2)}–$${high.toFixed(2)}`
}

async function fetchStatus(): Promise<{ status: Status } | { error: string }> {
  try {
    const parsed = await readJsonResponse<Status>(await fetch('/api/inbox/status'))
    return parsed.ok ? { status: parsed.body } : { error: parsed.message }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read the inbox status' }
  }
}

function addSummaries(a: Summary | null, b: Summary): Summary {
  if (!a) return b
  return {
    processed: a.processed + b.processed,
    newDeals: a.newDeals + b.newDeals,
    dealUpdates: a.dealUpdates + b.dealUpdates,
    lenderReplies: a.lenderReplies + b.lenderReplies,
    other: a.other + b.other,
    errors: a.errors + b.errors,
    moreWaiting: b.moreWaiting,
  }
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
  const [status, setStatus] = useState<Status | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toggling, startToggle] = useTransition()
  const stopRef = useRef(false)

  const applyStatus = useCallback((r: { status: Status } | { error: string }) => {
    if ('status' in r) {
      setStatus(r.status)
      setStatusError(null)
      return r.status
    }
    setStatusError(r.error)
    return null
  }, [])

  async function loadStatus() {
    setRefreshing(true)
    const r = await fetchStatus()
    setRefreshing(false)
    return applyStatus(r)
  }

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    fetchStatus().then((r) => {
      if (!cancelled) applyStatus(r)
    })
    return () => {
      cancelled = true
    }
  }, [connected, applyStatus])

  // Recheck: refresh the (free) status first; only ask to spend if there
  // are actually unread emails.
  async function recheck() {
    setResult(null)
    setError(null)
    const s = await loadStatus()
    if (s && s.waiting > 0) setConfirming(true)
  }

  async function run() {
    setConfirming(false)
    setRunning(true)
    setError(null)
    setResult(null)
    stopRef.current = false
    let total: Summary | null = null
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        setProgress(total ? `Read ${total.processed} so far…` : null)
        const res = await fetch('/api/inbox/sync', { method: 'POST' })
        const parsed = await readJsonResponse<Summary>(res)
        if (!parsed.ok) throw new Error(parsed.message)
        total = addSummaries(total, parsed.body)
        setResult(total)
        if (!parsed.body.moreWaiting || stopRef.current) break
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inbox check failed')
    } finally {
      setRunning(false)
      setProgress(null)
      router.refresh()
      loadStatus()
    }
  }

  if (!connected) {
    return <p className="mt-3 text-sm text-slate-400">Connect Outlook above first.</p>
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {statusError ? (
          <span className="text-red-600">{statusError}</span>
        ) : !status ? (
          <span className="text-slate-400">Checking the inbox…</span>
        ) : (
          <div className="space-y-0.5">
            <p>
              <span className="text-slate-500">Latest email in the inbox:</span>{' '}
              {status.newest ? (
                <>
                  <span className="font-medium">{when(status.newest.receivedDateTime)}</span>
                  <span className="text-slate-500">
                    {' '}
                    — {status.newest.from}: {status.newest.subject || '(no subject)'}
                  </span>
                </>
              ) : (
                'none'
              )}
            </p>
            <p>
              <span className="text-slate-500">CRM has read through:</span>{' '}
              <span className="font-medium">{when(status.readThrough)}</span>
            </p>
            {status.waiting === 0 ? (
              <p className="font-medium text-emerald-700">✓ Up to date — every email has been read.</p>
            ) : (
              <p className="font-medium text-amber-700">
                {status.waiting}
                {status.waitingCapped ? '+' : ''} email{status.waiting === 1 ? '' : 's'} not read yet.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={status?.hasRunBefore ? recheck : () => setConfirming(true)}
          disabled={running || confirming || refreshing || !status}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {running ? 'Reading emails…' : refreshing ? 'Checking…' : status?.hasRunBefore ? 'Recheck inbox' : 'Check inbox now'}
        </button>
        {running && (
          <button
            onClick={() => (stopRef.current = true)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Stop after this batch
          </button>
        )}
        {progress && <span className="text-sm text-slate-500">{progress}</span>}

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

      {confirming && status && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800">
          <p>
            {status.waiting === 0
              ? 'No unread emails right now.'
              : `${status.waiting}${status.waitingCapped ? '+' : ''} email${status.waiting === 1 ? '' : 's'} haven't been read yet (since ${when(status.readThrough)}).`}{' '}
            A cheap model sorts each one (well under 1¢); only emails that look like a deal or a lender reply get a
            full read (about 3–5¢ each). Automated senders (no-reply, notifications) are skipped for free.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={run} className="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800">
              Read all {status.waiting}
              {status.waitingCapped ? '+' : ''} ({costRange(status.waiting)})
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
          {result.moreWaiting && !running && ' Stopped with more emails still unread — click Recheck inbox to continue.'}
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
