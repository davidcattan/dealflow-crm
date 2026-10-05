import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { runLenderSearch } from '@/lib/lender-search/run'
import { saveLenderSearch } from '@/lib/lender-search/save'

// Needs Fluid Compute on Vercel Pro (max 800s).
export const maxDuration = 800

// Paid path: searches the web for new lenders that fit this deal.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/find-lenders'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  try {
    const search = await runLenderSearch(supabase, id, request.signal)
    await saveLenderSearch(supabase, id, search)
    return NextResponse.json({ ok: true, found: search.results.length })
  } catch (err) {
    console.error('Lender search failed', err)
    return NextResponse.json({ error: friendlyAiError(err, 'Lender search failed') }, { status: 500 })
  }
}
