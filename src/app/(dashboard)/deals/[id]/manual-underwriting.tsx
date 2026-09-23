'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { zipSync } from 'fflate'
import { readJsonResponse } from '@/lib/fetch-json'
import { setUnderwritingQueued } from './actions'
import { ErrorText } from '@/components/error-text'

// Underwrite outside the app (Claude.ai, covered by a subscription) and
// bring the written result back in. Only the small structuring step here
// uses the paid API.
export type ManualDoc = {
  id: string
  name: string
  downloadUrl: string | null
  trimmedUrl: string | null
}

export function ManualUnderwriting({
  dealId,
  prompt,
  docs,
  queuedAt,
  hasUnderwriting,
}: {
  dealId: string
  prompt: string
  docs: ManualDoc[]
  queuedAt: string | null
  hasUnderwriting: boolean
}) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [zipping, setZipping] = useState<null | 'all' | 'key'>(null)
  const [queueing, setQueueing] = useState(false)

  async function toggleQueue() {
    setQueueing(true)
    try {
      await setUnderwritingQueued(dealId, !queuedAt)
      router.refresh()
    } finally {
      setQueueing(false)
    }
  }

  // Bundles the deal's documents into one zip in the browser (Claude.ai
  // accepts a zip, or you can drag the individual files instead).
  async function downloadZip(mode: 'all' | 'key') {
    setZipping(mode)
    setError(null)
    try {
      const files: Record<string, Uint8Array> = {}
      for (const d of docs) {
        const url = mode === 'key' && d.trimmedUrl ? d.trimmedUrl : d.downloadUrl
        if (!url) continue
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Could not download ${d.name}`)
        let name = d.name
        for (let n = 2; files[name]; n++) name = `${n}-${d.name}`
        files[name] = new Uint8Array(await res.arrayBuffer())
      }
      const blob = new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = mode === 'key' ? 'deal-documents-key-pages.zip' : 'deal-documents.zip'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the zip')
    } finally {
      setZipping(null)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setError('Could not copy automatically — select the prompt text below and copy it.')
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/import-underwriting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const result = await readJsonResponse(res)
      if (!result.ok) throw new Error(result.message)
      setText('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <details open={!hasUnderwriting} className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 text-sm">
      <summary className="cursor-pointer font-medium text-slate-800">
        Underwrite for free (no API charge)
      </summary>
      <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
        <p className="font-medium text-slate-800">Option A — have Claude Code do it</p>
        <p className="mt-1 text-xs text-slate-500">
          Queue this deal, then tell Claude Code &ldquo;process the underwriting queue.&rdquo; It
          reads the documents itself and saves the result here. Runs on your Claude plan, $0 API.
        </p>
        <button
          onClick={toggleQueue}
          disabled={queueing}
          className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {queuedAt ? 'Queued ✓ — click to cancel' : 'Queue for Claude Code'}
        </button>
      </div>
      <p className="mt-3 font-medium text-slate-800">Option B — do it yourself in Claude.ai</p>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-slate-600">
        <li>
          <button
            onClick={copy}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-100"
          >
            {copied ? 'Copied ✓' : 'Copy the prompt'}
          </button>
        </li>
        <li>
          Download the deal&apos;s documents (a copied prompt can&apos;t carry files with it):
          {docs.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs">
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3">
                  <span className="truncate text-slate-700">{d.name}</span>
                  {d.downloadUrl && (
                    <a href={d.downloadUrl} className="text-slate-600 underline hover:text-slate-900">
                      Download
                    </a>
                  )}
                  {d.trimmedUrl && (
                    <a href={d.trimmedUrl} className="text-slate-600 underline hover:text-slate-900">
                      Download key pages only
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <span> no documents uploaded for this deal.</span>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => downloadZip('all')}
              disabled={zipping !== null || docs.length === 0}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {zipping === 'all' ? 'Building zip…' : 'Download all as one zip'}
            </button>
            <button
              onClick={() => downloadZip('key')}
              disabled={zipping !== null || docs.length === 0}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {zipping === 'key' ? 'Building zip…' : 'Zip with key pages only'}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            &quot;Key pages only&quot; is the version the app itself would read — smaller, and better if
            Claude.ai complains a file is too long or too big.
          </p>
        </li>
        <li>
          Open Claude.ai, start a new chat, drag the downloaded files into the message box, then
          paste the prompt. Turn on web search if it&apos;s available. This uses your
          subscription, not the API.
        </li>
        <li>
          Copy Claude&apos;s full answer and paste it here:
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Paste Claude's underwriting analysis…"
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || text.trim().length < 200}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save as underwriting'}
            </button>
            <span className="text-xs text-slate-500">
              Costs a few cents (one short formatting step). Replaces any existing underwriting.
            </span>
          </div>
        </li>
      </ol>
      {error && (
        <p className="mt-3 text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}
    </details>
  )
}
