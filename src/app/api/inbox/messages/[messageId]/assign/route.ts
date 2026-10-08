import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assignInboxMessageToDeal } from '@/lib/inbox/sync'

export const maxDuration = 120

// Files an email on a deal chosen by hand (no AI, free).
export async function POST(request: Request, ctx: RouteContext<'/api/inbox/messages/[messageId]/assign'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messageId } = await ctx.params
  const { dealId } = (await request.json().catch(() => ({}))) as { dealId?: string }
  if (!dealId) return NextResponse.json({ error: 'Pick a deal' }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, action: await assignInboxMessageToDeal(supabase, messageId, dealId) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not file the email' }, { status: 500 })
  }
}
