'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'

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
}: {
  dealId: string
  prompt: string
  docs: ManualDoc[]
}) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <summary className="cursor-pointer font-medium text-slate-700">
        Underwrite for free in Claude.ai instead
      </summary>
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
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </details>
  )
}
