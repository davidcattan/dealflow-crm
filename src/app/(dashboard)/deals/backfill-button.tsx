'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'

export function BackfillButton({
  endpoint,
  label,
  missingCount,
}: {
  endpoint: string
  label: string
  missingCount: number
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ updated: number; skipped: number } | null>(null)

  if (missingCount === 0 && !result) return null

  async function run() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(endpoint, { method: 'POST' })
      const result = await readJsonResponse<{ updated: number; skipped: number }>(res)
      if (!result.ok) {
        throw new Error(result.message)
      }
      setResult(result.body)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backfill failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      {missingCount > 0 && (
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? 'Classifying…' : `${label} (${missingCount})`}
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
      {result && (
        <span className="text-xs text-slate-500">
          Filled in {result.updated}
          {result.skipped > 0 ? `, ${result.skipped} left unclear` : ''}.
        </span>
      )}
    </div>
  )
}
