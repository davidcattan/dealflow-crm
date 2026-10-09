import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { deleteCall } from '@/lib/calls/process'

// Deletes a call (e.g. a bad recording), its audio, and the notes it added
// to the deal's updates.
export async function DELETE(_request: Request, ctx: RouteContext<'/api/calls/[id]'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: call } = await supabase.from('deal_calls').select('deal_id, lender_id').eq('id', id).single()
  await deleteCall(supabase, id)
  if (call?.deal_id) revalidatePath(`/deals/${call.deal_id}`)
  else if (call?.lender_id) revalidatePath(`/lenders/${call.lender_id}`)
  return NextResponse.json({ ok: true })
}
