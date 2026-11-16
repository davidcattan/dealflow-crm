import { NextResponse } from 'next/server'
import { sessionOrKey } from '@/lib/shortcut/keys'
import { LenderResearchSchema, saveLenderResearch } from '@/lib/lenders/research'

// Free path: the Claude Code queue job posts what it found about a new
// lender online. Fills only empty fields and takes the lender off the queue.
export async function POST(request: Request, ctx: RouteContext<'/api/lenders/[id]/save-research'>) {
  // Browser session, or a personal key (the cloud queue job).
  const auth = await sessionOrKey(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const parsed = LenderResearchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid lender research', issues: parsed.error.issues.slice(0, 20) }, { status: 400 })
  }
  try {
    await saveLenderResearch(auth.supabase, id, parsed.data)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status: 500 })
  }
}
