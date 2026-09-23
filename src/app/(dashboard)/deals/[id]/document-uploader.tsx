'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileDropzone } from '@/components/file-dropzone'
import { uploadDealDocuments } from '@/lib/upload-documents'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'

export function DocumentUploader({
  dealId,
  untriagedCount,
}: {
  dealId: string
  untriagedCount: number
}) {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  // AI triage: decides which pages of each PDF matter for underwriting, so
  // the full underwriting pass doesn't pay to read boilerplate.
  async function analyze() {
    setAnalyzing(true)
    try {
      const res = await fetch(`/api/deals/${dealId}/triage`, { method: 'POST' })
      const result = await readJsonResponse<{ done: number; failed: string[] }>(res)
      if (!result.ok) setError(result.message)
      else if (result.body.failed.length > 0)
        setError(`Couldn't analyze: ${result.body.failed.join(', ')}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
      router.refresh()
    }
  }

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const results = await uploadDealDocuments(dealId, files)
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        setError(
          `${failed.length} file${failed.length === 1 ? '' : 's'} failed to upload: ${failed
            .map((f) => f.fileName)
            .join(', ')}`
        )
        // Keep only the failed ones selected so the user can just retry.
        const failedNames = new Set(failed.map((f) => f.fileName))
        setFiles(files.filter((f) => failedNames.has(f.name)))
      } else {
        setFiles([])
      }
      router.refresh()
      if (failed.length < files.length) await analyze()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mb-5 space-y-3">
      <FileDropzone files={files} onFilesChange={setFiles} disabled={uploading} />
      {error && (
        <p className="text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}
      {analyzing && (
        <p className="text-sm text-slate-500">
          AI is reading your documents to decide which pages matter for
          underwriting…
        </p>
      )}
      {!analyzing && untriagedCount > 0 && files.length === 0 && (
        <button
          onClick={analyze}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Analyze {untriagedCount} document{untriagedCount === 1 ? '' : 's'} for relevance
        </button>
      )}
      {files.length > 0 && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {uploading
            ? `Uploading ${files.length}…`
            : `Upload ${files.length} file${files.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}
