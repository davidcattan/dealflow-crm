import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { advanceCall } from '@/lib/calls/process'

// Writing the notes can take a minute on a long call.
export const maxDuration = 300

// Polled by the deal page while a call is processing.
export async function POST(_request: Request, ctx: RouteContext<'/api/calls/[id]/check'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  try {
    await advanceCall(supabase, id)
    const { data } = await supabase.from('deal_calls').select('status, error').eq('id', id).single()
    return NextResponse.json({ status: data?.status ?? 'error', error: data?.error ?? null })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Check failed' }, { status: 500 })
  }
}
