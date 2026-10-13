import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { guessCategory } from '@/lib/documents/categories'
import type { DocumentRecord } from '@/lib/types'

// Fresh download links for every document on a deal, with its group, so the
// browser can save them as one zip (a folder per group). Same file uploaded
// twice is listed once.
export async function GET(_request: Request, ctx: RouteContext<'/api/deals/[id]/documents/all'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data } = await supabase.from('documents').select('*').eq('deal_id', id).order('uploaded_at')
  const seen = new Set<string>()
  const docs = ((data ?? []) as DocumentRecord[]).filter((d) => {
    const key = `${d.file_name.toLowerCase()}|${d.file_size}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!docs.length) return NextResponse.json({ files: [] })
  const { data: signed } = await supabase.storage.from('borrower-documents').createSignedUrls(docs.map((d) => d.storage_path), 600)
  return NextResponse.json({
    files: docs.map((d, i) => ({
      name: d.file_name,
      group: d.category || guessCategory(d.file_name, d.triage?.doc_type),
      url: signed?.[i]?.signedUrl ?? null,
    })),
  })
}
