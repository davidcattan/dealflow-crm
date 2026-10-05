import { NextResponse } from 'next/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { createClient } from '@/lib/supabase/server'
import { draftSubmissionEmail } from '@/lib/matching/draft'
import { DRAFT_STYLES, type DraftStyle } from '@/lib/matching/draft-schema'

export const maxDuration = 120

// On-demand draft (or redraft) for a single match, in the short or long
// style — used when a match scored below the auto-draft threshold, or to
// rewrite an existing draft.
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/deals/[id]/matches/[matchId]/draft'>
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, matchId } = await ctx.params
  const { style, includeIntro } = (await request.json().catch(() => ({}))) as { style?: string; includeIntro?: boolean }
  const draftStyle: DraftStyle = DRAFT_STYLES.includes(style as DraftStyle) ? (style as DraftStyle) : 'short'

  const { data: match } = await supabase
    .from('deal_matches')
    .select('id, lender_id, reasoning')
    .eq('id', matchId)
    .eq('deal_id', id)
    .single()
  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })

  try {
    const draft = await draftSubmissionEmail(id, match.lender_id, match.reasoning, draftStyle, includeIntro !== false)
    const { error } = await supabase
      .from('deal_matches')
      .update({
        draft_subject: draft.subject,
        draft_body: draft.body,
        draft_status: 'drafted',
        draft_generated_at: new Date().toISOString(),
      })
      .eq('id', matchId)
    if (error) return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = friendlyAiError(err, 'Could not draft the email')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
