import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { recommendAttachments } from '@/lib/deals/recommend-attachments'

export const maxDuration = 120

// Suggests which of the deal's documents to attach to lender emails.
// Reads only document names/summaries — a few cents.
export async function POST(_request: Request, ctx: RouteContext<'/api/deals/[id]/recommend-attachments'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  try {
    return NextResponse.json(await recommendAttachments(supabase, id))
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Could not recommend attachments') }, { status: 500 })
  }
}
