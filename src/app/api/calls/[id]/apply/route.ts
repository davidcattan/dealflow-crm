import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { applyCallSuggestions } from '@/lib/calls/process'

// Applies the suggested updates someone ticked on a call's notes.
export async function POST(request: Request, ctx: RouteContext<'/api/calls/[id]/apply'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { keys } = (await request.json()) as { keys?: string[] }
  try {
    const result = await applyCallSuggestions(supabase, id, keys ?? [])
    const { data: call } = await supabase.from('deal_calls').select('deal_id, lender_id').eq('id', id).single()
    if (call?.deal_id) revalidatePath(`/deals/${call.deal_id}`)
    else if (call?.lender_id) revalidatePath(`/lenders/${call.lender_id}`)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Couldn’t apply' }, { status: 500 })
  }
}
