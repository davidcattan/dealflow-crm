import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { runSnapshot } from '@/lib/snapshot/run'

// Needs Fluid Compute on Vercel Pro (max 800s); without it the cap is 300s.
export const maxDuration = 800

// Paid path: builds the lender snapshot from the deal's documents.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/snapshot'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  try {
    const snapshot = await runSnapshot(id, request.signal)
    const { data: saved, error } = await supabase
      .from('deals')
      .update({
        snapshot,
        snapshot_generated_at: new Date().toISOString(),
        underwriting_requested_at: null,
        underwriting_requested_kind: null,
      })
      .eq('id', id)
      .select('id')
      .single()
    if (error || !saved) return NextResponse.json({ error: 'Failed to save the snapshot' }, { status: 500 })
    await supabase.from('deals').update({ status: 'underwritten' }).eq('id', id).in('status', ['new', 'in_review'])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Snapshot failed', err)
    return NextResponse.json({ error: friendlyAiError(err, 'Snapshot failed') }, { status: 500 })
  }
}
