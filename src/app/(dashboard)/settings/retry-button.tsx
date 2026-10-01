'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'

// Re-reads one email (about 3–5¢) — for replies that couldn't be matched
// to a deal, or emails that errored.
export function RetryButton({ messageId }: { messageId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function retry() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/inbox/messages/${messageId}/retry`, { method: 'POST' })
      const result = await readJsonResponse(res)
      if (!result.ok) throw new Error(result.message)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="mt-1 block">
      <button
        onClick={retry}
        disabled={busy}
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? 'Retrying…' : 'Retry'}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  )
}
