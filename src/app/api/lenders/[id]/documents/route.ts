import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readTearSheet } from '@/lib/lenders/tear-sheet'

export const maxDuration = 300

// A file was just uploaded to the lender's profile (straight from the
// browser to storage): save it, read it, and fill in the profile from it.
export async function POST(request: Request, ctx: RouteContext<'/api/lenders/[id]/documents'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { storagePath, fileName, size, contentType } = (await request.json()) as {
    storagePath?: string
    fileName?: string
    size?: number
    contentType?: string | null
  }
  if (!storagePath?.startsWith(`lenders/${id}/`) || !fileName) return NextResponse.json({ error: 'Bad file path' }, { status: 400 })

  const { data: doc, error } = await supabase
    .from('lender_documents')
    .insert({ lender_id: id, storage_path: storagePath, file_name: fileName, file_size: size ?? null, content_type: contentType ?? null, uploaded_by: user.id })
    .select('id')
    .single()
  if (error || !doc) {
    const missing = error?.message.includes('lender_documents')
    return NextResponse.json({ error: missing ? 'Run migration 050_lender_documents.sql in Supabase first.' : (error?.message ?? 'Couldn’t save the file') }, { status: 500 })
  }
  try {
    return NextResponse.json({ id: doc.id, ...(await readTearSheet(supabase, doc.id)) })
  } catch (err) {
    // The file stays on the profile either way.
    return NextResponse.json({ id: doc.id, summary: null, changes: [], warning: err instanceof Error ? err.message : 'Couldn’t read the file' })
  }
}
