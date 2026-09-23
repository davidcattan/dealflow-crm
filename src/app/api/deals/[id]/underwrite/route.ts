import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runUnderwriting } from '@/lib/underwriting/run'

export const maxDuration = 300

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
      })
      .eq('id', id)
      .select('id')
      .single()

    if (error || !saved) {
      console.error('Underwriting save failed', { id, error })
      return NextResponse.json({ error: 'Failed to save underwriting' }, { status: 500 })
    }

    return NextResponse.json({ underwriting })
  } catch (err) {
    console.error('Underwriting failed', err)
    const message = err instanceof Error ? err.message : 'Underwriting failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
