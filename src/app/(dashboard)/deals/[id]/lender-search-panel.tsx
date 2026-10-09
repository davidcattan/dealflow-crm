'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'
import type { FoundLender, LenderSearch } from '@/lib/lender-search/schema'
import { addFoundLender, setLenderSearchQueued } from './actions'
import { addSubmissions } from './submission-actions'

const CONFIDENCE_STYLES: Record<FoundLender['confidence'], string> = {
  high: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-100 text-slate-600',
}

function FoundLenderCard({
  dealId,
  lender,
  existingId,
}: {
  dealId: string
  lender: FoundLender
  existingId: string | null
}) {
  const router = useRouter()
  const [addedId, setAddedId] = useState<string | null>(existingId)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={lender.website}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-800 hover:underline"
          >
            {lender.name}
          </a>
          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${CONFIDENCE_STYLES[lender.confidence]}`}>
            {lender.confidence} confidence
          </span>
          <p className="mt-0.5 text-xs text-slate-500">
            {[lender.lending_type, lender.loan_size, lender.geographies].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {addedId ? (
            <>
              <Link
                href={`/lenders/${addedId}`}
                className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:underline"
              >
                In your lenders ✓
              </Link>
              {!sent && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await addSubmissions(dealId, [addedId])
                      setSent(true)
                      router.refresh()
                    })
                  }
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Mark as sent
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null)
                  const res = await addFoundLender(dealId, lender)
                  if ('error' in res && res.error) setError(res.error)
                  else if ('id' in res && res.id) setAddedId(res.id)
                })
              }
              className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {pending ? 'Adding…' : 'Add to my lenders'}
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-700">{lender.why_fit}</p>
      {lender.watch_out && <p className="mt-1 text-xs text-amber-700">Watch out: {lender.watch_out}</p>}
      <p className="mt-1 text-xs text-slate-500">
        {lender.contact && <span>Contact: {lender.contact} · </span>}
        <a href={lender.source_url} target="_blank" rel="noreferrer" className="hover:underline">
          Source
        </a>
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  )
}

export function LenderSearchPanel({
  dealId,
  search,
  generatedAt,
  queuedAt,
  lenderIdsByName,
  prompt,
}: {
  dealId: string
  search: LenderSearch | null
  generatedAt: string | null
  queuedAt: string | null
  lenderIdsByName: Record<string, string>
  prompt: string
}) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showFree, setShowFree] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pasted, setPasted] = useState('')
  const [importing, setImporting] = useState(false)
  const [queuing, startQueue] = useTransition()

  async function call(path: string, body?: unknown) {
    const res = await fetch(path, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const parsed = await readJsonResponse<{ ok: boolean }>(res)
    if (!parsed.ok) throw new Error(parsed.message)
    router.refresh()
  }

  async function run() {
    setConfirming(false)
    setRunning(true)
    setError(null)
    try {
      await call(`/api/deals/${dealId}/find-lenders`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lender search failed')
    } finally {
      setRunning(false)
    }
  }

  async function importPasted() {
    setImporting(true)
    setError(null)
    try {
      await call(`/api/deals/${dealId}/import-lender-search`, { text: pasted })
      setPasted('')
      setShowFree(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Find new lenders online</h2>
          <p className="mt-0.5 max-w-xl text-xs text-slate-500">
            Searches the web for lenders not in your list that fit this deal, checks each one on its own website, and
            explains why it fits. Uses the underwriting snapshot, so run underwriting first for the best results.
          </p>
          {generatedAt && (
            <p className="mt-1 text-xs text-slate-400">Last search {new Date(generatedAt).toLocaleString()}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={running || confirming}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {running ? 'Searching the web… (2–5 min)' : search ? 'Search again (paid)' : 'Search the web (paid)'}
          </button>
          <button
            type="button"
            onClick={() => setShowFree((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Search for free
          </button>
        </div>
      </div>

      {confirming && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800">
          <p>
            This searches the web and reads lenders&apos; websites — usually <strong>about $1–3</strong>, and takes 2–5
            minutes. Free alternative: &ldquo;Search for free&rdquo;.
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={run} className="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800">
              Yes, search
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showFree && (
        <div className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div>
            <p className="font-medium">Option 1 — Claude Code ($0)</p>
            <p className="text-xs text-slate-500">
              Queue it, then in Claude Code say &ldquo;process the underwriting queue&rdquo;. Results land here
              automatically.
            </p>
            <button
              type="button"
              disabled={queuing}
              onClick={() => startQueue(() => setLenderSearchQueued(dealId, !queuedAt))}
              className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              {queuedAt ? `Queued ${new Date(queuedAt).toLocaleDateString()} — click to unqueue` : 'Queue for Claude Code'}
            </button>
          </div>
          <div>
            <p className="font-medium">Option 2 — Claude.ai ($0 to search, a few cents to save)</p>
            <p className="text-xs text-slate-500">
              Copy the instructions, paste them into Claude.ai with web search on, then paste its answer back here.
            </p>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(prompt)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
            >
              {copied ? 'Copied ✓' : 'Copy instructions for Claude.ai'}
            </button>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={4}
              placeholder="Paste Claude.ai's answer here…"
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs"
            />
            <button
              type="button"
              disabled={importing || pasted.trim().length < 150}
              onClick={importPasted}
              className="mt-1 rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {importing ? 'Saving…' : 'Save results'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}

      {search && (
        <div className="mt-4">
          <p className="text-sm text-slate-700">
            <span className="font-medium">What this deal needs:</span> {search.needed}
          </p>
          {search.note && <p className="mt-1 text-xs text-slate-500">{search.note}</p>}
          <ul className="mt-3 space-y-3">
            {search.results.map((l) => (
              <FoundLenderCard
                key={`${l.name}-${l.website}`}
                dealId={dealId}
                lender={l}
                existingId={lenderIdsByName[l.name.trim().toLowerCase()] ?? null}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
