import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { backfillLoanTypes } from '@/lib/deals/backfill-loan-type'

export const maxDuration = 300

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await backfillLoanTypes()
    return NextResponse.json(result)
  } catch (err) {
    console.error('Loan type backfill failed', err)
    const message = err instanceof Error ? err.message : 'Backfill failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
