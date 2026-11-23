import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { judgeLenderStanding } from '@/lib/deals/lender-standing'

export const maxDuration = 300

// Re-reads where every lender stands on a deal (or on every deal, a page
// at a time) and fixes statuses that are wrong. Each lender is one AI read
// on the inbox model — a few cents — so this runs only when asked.
// Body: { dealId?: string, offset?: number, limit?: number }
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { dealId, offset = 0, limit = 15 } = (await request.json().catch(() => ({}))) as {
    dealId?: string
    offset?: number
    limit?: number
  }
  let query = supabase.from('deal_submissions').select('deal_id, lender_id, lenders(name), deals(company_name)').order('id')
  if (dealId) query = query.eq('deal_id', dealId)
  const { data: subs, error } = await query.range(offset, offset + Math.min(limit, 25) - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = []
  for (const s of subs ?? []) {
    const lender = (Array.isArray(s.lenders) ? s.lenders[0] : s.lenders) as { name: string } | null
    const deal = (Array.isArray(s.deals) ? s.deals[0] : s.deals) as { company_name: string } | null
    try {
      const r = await judgeLenderStanding(supabase, s.deal_id as string, s.lender_id as string)
      results.push({ deal: deal?.company_name, lender: lender?.name, ...(r ?? { skipped: 'no emails or notes' }) })
    } catch (err) {
      results.push({ deal: deal?.company_name, lender: lender?.name, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  return NextResponse.json({ ok: true, next: (subs ?? []).length === Math.min(limit, 25) ? offset + (subs ?? []).length : null, results })
}
