import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractAskedFor, nextStep, type NextStep } from './next-step'
import type { AiNextStep } from './key-facts'

// The AI's step category → the To do list's sections and colors.
const AI_STEP: Record<AiNextStep['category'], Pick<NextStep, 'rank' | 'urgency'>> = {
  answer_lender: { rank: 1, urgency: 'you' },
  call_todo: { rank: 2, urgency: 'you' },
  borrower: { rank: 3, urgency: 'you' },
  send_out: { rank: 4, urgency: 'you' },
  everyone_passed: { rank: 5, urgency: 'you' },
  follow_up_lender: { rank: 6, urgency: 'follow_up' },
  waiting_on_borrower: { rank: 9, urgency: 'waiting' },
  waiting_on_lender: { rank: 9, urgency: 'waiting' },
  done: { rank: 10, urgency: 'done' },
}

// The next step for each of the given deals: the AI's (from the deal's
// key facts, which read every email, call and note) when it's newer than the
// deal's latest activity; otherwise worked out by rules from the deal's data.
export async function loadNextSteps(supabase: SupabaseClient, dealIds: string[]): Promise<Map<string, NextStep>> {
  const out = new Map<string, NextStep>()
  if (dealIds.length === 0) return out

  const [{ data: deals }, { data: docs }, { data: matches }, { data: subs }, { data: updates }, { data: calls }] = await Promise.all([
    supabase
      .from('deals')
      .select('id, status, created_at, updated_at, snapshot_generated_at, underwriting_generated_at, underwriting_requested_at')
      .in('id', dealIds),
    supabase.from('documents').select('deal_id').in('deal_id', dealIds),
    supabase.from('deal_matches').select('deal_id, draft_status').in('deal_id', dealIds),
    supabase.from('deal_submissions').select('deal_id, lender_id, status, sent_on, last_activity_at, lenders(name)').in('deal_id', dealIds),
    supabase
      .from('deal_updates')
      .select('deal_id, lender_id, note, source, created_at')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false })
      .limit(2000),
    // Recorded calls from the last week (empty until migration 029 is run).
    supabase
      .from('deal_calls')
      .select('deal_id, created_at, result')
      .in('deal_id', dealIds)
      .eq('status', 'done')
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('created_at', { ascending: false }),
  ])

  const count = <T extends { deal_id: string }>(rows: T[] | null, id: string, pred: (r: T) => boolean = () => true) =>
    (rows ?? []).filter((r) => r.deal_id === id && pred(r)).length

  // AI steps (empty before migration 044) and when each deal last had news.
  const [{ data: kfRows }, { data: emailRows }, { data: docRows }] = await Promise.all([
    supabase.from('deals').select('id, key_facts, key_facts_at').in('id', dealIds),
    supabase.from('inbox_messages').select('deal_id, received_at').in('deal_id', dealIds).order('received_at', { ascending: false }).limit(3000),
    supabase.from('documents').select('deal_id, uploaded_at').in('deal_id', dealIds),
  ])
  const newsAt = new Map<string, string>()
  const bump = (id: string, at: string | null | undefined) => {
    if (at && (!newsAt.has(id) || at > newsAt.get(id)!)) newsAt.set(id, at)
  }
  for (const r of emailRows ?? []) bump(r.deal_id as string, r.received_at as string)
  for (const r of docRows ?? []) bump(r.deal_id as string, r.uploaded_at as string)
  for (const r of updates ?? []) bump(r.deal_id as string, r.created_at as string)
  for (const r of calls ?? []) bump(r.deal_id as string, r.created_at as string)
  const aiStep = new Map<string, NextStep>()
  for (const r of kfRows ?? []) {
    const step = (r.key_facts as { next_step?: AiNextStep | null } | null)?.next_step
    const at = r.key_facts_at as string | null
    const news = newsAt.get(r.id as string)
    if (step?.text && at && (!news || news <= at) && AI_STEP[step.category]) {
      aiStep.set(r.id as string, { ...AI_STEP[step.category], text: step.text })
    }
  }

  for (const d of deals ?? []) {
    const ai = aiStep.get(d.id)
    if (ai) {
      out.set(d.id, ai)
      continue
    }
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

    // The latest call's first to-do for us — unless an email came in since.
    const call = (calls ?? []).find((c) => c.deal_id === d.id)
    const callTodo = (call?.result as { next_steps?: { text: string; owner: string }[] } | null)?.next_steps?.find((s) => s.owner === 'us')
    const emailSince = call && myUpdates.some((u) => u.source === 'email' && u.created_at > call.created_at)
    const callStep = call && callTodo && !emailSince ? { text: callTodo.text, at: call.created_at as string } : null

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
        callStep,
      })
    )
  }
  return out
}

// When anything last happened on each deal: an edit, a logged update, an
// email in or out, or a lender status change. (The deal's own updated_at
// only moves when its details are edited.)
export async function loadLastActivity(supabase: SupabaseClient, dealIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (dealIds.length === 0) return out
  const [{ data: deals }, { data: updates }, { data: subs }, { data: emails }] = await Promise.all([
    supabase.from('deals').select('id, updated_at').in('id', dealIds),
    supabase.from('deal_updates').select('deal_id, created_at').in('deal_id', dealIds).order('created_at', { ascending: false }).limit(3000),
    supabase.from('deal_submissions').select('deal_id, last_activity_at').in('deal_id', dealIds),
    supabase.from('inbox_messages').select('deal_id, received_at').in('deal_id', dealIds).order('received_at', { ascending: false }).limit(3000),
  ])
  const bump = (id: string, at: string | null | undefined) => {
    if (!at) return
    const cur = out.get(id)
    if (!cur || at > cur) out.set(id, at)
  }
  for (const d of deals ?? []) bump(d.id, d.updated_at)
  for (const u of updates ?? []) bump(u.deal_id, u.created_at)
  for (const s of subs ?? []) bump(s.deal_id, s.last_activity_at)
  for (const e of emails ?? []) bump(e.deal_id as string, e.received_at as string)
  return out
}
