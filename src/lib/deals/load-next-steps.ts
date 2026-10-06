import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractAskedFor, nextStep, type NextStep } from './next-step'

// Works out the next step for each of the given deals in a handful of
// queries (no AI).
export async function loadNextSteps(supabase: SupabaseClient, dealIds: string[]): Promise<Map<string, NextStep>> {
  const out = new Map<string, NextStep>()
  if (dealIds.length === 0) return out

  const [{ data: deals }, { data: docs }, { data: matches }, { data: subs }, { data: updates }] = await Promise.all([
    supabase
      .from('deals')
      .select('id, status, created_at, updated_at, snapshot_generated_at, underwriting_generated_at, underwriting_requested_at')
      .in('id', dealIds),
    supabase.from('documents').select('deal_id').in('deal_id', dealIds),
    supabase.from('deal_matches').select('deal_id, draft_status').in('deal_id', dealIds),
    supabase.from('deal_submissions').select('deal_id, lender_id, status, sent_on, last_activity_at, lenders(name)').in('deal_id', dealIds),
    supabase
      .from('deal_updates')
      .select('deal_id, lender_id, note, created_at')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false })
      .limit(2000),
  ])

  const count = <T extends { deal_id: string }>(rows: T[] | null, id: string, pred: (r: T) => boolean = () => true) =>
    (rows ?? []).filter((r) => r.deal_id === id && pred(r)).length

  for (const d of deals ?? []) {
    const mySubs = (subs ?? []).filter((s) => s.deal_id === d.id)
    const lenderName = (s: (typeof mySubs)[number]) => {
      const l = Array.isArray(s.lenders) ? s.lenders[0] : s.lenders
      return (l as { name?: string } | null)?.name ?? 'a lender'
    }
    const myUpdates = (updates ?? []).filter((u) => u.deal_id === d.id)

    // Latest "Asked for: …" from each lender on this deal.
    const requestsByLender: Record<string, string> = {}
    for (const s of mySubs) {
      const u = myUpdates.find((x) => x.lender_id === s.lender_id && /Asked for:/.test(x.note ?? ''))
      const asked = u ? extractAskedFor(u.note) : null
      if (asked) requestsByLender[lenderName(s)] = asked
    }

    const activity = [d.updated_at, myUpdates[0]?.created_at, ...mySubs.map((s) => s.last_activity_at)].filter(Boolean) as string[]
    out.set(
      d.id,
      nextStep({
        status: d.status,
        createdAt: d.created_at,
        docCount: count(docs, d.id),
        hasUnderwriting: Boolean(d.snapshot_generated_at || d.underwriting_generated_at),
        underwritingQueued: Boolean(d.underwriting_requested_at),
        matchCount: count(matches, d.id),
        draftCount: count(matches, d.id, (m) => m.draft_status === 'drafted'),
        submissions: mySubs.map((s) => ({
          lender: lenderName(s),
          status: s.status,
          sentOn: s.sent_on,
          lastActivityAt: s.last_activity_at,
        })),
        requestsByLender,
        lastActivityAt: activity.sort().pop() ?? d.updated_at,
      })
    )
  }
  return out
}
