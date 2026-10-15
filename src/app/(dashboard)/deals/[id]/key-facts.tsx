'use client'

import { useState, useTransition } from 'react'
import type { KeyFacts as Facts } from '@/lib/deals/key-facts'
import { refreshKeyFacts, removeKeyFact, saveKeyFact } from './key-facts-actions'

function FactEditor({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: { label: string; value: string }
  onSave: (label: string, value: string) => void
  onCancel: () => void
  saving: boolean
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [value, setValue] = useState(initial?.value ?? '')
  return (
    <div data-enter-save className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-2 sm:col-span-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Property address" className="w-44 rounded border border-slate-300 px-2 py-1 text-sm" />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" autoFocus={Boolean(initial)} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
      <button type="button" data-save disabled={saving} onClick={() => onSave(label, value)} className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
        Save
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:underline">
        Cancel
      </button>
    </div>
  )
}

// The few facts that matter for this deal, with where each came from.
export function KeyFacts({ dealId, keyFacts, at }: { dealId: string; keyFacts: Facts | null; at: string | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null) // a label, or '__new'
  const [pending, start] = useTransition()
  const facts = keyFacts?.facts ?? []

  async function refresh() {
    setBusy(true)
    setError(null)
    const res = await refreshKeyFacts(dealId)
    if ('error' in res && res.error) setError(res.error)
    setBusy(false)
  }
  const save = (oldLabel: string | null, label: string, value: string) =>
    start(async () => {
      const res = await saveKeyFact(dealId, oldLabel, label, value)
      if ('error' in res && res.error) setError(res.error)
      else setEditing(null)
    })

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {at ? `Read from the docs, emails, calls and notes · updated ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Pulled from the docs, emails, calls and notes'}
        </p>
        <div className="flex items-center gap-3 text-xs">
          <button type="button" onClick={() => setEditing('__new')} className="text-slate-600 hover:underline">
            + Add fact
          </button>
          <button type="button" onClick={refresh} disabled={busy} title="The AI reads the deal again — a few cents" className="text-slate-600 hover:underline disabled:opacity-50">
            {busy ? 'Reading the deal…' : facts.length ? '↻ Refresh' : '✨ Find key facts (a few cents)'}
          </button>
        </div>
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {facts.length === 0 && editing !== '__new' ? (
        <p className="text-sm text-slate-400">
          Nothing yet. Click <span className="font-medium text-slate-600">Find key facts</span> — it pulls things like the property address, value and liens (or revenue, AR and
          current lender) from everything on this deal. New documents update it automatically.
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {facts.map((f) =>
            editing === f.label ? (
              <FactEditor key={f.label} initial={f} saving={pending} onCancel={() => setEditing(null)} onSave={(l, v) => save(f.label, l, v)} />
            ) : (
              <div key={f.label} className="group min-w-0">
                <dt className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  {f.label}
                  <span className="hidden gap-2 group-hover:flex">
                    <button type="button" onClick={() => setEditing(f.label)} className="font-normal text-slate-400 hover:text-slate-700">
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => start(async () => void (await removeKeyFact(dealId, f.label)))}
                      className="font-normal text-slate-400 hover:text-red-600"
                    >
                      remove
                    </button>
                  </span>
                </dt>
                <dd className="text-slate-800 [overflow-wrap:anywhere]">
                  {f.value}
                  <span className="ml-1.5 text-[11px] text-slate-400">— {f.source}</span>
                </dd>
              </div>
            )
          )}
          {editing === '__new' && <FactEditor saving={pending} onCancel={() => setEditing(null)} onSave={(l, v) => save(null, l, v)} />}
        </dl>
      )}

      {(keyFacts?.missing ?? []).length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          Still missing:
          {keyFacts!.missing.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setEditing('__new')}
              title="Add it yourself"
              className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 hover:bg-amber-100"
            >
              {m}
            </button>
          ))}
        </p>
      )}
    </section>
  )
}
