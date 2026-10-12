'use client'

import { useState, useTransition } from 'react'
import { moveDocumentToDeal, moveEmailToDeal } from './actions'

export type DealChoice = { id: string; name: string; past: boolean }

// "Move to another deal…" for a misfiled email or document. Active deals
// first, past deals after.
export function MoveToDeal({
  kind,
  dealId,
  itemId,
  deals,
}: {
  kind: 'email' | 'document'
  dealId: string
  itemId: string
  deals: DealChoice[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const others = deals.filter((d) => d.id !== dealId)

  function move(toDealId: string) {
    if (!toDealId) return
    const name = others.find((d) => d.id === toDealId)?.name ?? 'that deal'
    if (!confirm(`Move this ${kind} to ${name}?`)) return
    setError(null)
    startTransition(async () => {
      const res = kind === 'email' ? await moveEmailToDeal(dealId, itemId, toDealId) : await moveDocumentToDeal(dealId, itemId, toDealId)
      if (res && 'error' in res && res.error) setError(res.error)
    })
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value=""
        disabled={pending}
        onChange={(e) => move(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[10rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600"
        aria-label="Move to another deal"
      >
        <option value="">{pending ? 'Moving…' : 'Move to deal…'}</option>
        <optgroup label="Active deals">
          {others
            .filter((d) => !d.past)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </optgroup>
        <optgroup label="Past deals">
          {others
            .filter((d) => d.past)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </optgroup>
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
