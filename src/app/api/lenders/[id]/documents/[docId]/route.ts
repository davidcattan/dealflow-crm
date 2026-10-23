import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Opens the file (a short-lived link to it in storage).
export async function GET(_request: Request, ctx: RouteContext<'/api/lenders/[id]/documents/[docId]'>) {
  const supabase = await createClient()
  const { id, docId } = await ctx.params
  const { data: doc } = await supabase.from('lender_documents').select('storage_path, file_name').eq('id', docId).eq('lender_id', id).single()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data } = await supabase.storage.from('borrower-documents').createSignedUrl(doc.storage_path, 60 * 60)
  if (!data) return NextResponse.json({ error: 'Couldn’t open the file' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}

// Removes the file from the profile. What it already filled in stays.
export async function DELETE(_request: Request, ctx: RouteContext<'/api/lenders/[id]/documents/[docId]'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, docId } = await ctx.params
  const { data: doc } = await supabase.from('lender_documents').select('storage_path').eq('id', docId).eq('lender_id', id).single()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await supabase.storage.from('borrower-documents').remove([doc.storage_path])
  await supabase.from('lender_documents').delete().eq('id', docId)
  return NextResponse.json({ ok: true })
}
