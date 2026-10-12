import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { runProfile } from '@/lib/profile/run'

export const maxDuration = 300

const MIGRATION = 'Run migration 038_borrower_profile.sql in Supabase first.'

// Paid: reads the deal's tax returns / entity papers for owner and company
// details (lender application forms).
export async function POST(_request: Request, ctx: RouteContext<'/api/deals/[id]/profile'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  // Check the column exists before paying for the AI call.
  const { error: missing } = await supabase.from('deals').select('borrower_profile').eq('id', id).maybeSingle()
  if (missing) return NextResponse.json({ error: MIGRATION }, { status: 500 })
  try {
    const { profile, read } = await runProfile(supabase, id)
    const { error } = await supabase
      .from('deals')
      .update({ borrower_profile: { ...profile, read }, borrower_profile_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message.includes('borrower_profile') ? MIGRATION : 'Couldn’t save the profile' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Couldn’t read the documents') }, { status: 500 })
  }
}
