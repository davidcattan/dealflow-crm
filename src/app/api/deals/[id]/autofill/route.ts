import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { autofillDeal } from '@/lib/deals/autofill'

export const maxDuration = 120

// Fill in the deal's missing business details from its documents (just the
// given new files, or all of them). Cheapest model, first pages only.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/autofill'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const body = (await request.json().catch(() => ({}))) as { documentIds?: string[] }
  try {
    const changed = await autofillDeal(supabase, id, body.documentIds)
    return NextResponse.json({ ok: true, changed })
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Couldn’t read the documents') }, { status: 500 })
  }
}
