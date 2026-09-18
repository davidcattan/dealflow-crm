'use client'

import { useTransition } from 'react'
import { updateDealStage } from './actions'
import { DEAL_STATUSES, STATUS_LABELS, type DealStatus } from '@/lib/types'

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
      value={status}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value as DealStatus
        startTransition(() => {
          updateDealStage(dealId, next)
        })
      }}
      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 disabled:opacity-50"
    >
      {DEAL_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  )
}
