import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { backfillIndustries } from '@/lib/deals/backfill-industry'

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
    const result = await backfillIndustries()
    return NextResponse.json(result)
  } catch (err) {
    console.error('Industry backfill failed', err)
    const message = err instanceof Error ? err.message : 'Backfill failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
