import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { structureSnapshot } from '@/lib/snapshot/run'

export const maxDuration = 300

// Saves a snapshot written elsewhere (pasted from Claude.ai): one short
// structuring call, no document reading.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/import-snapshot'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { text } = (await request.json().catch(() => ({}))) as { text?: string }
  const pasted = (text ?? '').trim()
  if (pasted.length < 150) {
    return NextResponse.json(
      { error: 'That looks too short to be a full snapshot. Paste the whole answer from Claude.ai.' },
      { status: 400 }
    )
  }
  try {
    const snapshot = await structureSnapshot(pasted.slice(0, 120_000), id, request.signal)
    const { data: saved, error } = await supabase
      .from('deals')
      .update({
        snapshot,
        snapshot_generated_at: new Date().toISOString(),
        underwriting_requested_at: null,
        underwriting_requested_kind: null,
      })
      .eq('id', id)
      .select('id')
      .single()
    if (error || !saved) return NextResponse.json({ error: 'Failed to save the snapshot' }, { status: 500 })
    await supabase.from('deals').update({ status: 'underwritten' }).eq('id', id).in('status', ['new', 'in_review'])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Import failed') }, { status: 500 })
  }
}
