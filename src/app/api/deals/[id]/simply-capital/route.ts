import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { prepareSimplyCapital } from '@/lib/simply-capital/run'

export const maxDuration = 300

const MIGRATION = 'Run migration 040_simply_capital.sql in Supabase first.'

// Paid: prepares Simply Capital's application (form answers + which files).
export async function POST(_request: Request, ctx: RouteContext<'/api/deals/[id]/simply-capital'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error: missing } = await supabase.from('deals').select('simply_capital').eq('id', id).maybeSingle()
  if (missing) return NextResponse.json({ error: MIGRATION }, { status: 500 })
  try {
    const prep = await prepareSimplyCapital(supabase, id)
    const { error } = await supabase.from('deals').update({ simply_capital: prep, simply_capital_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message.includes('simply_capital') ? MIGRATION : 'Couldn’t save it' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Couldn’t prepare the application') }, { status: 500 })
  }
}
