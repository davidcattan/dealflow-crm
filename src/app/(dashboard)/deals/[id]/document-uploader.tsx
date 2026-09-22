'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileDropzone } from '@/components/file-dropzone'
import { uploadDealDocuments } from '@/lib/upload-documents'

export function DocumentUploader({ dealId }: { dealId: string }) {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mb-5 space-y-3">
      <FileDropzone files={files} onFilesChange={setFiles} disabled={uploading} />
      {error && <p className="text-sm text-red-600">{error}</p>}
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
