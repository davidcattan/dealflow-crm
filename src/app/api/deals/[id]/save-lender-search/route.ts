import { NextResponse } from 'next/server'
import { sessionOrKey } from '@/lib/shortcut/keys'
import { LenderSearchSchema } from '@/lib/lender-search/schema'
import { saveLenderSearch } from '@/lib/lender-search/save'

// Free path: Claude Code posts lender search results it researched itself.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/save-lender-search'>) {
  // Browser session, or a personal key (the cloud queue job).
  const auth = await sessionOrKey(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { supabase } = auth

  const { id } = await ctx.params
  const parsed = LenderSearchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid lender search', issues: parsed.error.issues.slice(0, 20) }, { status: 400 })
  }
  try {
    await saveLenderSearch(supabase, id, parsed.data)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status: 500 })
  }
}
