import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { slicePdf } from '@/lib/underwriting/build-content'
import type { DocumentRecord } from '@/lib/types'

// A PDF cut down to only the pages AI triage flagged as important — handy
// for uploading to Claude.ai, which has page/size limits per file.
export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/deals/[id]/documents/[docId]/trimmed'>
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, docId } = await ctx.params
  const { data: doc } = await supabase
    .from('documents')
    .select('*')
    .eq('id', docId)
    .eq('deal_id', id)
    .single()
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const record = doc as DocumentRecord
  const { data: file } = await supabase.storage.from('borrower-documents').download(record.storage_path)
  if (!file) return NextResponse.json({ error: 'Could not read the file' }, { status: 500 })
  const buffer = Buffer.from(await file.arrayBuffer())

  const triage = record.triage
  const sliced = triage && triage.important_pages.length > 0
    ? await slicePdf(buffer, triage.important_pages, triage.total_pages)
    : null

  const out = sliced ? sliced.data : buffer
  const name = record.file_name.replace(/\.pdf$/i, '') + (sliced ? ' (key pages).pdf' : '.pdf')
  return new Response(new Uint8Array(out), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  })
}
