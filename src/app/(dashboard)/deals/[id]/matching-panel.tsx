'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { matchScoreColor } from '@/lib/types'
import { toggleMatchSelected } from './actions'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'

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

function LoanTypeRecommender({
  dealId,
  currentLoanType,
}: {
  dealId: string
  currentLoanType: string | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasoning, setReasoning] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    setReasoning(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/recommend-loan-type`, {
        method: 'POST',
      })
      const result = await readJsonResponse<{ loanType: string | null; reasoning: string }>(res)
      if (!result.ok) {
        throw new Error(result.message)
      }
      setReasoning(result.body.reasoning)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recommendation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">
            Loan type: {currentLoanType ?? 'not set'}
          </p>
          <p className="text-xs text-slate-500">
            Uses underwriting, documents, and notes to suggest the best-fit
            loan type before matching.
          </p>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {loading
            ? 'Analyzing…'
            : currentLoanType
              ? 'Re-recommend loan type'
              : 'Recommend loan type'}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}
      {reasoning && <p className="mt-2 text-sm text-slate-600">{reasoning}</p>}
    </div>
  )
}

export function MatchingPanel({
  dealId,
  matches,
  lastRunAt,
  hasUnderwriting,
  currentLoanType,
}: {
  dealId: string
  matches: MatchWithLender[]
  lastRunAt: string | null
  hasUnderwriting: boolean
  currentLoanType: string | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infoNote, setInfoNote] = useState<string | null>(null)
  const [draftingId, setDraftingId] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<{ id: string; message: string } | null>(null)

  // Drafts one email on demand (matches under the auto-draft score don't
  // get one automatically). Costs a few cents.
  async function draftFor(matchId: string) {
    setDraftingId(matchId)
    setDraftError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/matches/${matchId}/draft`, { method: 'POST' })
      const result = await readJsonResponse(res)
      if (!result.ok) throw new Error(result.message)
      router.refresh()
    } catch (err) {
      setDraftError({ id: matchId, message: err instanceof Error ? err.message : 'Draft failed' })
    } finally {
      setDraftingId(null)
    }
  }

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
        {hasUnderwriting ? (
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
        ) : (
          <button
            disabled
            title="Run underwriting on this deal first"
            className="cursor-not-allowed rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-400"
          >
            Find matching lenders
          </button>
        )}
      </div>

      {!hasUnderwriting && (
        <p className="mt-3 text-sm text-amber-700">
          Run underwriting above first — matching uses it to judge fit, so
          it&apos;s locked until then.
        </p>
      )}

      {hasUnderwriting && (
        <LoanTypeRecommender dealId={dealId} currentLoanType={currentLoanType} />
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}
      {infoNote && <p className="mt-3 text-sm text-slate-500">{infoNote}</p>}

      {hasUnderwriting && matches.length === 0 && !loading && !infoNote && (
        <p className="mt-4 text-sm text-slate-400">
          Scores every active lender against this deal&apos;s profile and
          returns the best realistic fits with reasoning. Matches that score
          70+ also get a draft submission email, ready to review below. Select any
          other match to draft one for it.
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
                    // Selecting a match with no draft yet drafts one now.
                    if (!m.selected && m.draftStatus !== 'drafted') draftFor(m.id)
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
              {draftingId === m.id && (
                <p className="mt-3 text-xs text-slate-500">Drafting submission email…</p>
              )}
              {draftError?.id === m.id && (
                <p className="mt-3 text-xs text-red-600">
                  <ErrorText message={draftError.message} />
                </p>
              )}
              {m.selected && m.draftStatus !== 'drafted' && draftingId !== m.id && (
                <button
                  type="button"
                  onClick={() => draftFor(m.id)}
                  className="mt-3 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Draft submission email
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
