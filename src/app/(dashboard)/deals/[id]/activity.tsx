'use client'

import { useState } from 'react'
import { addDealUpdate } from './actions'
import { UpdateRow } from './update-row'
import { CallCard, CallRecorder, useCallPolling, type CallRow, type CallTarget, type WhoOptions } from './calls-panel'
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
  const [adding, setAdding] = useState<'note' | 'call' | null>(null)
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAdding(adding === 'note' ? null : 'note')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${adding === 'note' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
        >
          + Add note
        </button>
        <button
          type="button"
          onClick={() => setAdding(adding === 'call' ? null : 'call')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${adding === 'call' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
        >
          🎙 Record a call
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

      {adding === 'note' && (
        <form
          action={async (fd) => {
            await addDealUpdate(fd)
            setAdding(null)
          }}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="deal_id" value={dealId} />
          <input
            type="date"
            name="entry_date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            name="note"
            required
            autoFocus
            placeholder="e.g. followed up with borrower, waiting on docs"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm max-sm:basis-full"
          />
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Save
          </button>
        </form>
      )}
      {adding === 'call' && (
        <div className="mt-3">
          <CallRecorder target={target} whoOptions={whoOptions} hint="Put the call (cell, Teams or Zoom) on speaker, then hit record." />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Nothing yet — add a note or record a call.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((item) =>
            item.kind === 'call' ? (
              <li key={`call-${item.call.id}`}>
                <CallCard key={`${item.call.id}-${item.call.status}-${item.call.applied.length}`} call={item.call} whoOptions={whoOptions} />
              </li>
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
    <li className="rounded-lg border border-slate-100 px-3 py-2.5 text-sm">
      <details className="group">
        <summary className="cursor-pointer list-none">
          <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${sent ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}`}>
            ✉️ {sent ? 'Sent' : 'Email'}
          </span>
          <span className="mr-2 text-xs text-slate-400">{e.received_at ? new Date(e.received_at).toLocaleDateString() : ''}</span>
          <span className="font-medium text-slate-800">{e.subject || '(no subject)'}</span>
          {!sent && <span className="text-slate-500 max-sm:hidden"> — {e.from_email}</span>}
          {where && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{where}</span>}
          {e.summary && <p className="mt-1 text-slate-600 line-clamp-2 group-open:line-clamp-none">{e.summary}</p>}
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
