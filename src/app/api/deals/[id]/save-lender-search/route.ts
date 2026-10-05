import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { LenderSearchSchema } from '@/lib/lender-search/schema'
import { saveLenderSearch } from '@/lib/lender-search/save'

// Free path: Claude Code posts lender search results it researched itself.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/save-lender-search'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
