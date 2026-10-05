'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { matchScoreColor } from '@/lib/types'
import { toggleMatchSelected } from './actions'
import { addSubmissions } from './submission-actions'
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
  outlookDraftCreatedAt: string | null
}

export type DealDoc = { id: string; name: string; size: number | null }
export type Mailbox = { id: string; account_email: string }
type AttachmentAdvice = {
  reasons: Record<string, { include: boolean; reason: string }>
  note: string | null
  loading: boolean
  error: string | null
  run: () => void
}

function DraftEmail({
  dealId,
  matchId,
  subject,
  body,
  outlookDraftCreatedAt,
  onCreated,
  onRedraft,
  redrafting,
  documents,
  selectedDocIds,
  onToggleDoc,
  onSetAllDocs,
  mailboxes,
  mailboxId,
  onPickMailbox,
  attachmentAdvice,
  includeIntro,
  onToggleIntro,
}: {
  dealId: string
  matchId: string
  subject: string
  body: string
  outlookDraftCreatedAt: string | null
  onCreated: () => void
  onRedraft: (style: 'short' | 'long') => void
  redrafting: boolean
  documents: DealDoc[]
  selectedDocIds: string[]
  onToggleDoc: (id: string) => void
  onSetAllDocs: (all: boolean) => void
  mailboxes: Mailbox[]
  mailboxId: string | null
  onPickMailbox: (id: string) => void
  attachmentAdvice: AttachmentAdvice
  includeIntro: boolean
  onToggleIntro: (v: boolean) => void
}) {
  const [showAttachments, setShowAttachments] = useState(false)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)
  const [outlookError, setOutlookError] = useState<string | null>(null)

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

  async function createInOutlook() {
    setCreating(true)
    setOutlookError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/matches/${matchId}/create-outlook-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: selectedDocIds, connectionId: mailboxId }),
      })
      const result = await readJsonResponse<{ webLink: string; skippedAttachments: string[] }>(res)
      if (!result.ok) throw new Error(result.message)
      onCreated()
      if (result.body.webLink) window.open(result.body.webLink, '_blank')
    } catch (err) {
      setOutlookError(err instanceof Error ? err.message : 'Could not create the Outlook draft')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-amber-800 hover:underline"
        >
          {open ? 'Hide' : 'View'} auto-drafted submission email
        </button>
        <div className="flex items-center gap-2">
          {open && (
            <span className="flex items-center gap-1 text-xs text-amber-800" title="Writes a fresh draft (a few cents)">
              {redrafting ? (
                'Redrafting…'
              ) : (
                <>
                  <label className="mr-1 flex items-center gap-1" title="Start the email with your intro from Settings">
                    <input
                      type="checkbox"
                      checked={includeIntro}
                      onChange={(e) => onToggleIntro(e.target.checked)}
                      className="rounded border-amber-300"
                    />
                    intro
                  </label>
                  Redraft:
                  {(['short', 'long'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => onRedraft(st)}
                      className="rounded border border-amber-300 px-2 py-0.5 capitalize hover:bg-amber-100"
                    >
                      {st}
                    </button>
                  ))}
                </>
              )}
            </span>
          )}
          {open && (
            <button
              type="button"
              onClick={copy}
              className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          )}
          {mailboxes.length > 1 && (
            <select
              value={mailboxId ?? ''}
              onChange={(e) => onPickMailbox(e.target.value)}
              title="Which Outlook the draft goes into"
              className="rounded border border-amber-300 bg-white px-1 py-0.5 text-xs text-amber-800"
            >
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.account_email}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={createInOutlook}
            disabled={creating}
            className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {creating
              ? 'Creating…'
              : outlookDraftCreatedAt
                ? 'Re-create in Outlook'
                : 'Create draft in Outlook'}
          </button>
        </div>
      </div>
      {documents.length > 0 && (
        <div className="mt-2 text-xs text-amber-800">
          <button type="button" onClick={() => setShowAttachments((v) => !v)} className="hover:underline">
            Attachments: {selectedDocIds.length} of {documents.length} selected {showAttachments ? '▴' : '▾'}
          </button>
          {showAttachments && (
            <div className="mt-1 rounded border border-amber-200 bg-white p-2">
              <div className="mb-1 flex gap-3">
                <button type="button" onClick={() => onSetAllDocs(true)} className="hover:underline">
                  Select all
                </button>
                <button type="button" onClick={() => onSetAllDocs(false)} className="hover:underline">
                  Select none
                </button>
                <button
                  type="button"
                  onClick={attachmentAdvice.run}
                  disabled={attachmentAdvice.loading}
                  title="AI picks which documents to send (a few cents)"
                  className="font-medium hover:underline disabled:opacity-50"
                >
                  {attachmentAdvice.loading ? 'Choosing…' : '✨ Recommend for me'}
                </button>
                <span className="text-slate-400">Applies to every lender email on this deal.</span>
              </div>
              {attachmentAdvice.error && <p className="mb-1 text-red-600">{attachmentAdvice.error}</p>}
              {attachmentAdvice.note && <p className="mb-1 text-slate-600">Missing: {attachmentAdvice.note}</p>}
              <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                {documents.map((d) => {
                  const tooBig = (d.size ?? 0) > 3 * 1024 * 1024
                  return (
                    <li key={d.id}>
                      <label className="flex items-center gap-2 text-slate-700">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.includes(d.id)}
                          onChange={() => onToggleDoc(d.id)}
                          className="rounded border-slate-300"
                        />
                        <span className="truncate">{d.name}</span>
                        {attachmentAdvice.reasons[d.id] && (
                          <span
                            className={`shrink-0 ${attachmentAdvice.reasons[d.id].include ? 'text-emerald-700' : 'text-slate-400'}`}
                          >
                            — {attachmentAdvice.reasons[d.id].reason}
                          </span>
                        )}
                        {tooBig && <span className="shrink-0 text-red-600">over 3MB — Outlook will skip it</span>}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
      {outlookDraftCreatedAt && (
        <p className="mt-1 text-xs text-amber-700">
          Created in Outlook {new Date(outlookDraftCreatedAt).toLocaleString()}
        </p>
      )}
      {outlookError && <ErrorText message={outlookError} className="mt-1 block text-xs text-red-600" />}
      {open && (
        <div className="mt-2 space-y-2 text-sm text-slate-700">
          <p>
            <span className="font-medium">Subject:</span> {subject}
          </p>
          <p className="whitespace-pre-wrap">{body}</p>
          <p className="text-xs text-amber-700">
            Draft only — nothing is sent automatically. Review and send it yourself in Outlook.
          </p>
        </div>
      )}
    </div>
  )
}

function LoanTypeRecommender({
  dealId,
  currentLoanType,
  savedRecommendation,
}: {
  dealId: string
  currentLoanType: string | null
  savedRecommendation: LoanTypeRecommendation | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [freshReasoning, setReasoning] = useState<string | null>(null)
  // Only show the saved explanation while it still matches the deal's loan
  // type — if someone changed the type by hand since, it no longer applies.
  const reasoning =
    freshReasoning ??
    (savedRecommendation && savedRecommendation.loan_type === currentLoanType ? savedRecommendation.reasoning : null)

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

export type LoanTypeRecommendation = { loan_type: string | null; reasoning: string; at?: string }

export function MatchingPanel({
  dealId,
  matches,
  lastRunAt,
  hasUnderwriting,
  currentLoanType,
  sentLenderIds,
  loanTypeRecommendation,
  documents,
  mailboxes,
  defaultMailboxId,
}: {
  dealId: string
  matches: MatchWithLender[]
  lastRunAt: string | null
  hasUnderwriting: boolean
  currentLoanType: string | null
  sentLenderIds: string[]
  loanTypeRecommendation: LoanTypeRecommendation | null
  documents: DealDoc[]
  mailboxes: Mailbox[]
  defaultMailboxId: string | null
}) {
  // Which Outlook gets the drafts: your own by default; a different pick is
  // remembered in this browser.
  const [mailboxId, setMailboxId] = useState<string | null>(defaultMailboxId)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('outlook-mailbox')
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved browser preference
      if (saved && mailboxes.some((m) => m.id === saved)) setMailboxId(saved)
    } catch {
      // No storage — keep the default.
    }
  }, [mailboxes])
  function pickMailbox(id: string) {
    setMailboxId(id)
    try {
      localStorage.setItem('outlook-mailbox', id)
    } catch {
      // Ignore.
    }
  }
  // Which documents go with the Outlook drafts — one choice for the whole
  // deal, remembered in this browser.
  const storageKey = `draft-attachments:${dealId}`
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(documents.map((d) => d.id))
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as string[] | null
      if (Array.isArray(saved)) {
        const valid = new Set(documents.map((d) => d.id))
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved browser preference
        setSelectedDocIds(saved.filter((id) => valid.has(id)))
      }
    } catch {
      // No storage (private window) — keep the default.
    }
  }, [storageKey, documents])
  const [adviceReasons, setAdviceReasons] = useState<AttachmentAdvice['reasons']>({})
  const [adviceNote, setAdviceNote] = useState<string | null>(null)
  const [adviceLoading, setAdviceLoading] = useState(false)
  const [adviceError, setAdviceError] = useState<string | null>(null)
  async function recommendAttachments() {
    setAdviceLoading(true)
    setAdviceError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/recommend-attachments`, { method: 'POST' })
      const parsed = await readJsonResponse<{
        decisions: { id: string; include: boolean; reason: string }[]
        note: string | null
      }>(res)
      if (!parsed.ok) throw new Error(parsed.message)
      setAdviceReasons(Object.fromEntries(parsed.body.decisions.map((d) => [d.id, { include: d.include, reason: d.reason }])))
      setAdviceNote(parsed.body.note)
      saveSelection(parsed.body.decisions.filter((d) => d.include).map((d) => d.id))
    } catch (err) {
      setAdviceError(err instanceof Error ? err.message : 'Could not recommend attachments')
    } finally {
      setAdviceLoading(false)
    }
  }
  const attachmentAdvice: AttachmentAdvice = {
    reasons: adviceReasons,
    note: adviceNote,
    loading: adviceLoading,
    error: adviceError,
    run: recommendAttachments,
  }

  function saveSelection(ids: string[]) {
    setSelectedDocIds(ids)
    try {
      localStorage.setItem(storageKey, JSON.stringify(ids))
    } catch {
      // Ignore — selection still works for this visit.
    }
  }
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infoNote, setInfoNote] = useState<string | null>(null)
  const [draftingId, setDraftingId] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<{ id: string; message: string } | null>(null)

  // Drafts one email on demand (matches under the auto-draft score don't
  // get one automatically). Costs a few cents.
  // Whether drafts open with the sender's intro (from Settings). Off is
  // handy for lenders you already work with. Remembered in this browser.
  const [includeIntro, setIncludeIntro] = useState(true)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved browser preference
      if (localStorage.getItem('draft-include-intro') === 'false') setIncludeIntro(false)
    } catch {
      // Ignore.
    }
  }, [])
  function toggleIntro(v: boolean) {
    setIncludeIntro(v)
    try {
      localStorage.setItem('draft-include-intro', String(v))
    } catch {
      // Ignore.
    }
  }

  async function draftFor(matchId: string, style: 'short' | 'long' = 'short') {
    setDraftingId(matchId)
    setDraftError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/matches/${matchId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style, includeIntro }),
      })
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
        <LoanTypeRecommender
          dealId={dealId}
          currentLoanType={currentLoanType}
          savedRecommendation={loanTypeRecommendation}
        />
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
                <div className="flex shrink-0 items-center gap-2">
                {sentLenderIds.includes(m.lender_id) ? (
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Sent ✓</span>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      await addSubmissions(dealId, [m.lender_id])
                      router.refresh()
                    }}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Mark as sent
                  </button>
                )}
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
              </div>
              <p className="mt-2 text-sm text-slate-600">{m.reasoning}</p>
              {m.draftStatus === 'drafted' && m.draftSubject && m.draftBody && (
                <DraftEmail
                  dealId={dealId}
                  matchId={m.id}
                  subject={m.draftSubject}
                  body={m.draftBody}
                  outlookDraftCreatedAt={m.outlookDraftCreatedAt}
                  onCreated={() => router.refresh()}
                  onRedraft={(style) => draftFor(m.id, style)}
                  redrafting={draftingId === m.id}
                  documents={documents}
                  selectedDocIds={selectedDocIds}
                  onToggleDoc={(id) =>
                    saveSelection(selectedDocIds.includes(id) ? selectedDocIds.filter((x) => x !== id) : [...selectedDocIds, id])
                  }
                  onSetAllDocs={(all) => saveSelection(all ? documents.map((d) => d.id) : [])}
                  mailboxes={mailboxes}
                  mailboxId={mailboxId}
                  onPickMailbox={pickMailbox}
                  attachmentAdvice={attachmentAdvice}
                  includeIntro={includeIntro}
                  onToggleIntro={toggleIntro}
                />
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
                <div className="mt-3 flex gap-2">
                  {(['short', 'long'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => draftFor(m.id, st)}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Draft {st} email
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
