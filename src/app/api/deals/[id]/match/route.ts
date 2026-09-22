import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runMatching } from '@/lib/matching/run'

export const maxDuration = 300

export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/deals/[id]/match'>
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
    const { matches, notes } = await runMatching(id)

    // Clear the previous run's results before saving the new one.
    await supabase.from('deal_matches').delete().eq('deal_id', id)

    if (matches.length === 0) {
      return NextResponse.json({ count: 0, notes })
    }

    const { data: saved, error } = await supabase
      .from('deal_matches')
      .insert(
        matches.map((m) => ({
          deal_id: id,
          lender_id: m.lenderId,
          score: Math.round(m.score),
          reasoning: m.reasoning,
        }))
      )
      .select('id')

    if (error || !saved) {
      console.error('Match save failed', { id, error })
      return NextResponse.json({ error: 'Failed to save matches' }, { status: 500 })
    }

    return NextResponse.json({ count: saved.length, notes })
  } catch (err) {
    console.error('Matching failed', err)
    const message = err instanceof Error ? err.message : 'Matching failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
