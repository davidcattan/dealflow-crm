import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { structureLenderSearch } from '@/lib/lender-search/run'
import { saveLenderSearch } from '@/lib/lender-search/save'

export const maxDuration = 300

// Saves lender research done in Claude.ai (pasted): one short structuring
// call, no web searching — a few cents.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/import-lender-search'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { text } = (await request.json().catch(() => ({}))) as { text?: string }
  const pasted = (text ?? '').trim()
  if (pasted.length < 150) {
    return NextResponse.json({ error: 'That looks too short. Paste the whole answer from Claude.ai.' }, { status: 400 })
  }
  try {
    const search = await structureLenderSearch(pasted.slice(0, 60_000), id, request.signal)
    await saveLenderSearch(supabase, id, search)
    return NextResponse.json({ ok: true, found: search.results.length })
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Import failed') }, { status: 500 })
  }
}
