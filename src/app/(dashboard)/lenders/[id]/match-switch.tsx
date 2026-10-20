'use client'

import { useState, useTransition } from 'react'
import { setMatchExcluded } from './actions'

// "Don't match": this lender never shows up in a deal's lender matches.
export function MatchSwitch({ lenderId, excluded }: { lenderId: string; excluded: boolean }) {
  const [off, setOff] = useState(excluded)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const save = (v: boolean) =>
    startTransition(async () => {
      setError(null)
      const res = await setMatchExcluded(lenderId, v)
      if (res && 'error' in res && res.error) setError(res.error)
      else setOff(v)
    })

  return (
    <div>
      <p className="text-xs font-medium text-slate-500">Deal matching</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
        {off ? (
          <>
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Don&apos;t match</span>
            <button type="button" disabled={pending} onClick={() => save(false)} className="text-xs text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-50">
              Match again
            </button>
          </>
        ) : (
          <>
            <span className="text-slate-600">Included</span>
            <button type="button" disabled={pending} onClick={() => save(true)} className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Don&apos;t match
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}
