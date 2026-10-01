import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { runInboxSync } from '@/lib/inbox/sync'

// Needs Fluid Compute on Vercel Pro (max 800s).
export const maxDuration = 800

// Manual "Check inbox now" from Settings, run as the signed-in user.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const summary = await runInboxSync(supabase)
    return NextResponse.json(summary)
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Inbox check failed') }, { status: 500 })
  }
}
