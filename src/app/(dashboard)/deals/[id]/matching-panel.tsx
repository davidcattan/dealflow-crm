'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { matchScoreColor } from '@/lib/types'
import { toggleMatchSelected } from './actions'
import { readJsonResponse } from '@/lib/fetch-json'

export type MatchWithLender = {
  id: string
  lender_id: string
  lender_name: string
  score: number
  reasoning: string
  selected: boolean
  draftSubject: string | null
  draftBody: string | null
  draftStatus: 'none' | 'drafted' | 'sent'
}

function DraftEmail({ subject, body }: { subject: string; body: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can fail quietly (e.g. permissions) — not worth
      // surfacing an error for a convenience action.
    }
  }

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-amber-800 hover:underline"
        >
          {open ? 'Hide' : 'View'} auto-drafted submission email
        </button>
        {open && (
          <button
            type="button"
            onClick={copy}
            className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 text-sm text-slate-700">
          <p>
            <span className="font-medium">Subject:</span> {subject}
          </p>
          <p className="whitespace-pre-wrap">{body}</p>
          <p className="text-xs text-amber-700">
            Draft only — not sent. Paste into Outlook until direct sending
            is wired up.
          </p>
        </div>
      )}
    </div>
  )
}

export function MatchingPanel({
  dealId,
  matches,
  lastRunAt,
}: {
  dealId: string
  matches: MatchWithLender[]
  lastRunAt: string | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infoNote, setInfoNote] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    setInfoNote(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/match`, { method: 'POST' })
      const result = await readJsonResponse<{ count: number; notes?: string | null }>(res)
      if (!result.ok) {
        throw new Error(result.message)
      }
      if (result.body.count === 0) {
        setInfoNote(
          result.body.notes ?? 'No plausible lender matches were found for this deal.'
        )
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Matching failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      id="lender-matches"
      className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Lender matches
          </h2>
          {lastRunAt && (
            <p className="mt-0.5 text-xs text-slate-400">
              Last run {new Date(lastRunAt).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading
            ? 'Matching…'
            : matches.length > 0
              ? 'Re-run matching'
              : 'Find matching lenders'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {infoNote && <p className="mt-3 text-sm text-slate-500">{infoNote}</p>}

      {matches.length === 0 && !loading && !infoNote && (
        <p className="mt-4 text-sm text-slate-400">
          Scores every active lender against this deal&apos;s profile
          (underwriting if available, otherwise industry/notes/updates) and
          returns the best realistic fits with reasoning. Matches that score
          70+ also get a draft submission email, ready to review below.
        </p>
      )}

      {matches.length > 0 && (
        <ul className="mt-5 space-y-3">
          {matches.map((m) => (
            <li
              key={m.id}
              className={`rounded-lg border p-4 ${
                m.selected
                  ? 'border-slate-900 bg-slate-50'
                  : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${matchScoreColor(m.score)}`}
                  />
                  <Link
                    href={`/lenders/${m.lender_id}`}
                    className="font-medium text-slate-800 hover:underline"
                  >
                    {m.lender_name}
                  </Link>
                  <span className="text-xs text-slate-500">{m.score}/100</span>
                </div>
                <form
                  action={async (formData) => {
                    await toggleMatchSelected(formData)
                    router.refresh()
                  }}
                >
                  <input type="hidden" name="deal_id" value={dealId} />
                  <input type="hidden" name="match_id" value={m.id} />
                  <input
                    type="hidden"
                    name="next_selected"
                    value={(!m.selected).toString()}
                  />
                  <button
                    type="submit"
                    className={`shrink-0 rounded-md border px-3 py-1 text-xs font-medium ${
                      m.selected
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {m.selected ? 'Selected ✓' : 'Select'}
                  </button>
                </form>
              </div>
              <p className="mt-2 text-sm text-slate-600">{m.reasoning}</p>
              {m.draftStatus === 'drafted' && m.draftSubject && m.draftBody && (
                <DraftEmail subject={m.draftSubject} body={m.draftBody} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
