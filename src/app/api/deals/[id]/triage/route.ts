import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { triageDealDocuments } from '@/lib/documents/triage'

export const maxDuration = 300

export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/deals/[id]/triage'>
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  try {
    return NextResponse.json(await triageDealDocuments(id))
  } catch (err) {
    console.error('Triage failed', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Triage failed' },
      { status: 500 }
    )
  }
}
