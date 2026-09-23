import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { UnderwritingSchema } from '@/lib/underwriting/schema'

// Saves an already-structured underwriting (e.g. written by Claude Code for
// a queued deal). No AI call is made here, so it costs nothing.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/save-underwriting'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsed = UnderwritingSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Underwriting did not match the expected format', issues: parsed.error.issues }, { status: 400 })
  }

  const { data: saved, error } = await supabase
    .from('deals')
    .update({
      underwriting: parsed.data,
      underwriting_generated_at: new Date().toISOString(),
      underwriting_requested_at: null,
    })
    .eq('id', id)
    .select('id')
    .single()
  if (error || !saved) return NextResponse.json({ error: 'Failed to save underwriting' }, { status: 500 })

  await supabase.from('deals').update({ status: 'underwritten' }).eq('id', id).in('status', ['new', 'in_review'])
  return NextResponse.json({ ok: true })
}
