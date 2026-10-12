'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'
import type { QuickRead } from '@/lib/quickread/schema'

// ⚡ Quick read: just the important things about a deal — what it is, key
// numbers, top watch-outs, what's missing, which lenders fit. Cheap AI call.
export function QuickReadPanel({
  dealId,
  quickRead,
  at,
  costLabel,
}: {
  dealId: string
  quickRead: QuickRead | null
  at: string | null
  costLabel: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!confirm(`Run a quick read? It uses the paid AI — ${costLabel}.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/quick-read`, { method: 'POST' })
      const result = await readJsonResponse(res)
      if (!result.ok) throw new Error(result.message)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quick read failed')
    } finally {
      setBusy(false)
    }
  }

  const button = (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        quickRead ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-900 text-white hover:bg-slate-800'
      }`}
    >
      {busy ? 'Reading…' : quickRead ? 'Refresh' : '⚡ Quick read'}
    </button>
  )

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">⚡ Quick read</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {quickRead && at
              ? `Updated ${new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
              : `Just the important things — ${costLabel}.`}
          </p>
        </div>
        {button}
      </div>
      {busy && <p className="mt-3 text-sm text-slate-500">Reading the deal… usually under a minute.</p>}
      {error && (
        <p className="mt-3 text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}

      {quickRead && (
        <div className="mt-4 space-y-4 text-sm">
          <p className="font-medium text-slate-900">{quickRead.headline}</p>

          {quickRead.key_numbers.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {quickRead.key_numbers.map((n) => (
                <div key={n.label} className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
                  <dt className="text-[11px] text-slate-500">{n.label}</dt>
                  <dd className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{n.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {quickRead.watch_outs.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase text-amber-700">Watch out</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
                {quickRead.watch_outs.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {quickRead.missing.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Still need</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
                {quickRead.missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="rounded-md bg-sky-50 px-3 py-2 text-sky-900">
            <span className="font-semibold">Fit: </span>
            {quickRead.fit}
          </p>
        </div>
      )}
    </section>
  )
}
