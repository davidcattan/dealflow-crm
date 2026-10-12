import { NextResponse } from 'next/server'
import { sessionOrKey } from '@/lib/shortcut/keys'
import { docTextsOf, withCollateralRequests } from '@/lib/snapshot/collateral'
import { SnapshotSchema } from '@/lib/snapshot/schema'

// Saves an already-structured snapshot (e.g. written by Claude Code for a
// queued deal) or an edited one from the deal page. No AI call is made.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/save-snapshot'>) {
  // Browser session, or a personal key (the cloud queue job).
  const auth = await sessionOrKey(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { supabase } = auth

  const { id } = await ctx.params
  const parsed = SnapshotSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Snapshot did not match the expected format', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  // Always ask for the AR aging / inventory list / equipment list when needed.
  const { data: docs } = await supabase.from('documents').select('file_name, triage').eq('deal_id', id)
  const snapshot = withCollateralRequests(parsed.data, docTextsOf(docs ?? []))
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
}
