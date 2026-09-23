import { NextResponse } from 'next/server'
import { friendlyAiError } from '@/lib/ai-errors'
import { createClient } from '@/lib/supabase/server'
import { structureUnderwriting } from '@/lib/underwriting/run'

export const maxDuration = 300

// Saves an underwriting analysis written elsewhere (e.g. in Claude.ai):
// one small structuring call, no document reading or web research.
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/deals/[id]/import-underwriting'>
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { text } = (await request.json().catch(() => ({}))) as { text?: string }
  const analysis = (text ?? '').trim()
  if (analysis.length < 200) {
    return NextResponse.json(
      { error: 'That looks too short to be a full underwriting. Paste the whole answer from Claude.ai.' },
      { status: 400 }
    )
  }

  try {
    const underwriting = await structureUnderwriting(analysis.slice(0, 150_000), id, request.signal)

    const { data: saved, error } = await supabase
      .from('deals')
      .update({ underwriting, underwriting_generated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .single()
    if (error || !saved) {
      return NextResponse.json({ error: 'Failed to save underwriting' }, { status: 500 })
    }

    await supabase
      .from('deals')
      .update({ status: 'underwritten' })
      .eq('id', id)
      .in('status', ['new', 'in_review'])

    return NextResponse.json({ underwriting })
  } catch (err) {
    const message = friendlyAiError(err, 'Import failed')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
