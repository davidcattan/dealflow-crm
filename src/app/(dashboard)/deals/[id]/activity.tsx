'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readJsonResponse } from '@/lib/fetch-json'
import { UpdateRow } from './update-row'
import { CallCard, CallRecorder, useCallPolling, whoLabel, type CallRow, type CallTarget, type WhoOptions } from './calls-panel'
import { MoveToDeal, type DealChoice } from './move-to-deal'
import { mailboxLabel } from '@/lib/outlook/mailbox-label'
import type { DealEmail } from '@/lib/deals/deal-emails'

type Update = { id: string; note: string; entry_date: string | null; created_at: string; lender_id?: string | null }
type Item =
  | { kind: 'note'; at: string; update: Update }
  | { kind: 'call'; at: string; call: CallRow }
  | { kind: 'email'; at: string; email: DealEmail }

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'note', label: 'Notes' },
  { key: 'call', label: 'Calls' },
  { key: 'email', label: 'Emails' },
] as const

// Everything that happened on the deal in one timeline, newest first: your
// notes, calls (with their notes), and emails. Each thing shows up once —
// a call's summary lives on the call, an email's on the email.
export function ActivityTimeline({
  dealId,
  updates,
  calls,
  emails,
  lenderNames,
  target,
  whoOptions,
  deals,
}: {
  dealId: string
  updates: Update[]
  calls: CallRow[]
  emails: DealEmail[]
  lenderNames: Record<string, string>
  target: CallTarget
  whoOptions: WhoOptions
  deals: DealChoice[]
}) {
  useCallPolling(calls)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const [adding, setAdding] = useState<'note' | null>(null)
  const [showAll, setShowAll] = useState(false)

  const items: Item[] = [
    ...updates.map((u) => ({ kind: 'note' as const, at: u.entry_date ? `${u.entry_date}T12:00:00` : u.created_at, update: u })),
    ...calls.map((c) => ({ kind: 'call' as const, at: c.created_at, call: c })),
    ...emails.map((e) => ({ kind: 'email' as const, at: e.received_at ?? '', email: e })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))
  const counts = { all: items.length, note: updates.length, call: calls.length, email: emails.length }
  const filtered = filter === 'all' ? items : items.filter((i) => i.kind === filter)
  const shown = showAll ? filtered : filtered.slice(0, 15)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      {/* The call recorder, always ready (the red record button). */}
      <div className="mb-4">
        <CallRecorder target={target} whoOptions={whoOptions} hint="Put the call (cell, Teams or Zoom) on speaker, then hit record." />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAdding(adding === 'note' ? null : 'note')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${adding === 'note' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
        >
          📝 Write notes
        </button>
        <div className="ml-auto flex gap-1 text-xs">
          {FILTERS.filter((f) => f.key === 'all' || counts[f.key]).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-2.5 py-1 ${filter === f.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {f.label} {counts[f.key]}
            </button>
          ))}
        </div>
      </div>

      {adding === 'note' && <NotesPad dealId={dealId} whoOptions={whoOptions} onDone={() => setAdding(null)} />}

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Nothing yet — record a call above or add a note.</p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {shown.map((item) =>
            item.kind === 'call' ? (
              <CallItem key={`call-${item.call.id}`} call={item.call} whoOptions={whoOptions} />
            ) : item.kind === 'email' ? (
              <EmailItem key={`email-${item.email.id}`} email={item.email} dealId={dealId} deals={deals} />
            ) : (
              <li key={`note-${item.update.id}`} className="rounded-lg border border-slate-100 px-3">
                <ul>
                  <UpdateRow
                    dealId={dealId}
                    update={item.update}
                    lenderName={item.update.lender_id ? (lenderNames[item.update.lender_id] ?? 'Lender') : null}
                  />
                </ul>
              </li>
            )
          )}
        </ul>
      )}
      {filtered.length > 15 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-xs text-slate-600 underline">
          {showAll ? 'Show fewer' : `Show all ${filtered.length}`}
        </button>
      )}
    </section>
  )
}

