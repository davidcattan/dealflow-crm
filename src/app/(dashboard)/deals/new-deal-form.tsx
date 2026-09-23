'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createDeal } from './actions'
import { STATUS_OPTIONS, STATUS_LABELS } from '@/lib/types'
import { INDUSTRY_CATEGORIES, LOAN_TYPE_CATEGORIES } from '@/lib/deals/categories'
import { FileDropzone } from '@/components/file-dropzone'
import { uploadDealDocuments } from '@/lib/upload-documents'

export function NewDealForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setError(null)
    setUploadError(null)
    setCreating(true)
    const result = await createDeal(undefined, formData)
    setCreating(false)

    if (result?.error || !result?.dealId) {
      setError(result?.error ?? 'Could not create deal. Please try again.')
      return
    }

    const dealId = result.dealId

    // Documents upload straight from the browser to Storage (not through
    // the server action) — see src/lib/upload-documents.ts.
    if (files.length > 0) {
      setUploading(true)
      const results = await uploadDealDocuments(dealId, files)
      setUploading(false)
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        setUploadError(
          `Deal created, but ${failed.length} document${failed.length === 1 ? '' : 's'} failed to upload. You can add them from the deal page.`
        )
      }
    }

    // Kick off AI relevance triage of the uploaded PDFs; keepalive lets it
    // continue while we navigate to the new deal page.
    if (files.length > 0) {
      fetch(`/api/deals/${dealId}/triage`, { method: 'POST', keepalive: true }).catch(() => {})
    }

    router.push(`/deals/${dealId}`)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        + New deal
      </button>
    )
  }

  const busy = creating || uploading

  return (
    <form
      action={handleSubmit}
      className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Company name *
        </label>
        <input
          name="company_name"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Contact name
        </label>
        <input
          name="contact_name"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Industry
        </label>
        <select
          name="industry"
          defaultValue=""
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
        >
          <option value="">—</option>
          {INDUSTRY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Loan type
        </label>
        <select
          name="loan_type"
          defaultValue=""
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
        >
          <option value="">—</option>
          {LOAN_TYPE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Contact email
        </label>
        <input
          name="contact_email"
          type="email"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Contact phone
        </label>
        <input
          name="contact_phone"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Website
        </label>
        <input
          name="website"
          placeholder="https://"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Status
        </label>
        <select
          name="status"
          defaultValue="new"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Deal type / ask
        </label>
        <input
          name="deal_type"
          placeholder="e.g. Ask $250k Bridge"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Rep
        </label>
        <input
          name="rep_name"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Activity score (0–10)
        </label>
        <input
          name="activity_score"
          type="number"
          min={0}
          max={10}
          placeholder="10 = working it today"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Notes
        </label>
        <textarea
          name="notes"
          rows={3}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Diligence documents
        </label>
        <div className="mt-1">
          <FileDropzone files={files} onFilesChange={setFiles} disabled={busy} />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Optional — you can also add these later from the deal page.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      {uploadError && (
        <p className="text-sm text-amber-600 sm:col-span-2">{uploadError}</p>
      )}

      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {creating ? 'Creating…' : uploading ? 'Uploading documents…' : 'Create deal'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
