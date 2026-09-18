'use client'

import { useTransition } from 'react'
import { updateBorrowerStage } from './actions'
import { BORROWER_STATUSES, STATUS_LABELS, type BorrowerStatus } from '@/lib/types'

export function StatusSelect({
  borrowerId,
  status,
}: {
  borrowerId: string
  status: BorrowerStatus
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value as BorrowerStatus
        startTransition(() => {
          updateBorrowerStage(borrowerId, next)
        })
      }}
      className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 disabled:opacity-50"
    >
      {BORROWER_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  )
}
