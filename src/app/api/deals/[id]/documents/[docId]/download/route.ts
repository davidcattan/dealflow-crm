import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// A document's download link, made when it's clicked (making one for every
// file up front slowed the deal page down).
export async function GET(_request: Request, ctx: RouteContext<'/api/deals/[id]/documents/[docId]/download'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, docId } = await ctx.params
  const { data: doc } = await supabase.from('documents').select('storage_path, file_name').eq('id', docId).eq('deal_id', id).single()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data } = await supabase.storage
    .from('borrower-documents')
    .createSignedUrl(doc.storage_path, 60 * 60, { download: doc.file_name })
  if (!data?.signedUrl) return NextResponse.json({ error: 'Couldn’t make a download link' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
