import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runMatching } from '@/lib/matching/run'
import { draftSubmissionEmail, DRAFT_SCORE_THRESHOLD } from '@/lib/matching/draft'

export const maxDuration = 300

export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/deals/[id]/match'>
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  try {
    const { matches, notes } = await runMatching(id)

    // Clear the previous run's results before saving the new one.
    await supabase.from('deal_matches').delete().eq('deal_id', id)

    if (matches.length === 0) {
      return NextResponse.json({ count: 0, notes })
    }

    const { data: saved, error } = await supabase
      .from('deal_matches')
      .insert(
        matches.map((m) => ({
          deal_id: id,
          lender_id: m.lenderId,
          score: Math.round(m.score),
          reasoning: m.reasoning,
        }))
      )
      .select('id, lender_id, score, reasoning')

    if (error || !saved) {
      console.error('Match save failed', { id, error })
      return NextResponse.json({ error: 'Failed to save matches' }, { status: 500 })
    }

    // Advance the pipeline stage automatically the first time a deal gets
    // real matches — but only from the early stages. If it's already
    // further along (submitted/closed/dead) or already "matched", leave
    // the stage alone; re-running matching shouldn't undo manual progress.
    await supabase
      .from('deals')
      .update({ status: 'matched' })
      .eq('id', id)
      .in('status', ['new', 'in_review', 'underwritten'])

    // Auto-draft a submission email for any strong match. Best-effort per
    // lender — one failed draft shouldn't take down the whole match run,
    // since the matches themselves are already saved at this point.
    const strongMatches = saved.filter((m) => m.score >= DRAFT_SCORE_THRESHOLD)
    for (const m of strongMatches) {
      try {
        const draft = await draftSubmissionEmail(id, m.lender_id, m.reasoning)
        await supabase
          .from('deal_matches')
          .update({
            draft_subject: draft.subject,
            draft_body: draft.body,
            draft_status: 'drafted',
            draft_generated_at: new Date().toISOString(),
          })
          .eq('id', m.id)
      } catch (draftErr) {
        console.error('Draft generation failed', { id, lenderId: m.lender_id, draftErr })
      }
    }

    return NextResponse.json({ count: saved.length, notes })
  } catch (err) {
    console.error('Matching failed', err)
    const message = err instanceof Error ? err.message : 'Matching failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
