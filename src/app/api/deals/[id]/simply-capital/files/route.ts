import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Fresh download links for the files picked for Simply Capital's upload, so
// the browser can bundle them into one zip.
export async function GET(_request: Request, ctx: RouteContext<'/api/deals/[id]/simply-capital/files'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: deal } = await supabase.from('deals').select('simply_capital').eq('id', id).maybeSingle()
  const prep = deal?.simply_capital as { files?: { item: string; document_ids: string[] }[] } | null
  const ids = [...new Set((prep?.files ?? []).flatMap((f) => f.document_ids))]
  if (!ids.length) return NextResponse.json({ files: [] })
  const { data: docs } = await supabase.from('documents').select('id, file_name, storage_path').eq('deal_id', id).in('id', ids)
  const item = new Map((prep?.files ?? []).flatMap((f) => f.document_ids.map((d) => [d, f.item] as const)))
  const { data: signed } = await supabase.storage.from('borrower-documents').createSignedUrls((docs ?? []).map((d) => d.storage_path), 600)
  const files = (docs ?? []).map((d, i) => ({ name: d.file_name, item: item.get(d.id) ?? 'other', url: signed?.[i]?.signedUrl ?? null }))
  return NextResponse.json({ files })
}
