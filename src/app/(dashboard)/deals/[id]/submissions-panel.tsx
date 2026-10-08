'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  SUBMISSION_LABELS,
  SUBMISSION_STATUSES,
  SUBMISSION_STYLES,
  type SubmissionStatus,
} from '@/lib/deals/submission-status'
import { editDealUpdate, removeDealUpdate } from './actions'
import {
  addLenderNote,
  addNewLenderSubmission,
  addSubmissions,
  removeSubmission,
  setSubmissionSentOn,
  setSubmissionStatus,
} from './submission-actions'

export type SubmissionRow = {
  id: string
  lender_id: string
  lender_name: string
  status: SubmissionStatus
  sent_on: string
  last_activity_at: string
}

export type TimelineItem = {
  id: string
  lender_id: string
  kind: 'email' | 'note'
  at: string
  text: string
  subject?: string | null
  // e.g. "in Eli's inbox" — whose mailbox the email was in.
  where?: string | null
  // Set on emails we sent, e.g. "David" — shown as "David replied".
  sentBy?: string | null
}

// How often the page re-reads the deal while it's open, so replies the
// inbox picks up show without a manual refresh. No AI — free.
const REFRESH_MS = 60_000

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

function shortDate(iso: string) {
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function AddLenders({
  dealId,
  lenders,
  alreadySent,
  onDone,
}: {
  dealId: string
  lenders: { id: string; name: string }[]
  alreadySent: Set<string>
  onDone: () => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const q = query.trim().toLowerCase()
  const results = useMemo(
    () =>
      q
        ? lenders
            .filter((l) => !alreadySent.has(l.id) && l.name.toLowerCase().includes(q))
            .slice(0, 8)
        : [],
    [q, lenders, alreadySent]
  )
  const exactExists = lenders.some((l) => l.name.toLowerCase() === q)

  function toggle(l: { id: string; name: string }) {
    setPicked((p) => (p.some((x) => x.id === l.id) ? p.filter((x) => x.id !== l.id) : [...p, l]))
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search lenders by name…"
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      />

      {results.length > 0 && (
        <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {results.map((l) => {
            const on = picked.some((x) => x.id === l.id)
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => toggle(l)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${on ? 'font-medium' : ''}`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}
                  >
                    {on ? '✓' : ''}
                  </span>
                  {l.name}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {q && !exactExists && (
        <div className="mt-2 rounded-md border border-dashed border-slate-300 bg-white p-2 text-sm">
          <p className="text-slate-600">
            Not in the CRM? Add <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span> as a new lender:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Their email (optional)"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                startSaving(async () => {
                  setError(null)
                  const res = await addNewLenderSubmission(dealId, query, newEmail || null)
                  if (res?.error) setError(res.error)
                  else onDone()
                })
              }
              className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Add new lender &amp; mark sent
            </button>
          </div>
        </div>
      )}

      {picked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {picked.map((l) => (
            <span key={l.id} className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs text-white">
              {l.name}{' '}
              <button type="button" onClick={() => toggle(l)} className="ml-1 opacity-70 hover:opacity-100">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={picked.length === 0 || saving}
          onClick={() =>
            startSaving(async () => {
              await addSubmissions(
                dealId,
                picked.map((l) => l.id)
              )
              onDone()
            })
          }
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : `Mark as sent${picked.length ? ` to ${picked.length}` : ''}`}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function LenderCard({ dealId, sub, items }: { dealId: string; sub: SubmissionRow; items: TimelineItem[] }) {
  const [showAll, setShowAll] = useState(false)
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const visible = showAll ? items : items.slice(0, 3)

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={`/lenders/${sub.lender_id}`} className="truncate font-medium text-slate-800 hover:underline">
            {sub.lender_name}
          </Link>
          <span className="text-xs text-slate-400">updated {ago(sub.last_activity_at)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Sent
            <input
              type="date"
              defaultValue={sub.sent_on}
              onChange={(e) => startTransition(() => setSubmissionSentOn(dealId, sub.id, e.target.value))}
              className="rounded border border-slate-200 px-1 py-0.5 text-xs text-slate-700"
            />
          </label>
          <select
            value={sub.status}
            disabled={pending}
            onChange={(e) => startTransition(() => setSubmissionStatus(dealId, sub.id, e.target.value))}
            className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${SUBMISSION_STYLES[sub.status]}`}
          >
            {SUBMISSION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SUBMISSION_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="Remove from this list"
            onClick={() => {
              if (confirm(`Remove ${sub.lender_name} from the "sent to" list? Its notes stay in the deal's Updates.`))
                startTransition(() => removeSubmission(dealId, sub.id))
            }}
            className="px-1 text-slate-400 hover:text-red-600"
          >
            ×
          </button>
        </div>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 space-y-2 border-l-2 border-slate-100 pl-3">
          {visible.map((it) => (
            <li key={it.id} className="text-sm">
              <span className="mr-2 text-xs text-slate-400">{shortDate(it.at)}</span>
              {it.kind === 'email' && it.sentBy ? (
                <>
                  <span className="mr-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                    {it.sentBy} {/^re:/i.test(it.subject ?? '') ? 'replied' : 'sent'}
                  </span>
                  {it.subject && <span className="font-medium text-slate-700">{it.subject} — </span>}
                  <span className="text-slate-600">{it.text}</span>
                </>
              ) : it.kind === 'email' ? (
                <>
                  <span className="mr-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                    Email
                  </span>
                  {it.where && <span className="mr-1 text-[11px] text-slate-500">({it.where})</span>}
                  {it.subject && <span className="font-medium text-slate-700">{it.subject} — </span>}
                  <span className="text-slate-600">{it.text}</span>
                </>
              ) : (
                <NoteText dealId={dealId} item={it} />
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs text-slate-500 hover:underline"
        >
          {showAll ? 'Show less' : `Show all ${items.length} updates`}
        </button>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const text = note
          setNote('')
          startTransition(() => addLenderNote(dealId, sub.lender_id, text))
        }}
      >
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`Add an update for ${sub.lender_name}…`}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={!note.trim() || pending}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </li>
  )
}

export function SubmissionsPanel({
  dealId,
  submissions,
  timeline,
  lenders,
}: {
  dealId: string
  submissions: SubmissionRow[]
  timeline: TimelineItem[]
  lenders: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)

  // On open, check Outlook Sent Items for drafts from this deal that have
  // gone out (free) — so a lender you just emailed shows up here.
  useEffect(() => {
    fetch(`/api/deals/${dealId}/check-sent`, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.found > 0) router.refresh()
      })
      .catch(() => {})
  }, [dealId, router])

  // Keep the page current while it's open (inbox replies land on their own).
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [router])

  const alreadySent = useMemo(() => new Set(submissions.map((s) => s.lender_id)), [submissions])
  const counts = SUBMISSION_STATUSES.map((s) => [s, submissions.filter((x) => x.status === s).length] as const).filter(
    ([, n]) => n > 0
  )

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Lenders sent to ({submissions.length})</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Lenders you email from a CRM draft, and their replies, are added here automatically.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            + Add lenders
          </button>
        )}
      </div>

      {counts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {counts.map(([s, n]) => (
            <span key={s} className={`rounded-full px-2.5 py-0.5 text-xs ${SUBMISSION_STYLES[s]}`}>
              {n} {SUBMISSION_LABELS[s]}
            </span>
          ))}
        </div>
      )}

      {adding && (
        <AddLenders dealId={dealId} lenders={lenders} alreadySent={alreadySent} onDone={() => setAdding(false)} />
      )}

      {submissions.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {submissions.map((sub) => (
            <LenderCard
              key={sub.id}
              dealId={dealId}
              sub={sub}
              items={timeline.filter((t) => t.lender_id === sub.lender_id)}
            />
          ))}
        </ul>
      ) : (
        !adding && (
          <p className="mt-4 py-4 text-center text-sm text-slate-400">
            Not sent to any lenders yet. Click &ldquo;+ Add lenders&rdquo;, or use &ldquo;Mark as sent&rdquo; on a match below.
          </p>
        )
      )}
    </section>
  )
}

// A note on a lender's timeline, with quiet Edit / × controls.
function NoteText({ dealId, item }: { dealId: string; item: TimelineItem }) {
  const updateId = item.id.replace(/^note-/, '')
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const [pending, startTransition] = useTransition()

  if (editing) {
    return (
      <span className="mt-1 flex gap-2">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-0.5 text-sm"
        />
        <button
          type="button"
          disabled={pending || !text.trim()}
          onClick={() =>
            startTransition(async () => {
              await editDealUpdate(dealId, updateId, text, null)
              setEditing(false)
            })
          }
          className="text-xs font-medium text-slate-700 hover:underline disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500 hover:underline">
          Cancel
        </button>
      </span>
    )
  }
  return (
    <span className="group text-slate-600">
      {item.text}
      <span className="ml-2 inline-flex gap-2 text-xs sm:hidden sm:group-hover:inline-flex">
        <button type="button" onClick={() => setEditing(true)} className="text-slate-400 hover:text-slate-700 hover:underline">
          Edit
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm('Delete this note?')) startTransition(() => removeDealUpdate(dealId, updateId))
          }}
          className="text-slate-400 hover:text-red-600 hover:underline"
        >
          Delete
        </button>
      </span>
    </span>
  )
}

