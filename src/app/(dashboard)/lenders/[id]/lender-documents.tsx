'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { readJsonResponse } from '@/lib/fetch-json'

export type LenderDocument = {
  id: string
  file_name: string
  summary: string | null
  changes: string[]
  created_at: string
}

type Result = { summary: string | null; changes: string[]; warning?: string }

// Tear sheets, term sheets and program guides a lender sent. Each upload is
// read right away and fills in the profile (what they lend on, sizes,
// regions), so matching knows what kind of lender they are.
export function LenderDocuments({ lenderId, documents, ready }: { lenderId: string; documents: LenderDocument[]; ready: boolean }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  // Several files at once: one after another, each read and applied in turn
  // (so a later sheet builds on what an earlier one filled in).
  async function uploadAll(files: File[]) {
    setError(null)
    setResult(null)
    const all: Result = { summary: null, changes: [] }
    const problems: string[] = []
    for (const [i, file] of files.entries()) {
      const label = files.length > 1 ? ` (${i + 1} of ${files.length})` : ''
      try {
        const out = await upload(file, label)
        all.changes.push(...out.changes.filter((c) => !all.changes.includes(c)))
        if (out.warning) problems.push(`${file.name}: ${out.warning}`)
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`)
      }
    }
    setStatus(null)
    if (input.current) input.current.value = ''
    if (problems.length) setError(problems.join(' · '))
    if (problems.length < files.length) setResult(all)
    router.refresh()
  }

  async function upload(file: File, label: string): Promise<Result> {
    setStatus(`Uploading${label}…`)
    const safe = file.name.replace(/[^\w.\- ]+/g, '_')
    const storagePath = `lenders/${lenderId}/${Date.now()}-${safe}`
    const { error: upError } = await createClient()
      .storage.from('borrower-documents')
      .upload(storagePath, file, { contentType: file.type || undefined })
    if (upError) throw new Error(`Upload failed: ${upError.message}`)
    setStatus(`Reading${label} and updating the profile…`)
    const res = await fetch(`/api/lenders/${lenderId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storagePath, fileName: file.name, size: file.size, contentType: file.type || null }),
    })
    const out = await readJsonResponse<Result>(res)
    if (!out.ok) throw new Error(out.message)
    return out.body
  }

  async function remove(id: string) {
    await fetch(`/api/lenders/${lenderId}/documents/${id}`, { method: 'DELETE' })
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-sm font-semibold text-slate-900">Documents{documents.length ? ` (${documents.length})` : ''}</h2>
      <p className="mb-4 mt-1 text-xs text-slate-500">
        Tear sheets, term sheets, program guides. Each one is read when you add it and fills in the profile above — what
        they lend on, loan sizes, LTV, regions — so they&apos;re matched to the right deals.
      </p>
      {!ready ? (
        <p className="text-sm text-amber-700">Run migration 050_lender_documents.sql in Supabase to turn this on.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!status}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {status ?? '+ Add tear sheets / documents'}
          </button>
          <input
            ref={input}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.xls,.csv,.txt"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && uploadAll(Array.from(e.target.files))}
          />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {result.warning ? (
            <p>Saved, but {result.warning.charAt(0).toLowerCase() + result.warning.slice(1)}.</p>
          ) : (
            <>
              <p className="font-medium">{result.changes.length ? 'Profile updated:' : 'Read it — the profile already matched.'}</p>
              {result.changes.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {result.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      {documents.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {documents.map((d) => (
            <li key={d.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/api/lenders/${lenderId}/documents/${d.id}`} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">
                  {d.file_name}
                </a>
                <span className="text-xs text-slate-400">{new Date(d.created_at).toLocaleDateString()}</span>
                {(!d.summary || d.summary === '(reading…)') && <span className="text-xs text-amber-700">being read — check back in a few minutes</span>}
                {d.summary && d.summary !== '(reading…)' && (
                  <button type="button" onClick={() => setOpen(open === d.id ? null : d.id)} className="text-xs text-slate-500 hover:underline">
                    {open === d.id ? 'Hide what it says' : 'What it says'}
                  </button>
                )}
                <button type="button" onClick={() => remove(d.id)} className="ml-auto text-xs text-slate-400 hover:text-red-600">
                  Remove
                </button>
              </div>
              {open === d.id && d.summary && (
                <div className="mt-2 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="whitespace-pre-wrap">{d.summary}</p>
                  {d.changes.length > 0 && <p className="mt-2 text-slate-500">Filled in: {d.changes.join(' · ')}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
