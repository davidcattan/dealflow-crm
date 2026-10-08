'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'

// "Add to deal" for an email the inbox couldn't place (free).
export function AssignToDeal({ messageId, deals }: { messageId: string; deals: { id: string; name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const results = useMemo(() => (q ? deals.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 8) : deals.slice(0, 8)), [q, deals])

  async function assign(dealId: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/inbox/messages/${messageId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId }),
      })
      const parsed = await readJsonResponse(res)
      if (!parsed.ok) throw new Error(parsed.message)
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not file the email')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
      >
        Add to deal
      </button>
    )
  }
  return (
    <div className="mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search deals…"
        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <ul className="mt-1 max-h-48 overflow-y-auto">
        {results.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => assign(d.id)}
              className="block w-full truncate rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {d.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center justify-between">
        {busy ? <span className="text-xs text-slate-500">Filing…</span> : <span />}
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
