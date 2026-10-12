'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'

// For deals whose name or details are missing ("… (business name not
// stated)"): read the documents already on the deal and fill them in.
export function AutofillButton({ dealId }: { dealId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/autofill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const result = await readJsonResponse<{ changed?: string[] }>(res)
      if (!result.ok) throw new Error(result.message)
      const changed = result.body.changed ?? []
      setNote(changed.length ? `Filled in: ${changed.join('; ')}` : 'Nothing new found in the documents.')
      router.refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Couldn’t read the documents')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="Reads the first pages of the documents on this deal (costs under 1¢)"
        className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-100 disabled:opacity-50"
      >
        {busy ? 'Reading…' : '✨ Fill in from documents'}
      </button>
      {note && <span className="max-w-xs text-right text-xs text-slate-500">{note}</span>}
    </span>
  )
}
