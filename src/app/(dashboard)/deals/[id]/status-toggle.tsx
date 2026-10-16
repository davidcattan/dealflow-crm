'use client'

import { useState, useTransition } from 'react'
import { setDealStatusQuick } from './actions'

// "Mark as dead" / "Mark as active": a real button that shows it's working,
// then says what happened.
export function StatusToggle({ dealId, isPast }: { dealId: string; isPast: boolean }) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState<string | null>(null)

  function click() {
    const form = new FormData()
    form.set('deal_id', dealId)
    form.set('status', isPast ? 'in_review' : 'dead')
    setDone(null)
    startTransition(async () => {
      await setDealStatusQuick(form)
      setDone(isPast ? '✓ Marked active' : '✓ Marked dead')
      setTimeout(() => setDone(null), 3000)
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={click}
        disabled={pending}
        className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors disabled:cursor-wait disabled:opacity-60 ${
          isPast ? 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800' : 'border border-red-300 bg-white text-red-700 hover:bg-red-50 active:bg-red-100'
        }`}
      >
        {pending ? (isPast ? 'Marking active…' : 'Marking dead…') : isPast ? 'Mark as active' : 'Mark as dead'}
      </button>
      {done && <span className="text-sm font-medium text-emerald-700">{done}</span>}
    </span>
  )
}
