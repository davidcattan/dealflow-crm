import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { reprocessInboxMessage } from '@/lib/inbox/sync'

export const maxDuration = 300

// Re-reads one recorded email, e.g. a lender reply that couldn't be matched
// to a deal the first time.
export async function POST(_request: Request, ctx: RouteContext<'/api/inbox/messages/[messageId]/retry'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messageId } = await ctx.params
  try {
    const record = await reprocessInboxMessage(supabase, messageId)
    return NextResponse.json({ ok: true, record })
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Retry failed') }, { status: 500 })
  }
}
