'use client'

import { useState, useTransition } from 'react'
import { createShortcutKey, revokeShortcutKey } from './shortcut-actions'

type KeyRow = { id: string; label: string; created_at: string; last_used_at: string | null }

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

// Settings: the "Send to JED CRM" iPhone shortcut — install link, steps,
// and each person's keys.
export function ShortcutKeys({ keys, installUrl }: { keys: KeyRow[]; installUrl: string }) {
  const [label, setLabel] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="space-y-4 text-sm text-slate-700">
      <ol className="list-decimal space-y-1 pl-5 text-slate-600">
        <li>
          On your iPhone, tap <span className="font-medium">Make a key</span> below and copy it.
        </li>
        <li>
          Open{' '}
          <a href={installUrl} target="_blank" rel="noreferrer" className="font-medium text-slate-900 underline">
            the shortcut
          </a>{' '}
          (on the iPhone), tap <span className="font-medium">Add Shortcut</span>, and paste your key when it asks.
        </li>
        <li>
          Then in Voice Memos (or WhatsApp, Files…): tap a recording → <span className="font-medium">Share</span> →{' '}
          <span className="font-medium">Send to JED CRM</span> → pick the deal. The notes show up on the deal in a minute
          or two.
        </li>
      </ol>

      {newKey ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-medium text-emerald-800">Your key — copy it now, it won’t be shown again:</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 font-mono text-xs text-slate-800">{newKey}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(newKey).then(() => setCopied(true))
              }}
              className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button type="button" onClick={() => setNewKey(null)} className="text-xs text-slate-500 hover:underline">
              Done
            </button>
          </div>
        </div>
      ) : (
        <div data-enter-save className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name it, e.g. David's iPhone"
            className="min-w-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            data-save
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null)
                const res = await createShortcutKey(label)
                if ('key' in res && res.key) {
                  setNewKey(res.key)
                  setCopied(false)
                  setLabel('')
                } else setError(res.error ?? 'Couldn’t make a key')
              })
            }
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? 'Making…' : 'Make a key'}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}

      {keys.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="font-medium">{k.label}</span>
                <span className="ml-2 text-xs text-slate-400">
                  made {day(k.created_at)} · {k.last_used_at ? `last used ${day(k.last_used_at)}` : 'not used yet'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Turn off "${k.label}"? The shortcut on that phone will stop working.`))
                    startTransition(() => revokeShortcutKey(k.id))
                }}
                className="text-xs text-slate-400 hover:text-red-600"
              >
                Turn off
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
