'use client'

import { useState, useTransition } from 'react'
import { setDealOwner } from '@/app/(dashboard)/todo/actions'
import { TEAM } from '@/lib/team'

// Whose deal it is — David, Eli, or both. A small pill that opens the
// phone's own picker.
export function OwnerSelect({ dealId, owner, className = '' }: { dealId: string; owner: string | null; className?: string }) {
  const [value, setValue] = useState(owner ?? '')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="relative inline-flex items-center">
      <select
        value={value}
        disabled={pending}
        aria-label="Whose deal"
        title="Whose deal is this?"
        onChange={(e) => {
          const next = e.target.value
          setValue(next)
          setError(null)
          startTransition(async () => {
            const res = await setDealOwner(dealId, next || null)
            if (res && 'error' in res && res.error) {
              setError(res.error)
              setValue(owner ?? '')
            }
          })
        }}
        className={`cursor-pointer appearance-none rounded-full border-0 py-1 pl-2.5 pr-5 text-center text-xs font-medium ring-1 disabled:opacity-50 ${
          value === 'Eli'
            ? 'bg-teal-50 text-teal-800 ring-teal-200'
            : value === 'David'
              ? 'bg-indigo-50 text-indigo-800 ring-indigo-200'
              : 'bg-white text-slate-500 ring-slate-200'
        }`}
      >
        <option value="">Both</option>
        {TEAM.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 text-[9px] text-slate-400" aria-hidden="true">▾</span>
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
