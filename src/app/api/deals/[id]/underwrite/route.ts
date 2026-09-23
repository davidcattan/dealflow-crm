import { NextResponse } from 'next/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { createClient } from '@/lib/supabase/server'
import { runUnderwriting } from '@/lib/underwriting/run'

// Needs Fluid Compute on Vercel Pro (max 800s); without it the cap is 300s.
export const maxDuration = 800

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/deals/[id]/underwrite'>
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  try {
    const underwriting = await runUnderwriting(id, request.signal)

    const { data: saved, error } = await supabase
      .from('deals')
      .update({
        underwriting,
        underwriting_generated_at: new Date().toISOString(),
        underwriting_requested_at: null,
      })
      .eq('id', id)
      .select('id')
      .single()

    if (error || !saved) {
      console.error('Underwriting save failed', { id, error })
      return NextResponse.json({ error: 'Failed to save underwriting' }, { status: 500 })
    }

    // Advance the pipeline stage automatically, but only from the early
    // stages — never regress a deal that's already matched/submitted/etc.
    await supabase
      .from('deals')
      .update({ status: 'underwritten' })
      .eq('id', id)
      .in('status', ['new', 'in_review'])

    return NextResponse.json({ underwriting })
  } catch (err) {
    console.error('Underwriting failed', err)
    const message = friendlyAiError(err, 'Underwriting failed')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
