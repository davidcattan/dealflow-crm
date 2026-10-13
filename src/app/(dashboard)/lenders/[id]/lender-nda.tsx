'use client'

import { useState, useTransition } from 'react'
import { setLenderNda } from './actions'

// JED's master NDA with this lender (covers every deal). Deals that need an
// NDA show "NDA ✓" for lenders with one; it never blocks contacting them.
export function LenderNda({ lenderId, signedOn }: { lenderId: string; signedOn: string | null }) {
  const [date, setDate] = useState(signedOn ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const save = (v: string | null) =>
    startTransition(async () => {
      setError(null)
      const res = await setLenderNda(lenderId, v)
      if (res && 'error' in res && res.error) setError(res.error)
      else setDate(v ?? '')
    })
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  return (
    <div>
      <p className="text-xs font-medium text-slate-500">Master NDA</p>
      {date ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Signed {new Date(`${date}T12:00:00`).toLocaleDateString()}
          </span>
          <button type="button" disabled={pending} onClick={() => confirm('Clear the master NDA date?') && save(null)} className="text-xs text-slate-400 hover:text-red-600">
            Clear
          </button>
        </div>
      ) : (
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">Not signed</span>
          <button type="button" disabled={pending} onClick={() => save(today)} className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Mark signed today
          </button>
          <input
            type="date"
            disabled={pending}
            onChange={(e) => e.target.value && save(e.target.value)}
            className="rounded border border-slate-200 px-1 py-0.5 text-xs text-slate-600"
            aria-label="Signed on"
          />
        </div>
      )}
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}
