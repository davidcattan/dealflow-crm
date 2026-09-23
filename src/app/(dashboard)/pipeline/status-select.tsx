'use client'

import { useTransition } from 'react'
import { updateDealStage } from './actions'
import { STATUS_OPTIONS, STATUS_LABELS, displayStatus, type DealStatus } from '@/lib/types'

export function StatusSelect({
  dealId,
  status,
}: {
  dealId: string
  status: DealStatus
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <select
      value={displayStatus(status)}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value as DealStatus
        startTransition(() => {
          updateDealStage(dealId, next)
        })
      }}
      className="w-full max-w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 disabled:opacity-50"
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  )
}
