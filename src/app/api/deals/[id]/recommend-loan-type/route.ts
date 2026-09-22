import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recommendLoanType } from '@/lib/deals/recommend-loan-type'

export const maxDuration = 300

export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/deals/[id]/recommend-loan-type'>
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  try {
    const result = await recommendLoanType(id)
    return NextResponse.json(result)
  } catch (err) {
    console.error('Loan type recommendation failed', err)
    const message = err instanceof Error ? err.message : 'Recommendation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
