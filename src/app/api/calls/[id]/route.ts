import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Deletes a call (e.g. a bad recording) and its audio. Notes it already
// added to the deal's updates stay.
export async function DELETE(_request: Request, ctx: RouteContext<'/api/calls/[id]'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: call } = await supabase.from('deal_calls').select('storage_path').eq('id', id).single()
  if (call?.storage_path) await supabase.storage.from('borrower-documents').remove([call.storage_path])
  await supabase.from('deal_calls').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
