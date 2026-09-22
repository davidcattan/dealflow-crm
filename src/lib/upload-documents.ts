'use client'

import { createClient } from '@/lib/supabase/client'

// Uploads go straight from the browser to Supabase Storage, not through a
// Next.js server action — server actions on Vercel are capped at a few MB
// per request, which a handful of real diligence PDFs blows past easily.
// The `documents` table and the storage bucket both already grant full
// access to any authenticated user (small trusted team model), so the
// browser's own session is enough to do this directly.

export type UploadResult = { fileName: string; ok: boolean; error?: string }

export async function uploadDealDocuments(
  dealId: string,
  files: File[]
): Promise<UploadResult[]> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const results: UploadResult[] = []

  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${dealId}/${Date.now()}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from('borrower-documents')
      .upload(storagePath, file, { contentType: file.type || undefined })

    if (uploadError) {
      results.push({ fileName: file.name, ok: false, error: uploadError.message })
      continue
    }

    const { error: insertError } = await supabase.from('documents').insert({
      deal_id: dealId,
      file_name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      content_type: file.type || null,
      uploaded_by: user?.id ?? null,
    })

    if (insertError) {
      results.push({ fileName: file.name, ok: false, error: insertError.message })
      continue
    }

    results.push({ fileName: file.name, ok: true })
  }

  return results
}
