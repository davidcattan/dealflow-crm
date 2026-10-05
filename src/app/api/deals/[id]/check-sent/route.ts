import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { detectSentDrafts } from '@/lib/outlook/sent-tracking'

export const maxDuration = 60

// Checks Outlook Sent Items for this deal's CRM-created drafts (free).
export async function POST(_request: Request, ctx: RouteContext<'/api/deals/[id]/check-sent'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  try {
    return NextResponse.json({ found: await detectSentDrafts(supabase, id) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Check failed' }, { status: 500 })
  }
}