function EmailItem({ email: e, dealId, deals }: { email: DealEmail; dealId: string; deals: DealChoice[] }) {
  const sent = e.classification === 'sent'
  const where = mailboxLabel(e.mailbox, sent)
  return (
    <li className="rounded-lg border border-slate-100 px-3 py-2.5 text-sm hover:bg-slate-50">
      <details className="group">
        <summary className="cursor-pointer list-none">
          <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${sent ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}`}>
            ✉️ {sent ? 'Sent' : 'Email'}
          </span>
          <span className="mr-2 text-xs text-slate-400">{e.received_at ? new Date(e.received_at).toLocaleDateString() : ''}</span>
          <span className="font-medium text-slate-800">{e.subject || '(no subject)'}</span>
          {!sent && <span className="text-slate-500 max-sm:hidden"> — {e.from_email}</span>}
          {where && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{where}</span>}
          {e.summary && <p className="mt-0.5 truncate text-xs text-slate-500 group-open:whitespace-normal group-open:text-sm group-open:text-slate-600">{e.summary}</p>}
        </summary>
        {e.body_text && (
          <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-xs text-slate-700">{e.body_text}</pre>
        )}
        <div className="mt-1.5">
          <MoveToDeal kind="email" dealId={dealId} itemId={e.id} deals={deals} />
        </div>
      </details>
    </li>
  )
}

// One line per call — "Call with Doug · Oct 14 · 12 min" and the gist; click
// to open the full notes, transcript and suggested updates.
function CallItem({ call, whoOptions }: { call: CallRow; whoOptions: WhoOptions }) {
  const [open, setOpen] = useState(false)
  const who = whoLabel(call, whoOptions)
  const processing = call.status !== 'done' && call.status !== 'error'
  const mins = call.duration_seconds ? Math.max(1, Math.round(call.duration_seconds / 60)) : null
  const gist = call.result?.summary ?? (processing ? 'Processing the recording…' : call.status === 'error' ? 'Couldn’t process this call — open to retry.' : '')
  return (
    <li className="rounded-lg border border-slate-100 text-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full px-3 py-2.5 text-left hover:bg-slate-50">
        <span className="flex flex-wrap items-center gap-x-2">
          <span className={`inline-block text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">📞 Call</span>
          <span className="font-medium text-slate-800">{call.result?.title ? call.result.title : `Call${who ? ` ${who}` : ''}`}</span>
          <span className="text-xs text-slate-400">
            {[call.result?.title ? who : null, new Date(call.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), mins ? `${mins} min` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {!open && gist && <span className="mt-0.5 block truncate pl-4 text-xs text-slate-500">{gist}</span>}
      </button>
      {open && (
        <div className="border-t border-slate-100 p-3">
          <CallCard key={`${call.id}-${call.status}-${call.applied.length}`} call={call} whoOptions={whoOptions} />
        </div>
      )}
    </li>
  )
}

// A notepad for a call you can't record (or any note). Saved in this browser
// as you type, so closing the tab or losing signal doesn't lose it. When
// done: save it as a note (free), or have the AI organize it into call notes
// with suggested updates, like a recorded call.
function NotesPad({ dealId, whoOptions, onDone }: { dealId: string; whoOptions: WhoOptions; onDone: () => void }) {
  const router = useRouter()
  const key = `call-notes:${dealId}`
  const [text, setText] = useState('')
  const [who, setWho] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState<'save' | 'organize' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Bring back anything typed earlier on this deal.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore once on open
      if (saved) setText(saved)
    } catch {
      // Storage blocked — fine.
    }
  }, [key])
  function type(v: string) {
    setText(v)
    try {
      if (v) localStorage.setItem(key, v)
      else localStorage.removeItem(key)
    } catch {
      // Fine without it.
    }
  }

  const lenders = [...whoOptions.dealLenders, ...whoOptions.otherLenders]
  async function save(organize: boolean) {
    setBusy(organize ? 'organize' : 'save')
    setError(null)
    const lenderId = who.startsWith('lender:') ? who.slice(7) : null
    try {
      const res = await fetch(`/api/deals/${dealId}/calls/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          date,
          organize,
          callWith: who.startsWith('lender:') ? 'lender' : who || null,
          lenderId,
          lenderName: lenderId ? (lenders.find((l) => l.id === lenderId)?.name ?? null) : null,
        }),
      })
      const r = await readJsonResponse(res)
      if (!r.ok) throw new Error(r.message)
      type('')
      router.refresh()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save — your notes are still here.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
          <option value="">General note</option>
          <option value="borrower">Call with {whoOptions.borrowerName}</option>
          <option value="broker">Call with the referral partner</option>
          {whoOptions.dealLenders.length > 0 && (
            <optgroup label="Call with a lender on this deal">
              {whoOptions.dealLenders.map((l) => (
                <option key={l.id} value={`lender:${l.id}`}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          )}
          {whoOptions.otherLenders.length > 0 && (
            <optgroup label="Another lender">
              {whoOptions.otherLenders.map((l) => (
                <option key={l.id} value={`lender:${l.id}`}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" />
        <span className="text-xs text-slate-400">{text ? 'Saved on this computer as you type' : ''}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => type(e.target.value)}
        autoFocus
        rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
        placeholder="Type as you talk — shorthand is fine. e.g. needs 375k, wants 30yr fixed, rate 7.25 adj, will send 2 yrs returns by Fri"
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={Boolean(busy) || !text.trim()}
          onClick={() => save(false)}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || !text.trim()}
          onClick={() => save(true)}
          title="Turns your notes into a summary, next steps and suggested updates — like a recorded call"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === 'organize' ? 'Organizing…' : '✨ Save & organize with AI (a few cents)'}
        </button>
        <button type="button" onClick={onDone} className="ml-auto text-xs text-slate-500 hover:underline">
          Close (keeps your notes)
        </button>
      </div>
    </div>
  )
}
