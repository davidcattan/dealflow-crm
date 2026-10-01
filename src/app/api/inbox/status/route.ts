import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSyncStatus } from '@/lib/inbox/sync'

// Newest email in the inbox vs. how far the CRM has read. No AI — free.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    return NextResponse.json(await getSyncStatus(supabase))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not read the inbox status' },
      { status: 500 }
    )
  }
}
