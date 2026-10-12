import { NextResponse } from 'next/server'
import { sessionOrKey } from '@/lib/shortcut/keys'
import { UnderwritingSchema } from '@/lib/underwriting/schema'

// Saves an already-structured underwriting (e.g. written by Claude Code for
// a queued deal). No AI call is made here, so it costs nothing.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/save-underwriting'>) {
  // Browser session, or a personal key (the cloud queue job).
  const auth = await sessionOrKey(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { supabase } = auth

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
