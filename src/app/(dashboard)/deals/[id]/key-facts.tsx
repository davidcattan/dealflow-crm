'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import type { KeyFacts as Facts, KeyFact } from '@/lib/deals/key-facts'
import { useSetTab } from '@/components/phone-tabs'
import { getFactSource, refreshKeyFacts, removeKeyFact, saveKeyFact } from './key-facts-actions'

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
    <div data-enter-save className="col-span-2 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-2 sm:col-span-4">
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
export function KeyFacts({
  dealId,
  keyFacts,
  at,
  stale,
  docUrls,
}: {
  dealId: string
  keyFacts: Facts | null
  at: string | null
  stale: boolean
  docUrls: Record<string, string>
}) {
  const setTab = useSetTab()
  const [source, setSource] = useState<{ title: string; text: string } | null>(null)

  // Open where a fact came from: the document (at its page), the email or
  // call (shown right here), or the tab with the notes / underwriting.
  async function openSource(f: KeyFact) {
    const l = f.link
    if (!l) return
    if (l.kind === 'doc' && l.id && docUrls[l.id]) window.open(`${docUrls[l.id]}${l.page ? `#page=${l.page}` : ''}`, '_blank', 'noopener')
    else if ((l.kind === 'email' || l.kind === 'call') && l.id) setSource((await getFactSource(dealId, l.kind, l.id)) ?? { title: 'Not found', text: 'That email or call is no longer on this deal.' })
    else if (l.kind === 'notes') setTab?.('activity')
    else if (l.kind === 'snapshot') setTab?.('ai')
  }
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
  // Opening a deal with no key facts yet, or with something new since they
  // were read (a document, email, call or note): read it again by itself.
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current || !(stale || !keyFacts)) return
    ran.current = true
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per deal visit
  }, [dealId])
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
          {at ? `Updated ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · click a fact to see where it came from` : 'From the docs, emails, calls and notes'}
        </p>
        <div className="flex items-center gap-3 text-xs">
          <button type="button" onClick={() => setEditing('__new')} className="text-slate-600 hover:underline">
            + Add fact
          </button>
          <button type="button" onClick={refresh} disabled={busy} title="The AI reads the deal again — a few cents" className="text-slate-600 hover:underline disabled:opacity-50">
            {busy ? 'Reading the deal…' : '↻ Refresh'}
          </button>
        </div>
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      {keyFacts?.summary && <p className="mb-3 text-[15px] leading-snug text-slate-900">{keyFacts.summary}</p>}

      {facts.length === 0 && editing !== '__new' ? (
        <p className="text-sm text-slate-400">
          {busy
            ? 'Reading the documents, emails, calls and notes for the key facts…'
            : 'No key facts found yet — they fill in by themselves as documents, emails and calls come in. You can also + Add fact.'}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          {facts.map((f) =>
            editing === f.label ? (
              <FactEditor key={f.label} initial={f} saving={pending} onCancel={() => setEditing(null)} onSave={(l, v) => save(f.label, l, v)} />
            ) : (
              <div key={f.label} className="group min-w-0" title={[f.note, `Source: ${f.source}`].filter(Boolean).join('\n')}>
                <dt className="flex items-center gap-2 text-xs text-slate-500">
                  {f.label}
                  <span className="hidden gap-2 group-hover:flex">
                    <button type="button" onClick={() => setEditing(f.label)} className="text-slate-400 hover:text-slate-700">
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => start(async () => void (await removeKeyFact(dealId, f.label)))}
                      className="text-slate-400 hover:text-red-600"
                    >
                      remove
                    </button>
                  </span>
                </dt>
                <dd className="truncate font-medium text-slate-800">
                  {f.link ? (
                    <button
                      type="button"
                      onClick={() => openSource(f)}
                      title={`Open the source: ${f.source}`}
                      className="max-w-full truncate text-left underline decoration-slate-300 underline-offset-2 hover:decoration-slate-700"
                    >
                      {f.value}
                    </button>
                  ) : (
                    f.value
                  )}
                </dd>
              </div>
            )
          )}
          {editing === '__new' && <FactEditor saving={pending} onCancel={() => setEditing(null)} onSave={(l, v) => save(null, l, v)} />}
        </dl>
      )}

      {source && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-slate-600">{source.title}</p>
            <button type="button" onClick={() => setSource(null)} className="text-xs text-slate-500 hover:underline">
              Close
            </button>
          </div>
          <p className="mt-1.5 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs text-slate-700">{source.text || '(no text saved)'}</p>
        </div>
      )}

      {(keyFacts?.missing ?? []).length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          Missing:
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
