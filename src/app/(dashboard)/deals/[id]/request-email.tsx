'use client'

import { useState } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'

export type Recipient = { label: string; name: string | null; email: string }

// "Draft request email": a short note to the borrower (or broker) listing
// what's still needed, put in Outlook Drafts to review and send. Free — no AI.
export function RequestEmail({
  dealId,
  dealName,
  items,
  recipients,
  mailboxId,
}: {
  dealId: string
  dealName: string
  items: string[]
  recipients: Recipient[]
  mailboxId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState<Recipient>(recipients[0] ?? { label: '', name: null, email: '' })
  const [picked, setPicked] = useState<string[]>(items)
  const [subject, setSubject] = useState(`${dealName} — items needed to move forward`)
  const [edited, setEdited] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)

  const firstName = (to.name ?? '').trim().split(/\s+/)[0]
  const composed = [
    `Hi${firstName ? ` ${firstName}` : ''},`,
    '',
    'Thanks for sending this over. To move forward with lenders, could you please send the following:',
    '',
    ...picked.map((it, i) => `${i + 1}. ${it}`),
    '',
    'Thanks,',
  ].join('\n')
  const body = edited ?? composed

  async function create() {
    setState('busy')
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/request-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: { name: to.name, email: to.email }, subject, body, connectionId: mailboxId }),
      })
      const result = await readJsonResponse<{ webLink?: string }>(res)
      if (!result.ok) throw new Error(result.message)
      setLink(result.body.webLink ?? null)
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t create the draft')
      setState('idle')
    }
  }

  if (items.length === 0) return null
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
      >
        ✉️ Draft request email
      </button>
    )
  }

  const input = 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm'
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <div>
        <p className="text-xs font-medium text-slate-600">To</p>
        {recipients.length > 1 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {recipients.map((r) => (
              <button
                key={r.email}
                type="button"
                onClick={() => setTo(r)}
                className={`rounded-full px-2.5 py-1 text-xs ${to.email === r.email ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          <input value={to.name ?? ''} onChange={(e) => setTo({ ...to, name: e.target.value })} placeholder="Name" className={input} />
          <input value={to.email} onChange={(e) => setTo({ ...to, email: e.target.value })} placeholder="Email" className={input} />
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-600">What to ask for</p>
        <ul className="mt-1 space-y-1">
          {items.map((it) => (
            <li key={it}>
              <label className="flex items-start gap-2 text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={picked.includes(it)}
                  onChange={(e) => {
                    setEdited(null)
                    setPicked(e.target.checked ? items.filter((x) => x === it || picked.includes(x)) : picked.filter((x) => x !== it))
                  }}
                />
                {it}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <label className="block text-xs font-medium text-slate-600">
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`mt-1 ${input}`} />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Email <span className="font-normal text-slate-400">(your signature is added at the end)</span>
        <textarea
          data-enter="off"
          value={body}
          onChange={(e) => setEdited(e.target.value)}
          rows={Math.min(14, body.split('\n').length + 1)}
          className={`mt-1 ${input}`}
        />
      </label>
      {state === 'done' ? (
        <p className="text-emerald-700">
          Draft created in Outlook ✓{' '}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="underline">
              Open it
            </a>
          )}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={create}
            disabled={state === 'busy' || picked.length === 0 || !to.email}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {state === 'busy' ? 'Creating…' : 'Create draft in Outlook'}
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(body)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Copy text
          </button>
          <button type="button" onClick={() => setOpen(false)} className="px-2 py-1.5 text-sm text-slate-500 hover:underline">
            Close
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
    </div>
  )
}
