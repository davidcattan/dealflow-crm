import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { runQuickRead } from '@/lib/quickread/run'

export const maxDuration = 300

// Paid but cheap: the short "just the important things" read of a deal.
export async function POST(_request: Request, ctx: RouteContext<'/api/deals/[id]/quick-read'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  // Check the column exists before paying for the AI call.
  const { error: missing } = await supabase.from('deals').select('quick_read').eq('id', id).maybeSingle()
  if (missing) return NextResponse.json({ error: 'Run migration 036_quick_read.sql in Supabase first.' }, { status: 500 })
  try {
    const quickRead = await runQuickRead(supabase, id)
    const { error } = await supabase.from('deals').update({ quick_read: quickRead, quick_read_at: new Date().toISOString() }).eq('id', id)
    if (error) {
      return NextResponse.json(
        { error: error.message.includes('quick_read') ? 'Run migration 036_quick_read.sql in Supabase first.' : 'Couldn’t save the quick read' },
        { status: 500 }
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Quick read failed') }, { status: 500 })
  }
}
