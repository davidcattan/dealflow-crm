import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SnapshotSchema } from '@/lib/snapshot/schema'

// Saves an already-structured snapshot (e.g. written by Claude Code for a
// queued deal) or an edited one from the deal page. No AI call is made.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/save-snapshot'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsed = SnapshotSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Snapshot did not match the expected format', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const { data: saved, error } = await supabase
    .from('deals')
    .update({
      snapshot: parsed.data,
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
}
