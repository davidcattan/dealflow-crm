'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { STATUS_LABELS, type DealStatus } from '@/lib/types'
import type { PossibleDuplicate } from '@/lib/deals/duplicates'
import { mergeDeals } from './actions'

type DealOption = { id: string; company_name: string; status: string }

function explain(source: string, target: string) {
  return `Merge "${source}" into "${target}"?\n\nAll documents, emails, updates and lender history move to "${target}", and "${source}" is removed. This can't be undone.`
}

// Header button: merge THIS deal into another one (this deal goes away).
export function MergeDealButton({ dealId, dealName, deals }: { dealId: string; dealName: string; deals: DealOption[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const q = query.trim().toLowerCase()
  const results = useMemo(
    () => (q ? deals.filter((d) => d.id !== dealId && d.company_name.toLowerCase().includes(q)).slice(0, 8) : []),
    [q, deals, dealId]
  )

  function merge(target: DealOption) {
    if (!confirm(explain(dealName, target.company_name))) return
    startTransition(async () => {
      const res = await mergeDeals(dealId, target.id)
      if (res?.error) setError(res.error)
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
      >
        Merge…
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="text-xs text-slate-600">
            Merge this deal into another one (for duplicates). Everything moves to the deal you pick, and this one is
            removed.
          </p>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deals…"
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          {results.length > 0 && (
            <ul className="mt-2 max-h-60 overflow-y-auto">
              {results.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => merge(d)}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    <span className="truncate">{d.company_name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{STATUS_LABELS[d.status as DealStatus] ?? d.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pending && <p className="mt-2 text-xs text-slate-500">Merging…</p>}
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

// Banner when the CRM spots likely duplicates of this deal.
export function DuplicateBanner({
  dealId,
  dealName,
  duplicates,
}: {
  dealId: string
  dealName: string
  duplicates: PossibleDuplicate[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  if (duplicates.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-800">
      <p className="font-medium">
        Possible duplicate{duplicates.length === 1 ? '' : 's'} of this deal
      </p>
      <ul className="mt-2 space-y-2">
        {duplicates.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <Link href={`/deals/${d.id}`} className="font-medium underline">
                {d.company_name}
              </Link>{' '}
              <span className="text-slate-600">— {d.reasons.join(', ')}</span>
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm(explain(d.company_name, dealName))) return
                startTransition(async () => {
                  const res = await mergeDeals(d.id, dealId)
                  if (res?.error) setError(res.error)
                })
              }}
              className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {pending ? 'Merging…' : 'Merge it into this deal'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
