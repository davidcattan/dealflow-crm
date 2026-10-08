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
  // Every deal (active first), scrollable; typing just narrows it down.
  const results = useMemo(() => (q ? deals.filter((d) => d.name.toLowerCase().includes(q)) : deals), [q, deals])

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
    <div className="mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Scroll or type to search…"
        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <ul className="mt-1 max-h-64 overflow-y-auto overscroll-contain">
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

// For a lender reply already on a deal but not tied to a lender: recognize
// the lender from the sender and add it to the deal's "Lenders sent to".
export function LinkLender({ messageId, dealId }: { messageId: string; dealId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  return (
    <span className="mt-1 block">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setNote(null)
          try {
            const res = await fetch(`/api/inbox/messages/${messageId}/assign`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dealId }),
            })
            const parsed = await readJsonResponse<{ action: string }>(res)
            if (!parsed.ok) throw new Error(parsed.message)
            if (!/added to/.test(parsed.body.action)) setNote("Couldn't tell which lender — add it on the deal with + Add lenders.")
            router.refresh()
          } catch (err) {
            setNote(err instanceof Error ? err.message : 'Failed')
          } finally {
            setBusy(false)
          }
        }}
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? 'Linking…' : 'Link lender'}
      </button>
      {note && <span className="ml-2 text-xs text-amber-700">{note}</span>}
    </span>
  )
}
